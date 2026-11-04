/**
 * Run the real core (Elm327 driver) against the simulated car, in Node.
 *
 *   npm run sim                         pull scenario, 15 s
 *   npm run sim -- random 20            scenario and duration in seconds
 *   npm run sim -- cruise 5 -v          -v also prints the raw TX/RX traffic
 */
import { DebugLog, showControlChars } from '../src/core/debugLog';
import { Elm327 } from '../src/core/elm327';
import { MockTransport } from '../src/transports/mock';
import { type Scenario, SimulatedCar } from '../src/transports/simulatedCar';

const SCENARIOS: Scenario[] = ['pull', 'cruise', 'random'];
const BAR_WIDTH = 30;

const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const positional = args.filter((arg) => !arg.startsWith('-'));
const scenario = (positional[0] ?? 'pull') as Scenario;
const seconds = Number(positional[1] ?? 15);

if (!SCENARIOS.includes(scenario) || !(seconds > 0)) {
  console.error(`Usage: npm run sim -- [${SCENARIOS.join('|')}] [seconds] [-v]`);
  process.exit(1);
}

function bar(rpm: number, max: number): string {
  const filled = Math.round(Math.min(rpm / max, 1) * BAR_WIDTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

async function main(): Promise<void> {
  const log = new DebugLog();
  if (verbose) {
    log.subscribe((entry) => console.log(`    [${entry.dir}] ${showControlChars(entry.text)}`));
  }

  const car = new SimulatedCar({ scenario });
  // Remember the gear at the moment the mock measures RPM, not when we print later
  // (the car may have shifted in between).
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

  try {
    await elm.init();
    const rpmCommand = await elm.detectFastRpm();
    console.log(`Simulated car: ${scenario}, ${seconds} s, ${elm.version}, using ${rpmCommand}\n`);

    const start = performance.now();
    const roundTrips: number[] = [];
    let errors = 0;
    let windowStart = start;
    let windowSamples = 0;
    let windowRoundTrips: number[] = [];

    while (performance.now() - start < seconds * 1000) {
      const sent = performance.now();
      let line: string;
      try {
        const rpm = await elm.readRpm();
        const roundTrip = performance.now() - sent;
        roundTrips.push(roundTrip);
        windowRoundTrips.push(roundTrip);
        windowSamples++;
        line =
          rpm === null
            ? 'no RPM in answer'
            : `${rpm.toFixed(0).padStart(5)} RPM  g${measuredGear}  ${bar(rpm, car.redlineRpm)}  ` +
              `(${roundTrip.toFixed(0)} ms)`;
      } catch (error) {
        errors++;
        line = `  --- ${error instanceof Error ? error.name : String(error)}`;
      }
      const at = ((performance.now() - start) / 1000).toFixed(2).padStart(6);
      console.log(`+${at} s  ${line}`);

      const now = performance.now();
      if (now - windowStart >= 1000) {
        const rate = (windowSamples * 1000) / (now - windowStart);
        console.log(
          `          ── ${rate.toFixed(1)} samples/s, avg round trip ` +
            `${average(windowRoundTrips).toFixed(0)} ms, errors so far ${errors} ──`,
        );
        windowStart = now;
        windowSamples = 0;
        windowRoundTrips = [];
      }
    }

    const elapsed = (performance.now() - start) / 1000;
    console.log(
      `\nDone: ${roundTrips.length} samples in ${elapsed.toFixed(1)} s ` +
        `(${(roundTrips.length / elapsed).toFixed(1)} samples/s), ` +
        `avg round trip ${average(roundTrips).toFixed(0)} ms, ${errors} errors`,
    );
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? `${error.name}: ${error.message}` : error}`);
    process.exitCode = 1;
  } finally {
    elm.dispose();
    await transport.disconnect();
  }
}

void main();
