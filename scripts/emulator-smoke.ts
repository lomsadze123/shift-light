/**
 * Smoke test against the ELM327 emulator over TCP: initialize the adapter with the Elm327
 * driver and print 20 RPM readings.
 *
 *   Terminal 1: elm -n 35000
 *   Terminal 2: npm run emu:smoke                 (or: npm run emu:smoke -- [-v] [host] [port])
 *
 * -v prints the raw TX/RX traffic from the DebugLog as it happens.
 */
import { DebugLog, showControlChars } from '../src/core/debugLog';
import { Elm327 } from '../src/core/elm327';
import { TcpTransport } from '../src/transports/tcp';
import { createNodeSocket } from '../src/transports/tcpNode';

const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const positional = args.filter((arg) => !arg.startsWith('-'));
const host = positional[0] ?? 'localhost';
const port = Number(positional[1] ?? 35000);
const READINGS = 20;

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Node may report a refused connection as an AggregateError with an empty message.
  const code = (error as NodeJS.ErrnoException).code;
  const text = error.message || code || '';
  return text ? `${error.name}: ${text}` : error.name;
}

async function main(): Promise<void> {
  const log = new DebugLog();
  if (verbose) {
    log.subscribe((entry) => console.log(`    [${entry.dir}] ${showControlChars(entry.text)}`));
  }

  const transport = new TcpTransport(host, port, createNodeSocket);
  console.log(`Connecting to ${host}:${port} ...`);
  try {
    await transport.connect();
  } catch (error) {
    console.error(`Could not connect: ${describeError(error)}`);
    console.error('Is the emulator running? Start it in another terminal: elm -n 35000');
    process.exitCode = 1;
    return;
  }
  console.log('Connected.');

  const elm = new Elm327(transport, log);
  try {
    console.log('Initializing ...');
    await elm.init();
    console.log(`Adapter: ${elm.version ?? 'unknown'}`);

    const rpmCommand = await elm.detectFastRpm();
    const note = rpmCommand === '010C' ? ' (010C1 not supported, fell back)' : ' (fast mode)';
    console.log(`RPM command: ${rpmCommand}${note}\n`);

    const start = performance.now();
    for (let i = 1; i <= READINGS; i++) {
      const sent = performance.now();
      let result: string;
      try {
        const rpm = await elm.readRpm();
        result = rpm === null ? 'no RPM in answer' : `${rpm.toFixed(0).padStart(5)} RPM`;
      } catch (error) {
        result = describeError(error);
      }
      const done = performance.now();
      const at = `+${(done - start).toFixed(0).padStart(5)} ms`;
      const roundTrip = `(${(done - sent).toFixed(0)} ms)`;
      console.log(`${String(i).padStart(2)}  ${at}  ${result}  ${roundTrip}`);
    }
  } catch (error) {
    console.error(`Error: ${describeError(error)}`);
    process.exitCode = 1;
  } finally {
    elm.dispose();
    await transport.disconnect();
  }
}

void main();
