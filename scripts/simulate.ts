/**
 * Run the whole core (Elm327 driver → RpmPoller → ShiftLight) against the simulated car.
 *
 *   npm run sim                                 pull scenario, 15 s, threshold 5500
 *   npm run sim -- random 20                    scenario and duration in seconds
 *   npm run sim -- pull 20 --threshold=5000 --lead=300 --window=400
 *   npm run sim -- pull 10 --samples -v         also print every sample / raw traffic
 *
 * For every LIGHT ON it prints the car's true RPM `leadMs` after the light fired: the moment
 * the lead time is aiming at. Its difference to the threshold is the error.
 */
import { DebugLog, showControlChars } from '../src/core/debugLog';
import { Elm327 } from '../src/core/elm327';
import { RpmPoller, type RpmSample } from '../src/core/rpmPoller';
import { DEFAULT_SHIFT_LIGHT_CONFIG, ShiftLight } from '../src/core/shiftLight';
import { MockTransport } from '../src/transports/mock';
import { type Scenario, SimulatedCar } from '../src/transports/simulatedCar';

const SCENARIOS: Scenario[] = ['pull', 'cruise', 'random'];
const FRAME_MS = 16; // like a 60 Hz screen
const BAR_WIDTH = 30;

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
}
const verbose = args.includes('-v') || args.includes('--verbose');
const showSamples = args.includes('--samples');
const positional = args.filter((arg) => !arg.startsWith('-'));
const scenario = (positional[0] ?? 'pull') as Scenario;
const seconds = Number(positional[1] ?? 15);
const thresholdRpm = Number(flag('threshold') ?? 5500);
const leadMs = Number(flag('lead') ?? 150);
const rateWindowMs = Number(flag('window') ?? DEFAULT_SHIFT_LIGHT_CONFIG.rateWindowMs);

if (
  !SCENARIOS.includes(scenario) ||
  !(seconds > 0) ||
  !(thresholdRpm > 0) ||
  !(leadMs >= 0) ||
  !(rateWindowMs > 0)
) {
  console.error(
    `Usage: npm run sim -- [${SCENARIOS.join('|')}] [seconds] ` +
      '[--threshold=RPM] [--lead=MS] [--window=MS] [--samples] [-v]',
  );
  process.exit(1);
}

function bar(rpm: number, max: number): string {
  const filled = Math.round(Math.min(rpm / max, 1) * BAR_WIDTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Fire {
  gear: number;
  error: number;
}

async function main(): Promise<void> {
  const log = new DebugLog();
  if (verbose) {
    log.subscribe((entry) => console.log(`    [${entry.dir}] ${showControlChars(entry.text)}`));
  }

  const car = new SimulatedCar({ scenario });
  // Remember the gear at the moment the mock measures RPM, not when we print later.
  let measuredGear = car.gear;
  const rpmSource = {
    rpm: () => {
      measuredGear = car.gear;
      return car.rpm();
    },
  };
  const transport = new MockTransport({ car: rpmSource });
  await transport.connect();
  const elm = new Elm327(transport, log);
  const poller = new RpmPoller(elm);
  const light = new ShiftLight({ thresholdRpm, leadMs, rateWindowMs });
  const start = Date.now();
  const at = () => `+${((Date.now() - start) / 1000).toFixed(2).padStart(6)} s`;
  const fires: Fire[] = [];
  const pendingChecks: Promise<void>[] = [];

  try {
    await elm.init();
    const rpmCommand = await elm.detectFastRpm();
    console.log(
      `Simulated car: ${scenario}, ${seconds} s, ${elm.version}, using ${rpmCommand}. ` +
        `Threshold ${thresholdRpm} RPM, lead ${leadMs} ms, rate window ${rateWindowMs} ms.\n`,
    );

    let newSample: RpmSample | null = null;
    poller.on('sample', (sample) => {
      newSample = sample;
      if (showSamples) {
        console.log(
          `${at()}  ${sample.rpm.toFixed(0).padStart(5)} RPM  g${measuredGear}  ` +
            bar(sample.rpm, car.redlineRpm),
        );
      }
    });
    poller.on('error', (error) => {
      if (showSamples) console.log(`${at()}    --- ${error.name}`);
    });
    poller.on('state', (state) => console.log(`${at()}  poller ${state}`));
    poller.on('stats', (stats) => {
      console.log(
        `${at()}  ── ${stats.samplesPerSec.toFixed(1)} samples/s, round trip avg ` +
          `${stats.avgRttMs.toFixed(0)} / p95 ${stats.p95RttMs.toFixed(0)} ms, ` +
          `errors ${stats.errors} ──`,
      );
    });

    // The "screen": every frame, feed the newest sample (or null) to the shift light.
    let wasActive = false;
    let wasStale = true;
    const frameTimer = setInterval(() => {
      const now = Date.now();
      const state = light.update(newSample, now);
      newSample = null;

      if (state.stale !== wasStale) {
        console.log(`${at()}  ${state.stale ? 'NO DATA' : 'data OK'}`);
        wasStale = state.stale;
      }
      if (state.active && !wasActive) {
        const gear = car.gear;
        const trueNow = car.rpm();
        const sampled = state.rpm ?? 0;
        const firedAt = at();
        pendingChecks.push(
          sleep(leadMs).then(() => {
            const trueAtLead = car.rpm();
            const error = trueAtLead - thresholdRpm;
            fires.push({ gear, error });
            console.log(
              `${firedAt}  LIGHT ON   g${gear}  sampled ${sampled.toFixed(0)}  ` +
                `true ${trueNow.toFixed(0)}  true+${leadMs}ms ${trueAtLead.toFixed(0)} ` +
                `(${signed(error)})`,
            );
          }),
        );
      } else if (!state.active && wasActive) {
        console.log(`${at()}  light off  g${car.gear}  ${car.rpm().toFixed(0)} RPM`);
      }
      wasActive = state.active;
    }, FRAME_MS);

    poller.start();
    await sleep(seconds * 1000);
    poller.stop();
    clearInterval(frameTimer);
    await Promise.all(pendingChecks);

    console.log(
      `\nLight fired ${fires.length} times (threshold ${thresholdRpm}, lead ${leadMs} ms)`,
    );
    if (fires.length > 0) {
      const abs = fires.map((f) => Math.abs(f.error));
      const mean = fires.reduce((sum, f) => sum + f.error, 0) / fires.length;
      console.log(
        `Error at fire + lead: mean ${signed(mean)} RPM, max |error| ${Math.max(...abs).toFixed(0)} RPM`,
      );
      const byGear = new Map<number, number[]>();
      for (const f of fires) byGear.set(f.gear, [...(byGear.get(f.gear) ?? []), f.error]);
      for (const [gear, errors] of [...byGear].sort((a, b) => a[0] - b[0])) {
        console.log(`  g${gear}: ${errors.map(signed).join(', ')}`);
      }
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? `${error.name}: ${error.message}` : error}`);
    process.exitCode = 1;
  } finally {
    poller.stop();
    elm.dispose();
    await transport.disconnect();
  }
}

void main();
