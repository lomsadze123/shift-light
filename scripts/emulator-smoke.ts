/**
 * Phase 1 smoke test: talk to the ELM327 emulator over TCP and print the raw answers.
 *
 *   Terminal 1: elm -n 35000
 *   Terminal 2: npm run emu:smoke            (or: npm run emu:smoke -- <host> <port>)
 *
 * The send-and-wait-for-'>' helper here is deliberately simple and temporary. The Elm327
 * driver (Phase 2) replaces it with a proper queue, error mapping and the command allowlist.
 */
import type { Transport } from '../src/core/transport';
import { TcpTransport } from '../src/transports/tcp';
import { createNodeSocket } from '../src/transports/tcpNode';

const host = process.argv[2] ?? 'localhost';
const port = Number(process.argv[3] ?? 35000);

// [command, timeout in ms]. ATZ resets the adapter and is slow on real hardware.
const COMMANDS: [string, number][] = [
  ['ATZ', 5000],
  ['ATE0', 2000],
  ['ATS0', 2000],
  ['010C', 5000],
];

/** Make control characters visible: \r → ⏎, \n → ␊. */
function visible(text: string): string {
  return text.replace(/\r/g, '⏎').replace(/\n/g, '␊');
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Node may report a refused connection as an AggregateError with an empty message.
  const code = (error as NodeJS.ErrnoException).code;
  return error.message || code || error.name;
}

interface Answer {
  text: string;
  chunks: number;
  ms: number;
}

/** Send one command and collect chunks until the '>' prompt arrives. */
function sendAndWait(transport: Transport, command: string, timeoutMs: number): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let buffer = '';
    let chunks = 0;

    const unsubscribe = transport.onData((chunk) => {
      buffer += chunk;
      chunks++;
      if (buffer.includes('>')) {
        clearTimeout(timer);
        unsubscribe();
        resolve({ text: buffer, chunks, ms: performance.now() - start });
      }
    });

    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`No '>' within ${timeoutMs} ms. Received so far: "${visible(buffer)}"`));
    }, timeoutMs);

    transport.write(`${command}\r`).catch((error: unknown) => {
      clearTimeout(timer);
      unsubscribe();
      reject(error);
    });
  });
}

async function main(): Promise<void> {
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
  console.log('Connected.\n');

  transport.onClose((error) => {
    if (error) console.error(`Connection closed: ${describeError(error)}`);
  });

  try {
    for (const [command, timeoutMs] of COMMANDS) {
      console.log(`TX ${command}`);
      const answer = await sendAndWait(transport, command, timeoutMs);
      const chunkWord = answer.chunks === 1 ? 'chunk' : 'chunks';
      console.log(
        `RX "${visible(answer.text)}"  (${answer.ms.toFixed(0)} ms, ${answer.chunks} ${chunkWord})\n`,
      );
    }
  } catch (error) {
    console.error(`Error: ${describeError(error)}`);
    process.exitCode = 1;
  } finally {
    await transport.disconnect();
  }
}

void main();
