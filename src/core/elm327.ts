import { type DebugLog, showControlChars } from './debugLog';
import {
  AdapterError,
  BusInitError,
  CanError,
  DisconnectedError,
  ElmError,
  ForbiddenCommandError,
  NoDataError,
  StoppedError,
  TimeoutError,
  UnableToConnectError,
  UnsupportedCommandError,
} from './elm327Errors';
import { parseRpm } from './rpm';
import type { Transport } from './transport';

// ---------------------------------------------------------------------------------------------
// Safety allowlist (PLAN.md, Section 7). The app is read-only: anything not listed here is
// rejected BEFORE it reaches the adapter. Do not weaken this.
// ---------------------------------------------------------------------------------------------

const ALLOWED_AT_COMMANDS = new Set([
  'ATZ', // reset
  'ATWS', // warm start
  'ATI', // version
  'ATE0', // echo off / on
  'ATE1',
  'ATL0', // linefeeds off / on
  'ATL1',
  'ATS0', // spaces off / on
  'ATS1',
  'ATH0', // headers off / on
  'ATH1',
  'ATSP0', // automatic protocol
  'ATAT0', // adaptive timing off / normal / aggressive
  'ATAT1',
  'ATAT2',
  'ATRV', // battery voltage
  'ATDPN', // protocol number
]);

const ALLOWED_PATTERNS = [
  /^ATST[0-9A-F]{2}$/, // response timeout
  /^01[0-9A-F]{2}[1-9A-F]?$/, // mode 01 (live data), optional expected-response count
  /^09[0-9A-F]{2}$/, // mode 09 (vehicle info, e.g. VIN)
];

/**
 * Canonical form of a command: surrounding spaces removed, uppercase. Returns null if it
 * contains anything other than letters and digits, including \r or \n anywhere. That blocks
 * "010C\r04" (two commands in one string) and any other trick to smuggle a second command
 * past the allowlist.
 */
export function normalizeCommand(command: string): string | null {
  const normalized = command.replace(/^[ \t]+|[ \t]+$/g, '').toUpperCase();
  return /^[A-Z0-9]+$/.test(normalized) ? normalized : null;
}

export function isAllowedCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  if (normalized === null) return false;
  return (
    ALLOWED_AT_COMMANDS.has(normalized) ||
    ALLOWED_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

// ---------------------------------------------------------------------------------------------
// Answer cleanup and error mapping
// ---------------------------------------------------------------------------------------------

type ElmErrorClass = new (message: string, command: string, lines?: readonly string[]) => ElmError;

/** Matched against each answer line with spaces removed and uppercased. */
const ERROR_PATTERNS: [RegExp, ElmErrorClass][] = [
  [/^NODATA$/, NoDataError],
  [/^\?$/, UnsupportedCommandError],
  [/UNABLETOCONNECT/, UnableToConnectError],
  [/CANERROR/, CanError],
  [/BUSINIT.*ERROR/, BusInitError],
  [/^STOPPED$/, StoppedError],
  [/BUSERROR|BUSBUSY|BUFFERFULL|DATAERROR|<RXERROR|FBERROR|LVRESET|^ERR\d+$/, AdapterError],
];

function compact(line: string): string {
  return line.replace(/\s+/g, '').toUpperCase();
}

/** Split into lines and drop empty lines, SEARCHING... and the echoed command. */
function cleanLines(raw: string, command: string): string[] {
  return raw
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => {
      const c = compact(line);
      // Some clones keep echoing even after ATE0, so the echo is removed from every answer.
      return c !== '' && c !== 'SEARCHING...' && c !== command;
    });
}

function mapError(lines: readonly string[], command: string): ElmError | null {
  for (const line of lines) {
    const c = compact(line);
    for (const [pattern, ErrorClass] of ERROR_PATTERNS) {
      if (pattern.test(c)) return new ErrorClass(`${command}: ${line}`, command, lines);
    }
  }
  return null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------------------------

export const DEFAULT_TIMEOUT_MS = 1000;

export interface SendOptions {
  timeoutMs?: number;
}

export interface Elm327Options {
  /** After a timeout, how long to wait for the late answer before sending again. */
  drainMs?: number;
}

export type RpmCommand = '010C1' | '010C';

interface PendingRequest {
  command: string;
  buffer: string;
  resolve: (raw: string) => void;
  reject: (error: Error) => void;
}

/**
 * ELM327 driver on top of any Transport.
 *
 * - One command at a time: commands queue up and the next is written only after the
 *   previous answer's `>` prompt arrived (or it failed).
 * - Answers are collected across chunks until `>`, cleaned, and mapped to typed errors.
 * - Every command passes the safety allowlist before anything is written.
 */
export class Elm327 {
  /** Version line from ATZ, e.g. "ELM327 v1.5". Set by init(). */
  version: string | null = null;
  /** RPM request in use. `010C1` is faster; set by detectFastRpm(). */
  rpmCommand: RpmCommand = '010C';

  private tail: Promise<unknown> = Promise.resolve();
  private pending: PendingRequest | null = null;
  private expectingLateAnswer = false;
  private onLateAnswer: (() => void) | null = null;
  private readonly unsubscribers: (() => void)[];
  private readonly drainMs: number;

  constructor(
    private readonly transport: Transport,
    private readonly log?: DebugLog,
    options: Elm327Options = {},
  ) {
    this.drainMs = options.drainMs ?? 500;
    this.unsubscribers = [
      transport.onData((chunk) => this.handleData(chunk)),
      transport.onClose((error) => this.handleClose(error)),
    ];
  }

  /** Stop listening to the transport. */
  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
  }

  /** Send one command and resolve with its cleaned answer lines. */
  send(command: string, options: SendOptions = {}): Promise<string[]> {
    const normalized = normalizeCommand(command);
    if (normalized === null || !isAllowedCommand(normalized)) {
      const error = new ForbiddenCommandError(
        `Command not allowed: ${JSON.stringify(command)}`,
        command,
      );
      this.log?.add('error', error.message);
      return Promise.reject(error);
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Promise-chain queue: each command starts only after the previous one settled.
    const run = this.tail.then(() => this.execute(normalized, timeoutMs));
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Reset and configure the adapter, then trigger the OBD protocol search. */
  async init(): Promise<void> {
    const reset = await this.send('ATZ', { timeoutMs: 2000 });
    this.version = reset.find((line) => /ELM327/i.test(line)) ?? null;

    for (const command of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0']) {
      await this.send(command);
    }

    try {
      await this.send('ATAT2');
    } catch (error) {
      if (!(error instanceof UnsupportedCommandError)) throw error;
      this.log?.add('info', 'ATAT2 not supported, keeping default timing');
    }

    // The first OBD request starts the protocol search, which can take several seconds.
    await this.send('0100', { timeoutMs: 10000 });
  }

  /** Use `010C1` (returns after the first ECU answers) if it works, else plain `010C`. */
  async detectFastRpm(): Promise<RpmCommand> {
    try {
      const lines = await this.send('010C1');
      if (parseRpm(lines) !== null) {
        this.rpmCommand = '010C1';
        this.log?.add('info', 'Using fast RPM request 010C1');
        return this.rpmCommand;
      }
      this.log?.add('info', '010C1 gave no valid RPM, falling back to 010C');
    } catch (error) {
      if (error instanceof DisconnectedError || !(error instanceof ElmError)) throw error;
      this.log?.add('info', `010C1 failed (${error.name}), falling back to 010C`);
    }
    this.rpmCommand = '010C';
    return this.rpmCommand;
  }

  /** Request RPM once. Resolves null if the answer has no valid RPM. */
  async readRpm(options: SendOptions = {}): Promise<number | null> {
    return parseRpm(await this.send(this.rpmCommand, options));
  }

  private async execute(command: string, timeoutMs: number): Promise<string[]> {
    if (this.expectingLateAnswer) await this.drainLateAnswer();
    if (!this.transport.isConnected) {
      throw new DisconnectedError(`${command}: not connected`, command);
    }

    const raw = await this.exchange(command, timeoutMs);
    const lines = cleanLines(raw, command);
    const error = mapError(lines, command);
    if (error) {
      this.log?.add('error', `${error.name}: ${error.message}`);
      throw error;
    }
    return lines;
  }

  /** Write the command and resolve with the raw text before the `>` prompt. */
  private exchange(command: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending !== request) return;
        this.pending = null;
        // The adapter may still answer later; the next command must not read that answer.
        this.expectingLateAnswer = true;
        const error = new TimeoutError(`${command}: no answer within ${timeoutMs} ms`, command);
        this.log?.add('error', error.message);
        reject(error);
      }, timeoutMs);

      const request: PendingRequest = {
        command,
        buffer: '',
        resolve: (raw) => {
          clearTimeout(timer);
          resolve(raw);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.pending = request;

      this.log?.add('tx', command);
      this.transport.write(`${command}\r`).catch((error: unknown) => {
        if (this.pending !== request) return;
        this.pending = null;
        request.reject(
          this.transport.isConnected
            ? new ElmError(`${command}: write failed: ${describe(error)}`, command)
            : new DisconnectedError(`${command}: ${describe(error)}`, command),
        );
      });
    });
  }

  /** Wait until the late `>` of a timed-out command arrives, or `drainMs` passes. */
  private drainLateAnswer(): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.onLateAnswer = null;
        this.expectingLateAnswer = false;
        resolve();
      };
      const timer = setTimeout(() => {
        this.log?.add('info', `No late answer within ${this.drainMs} ms, continuing`);
        done();
      }, this.drainMs);
      this.onLateAnswer = done;
    });
  }

  private handleData(chunk: string): void {
    const request = this.pending;
    if (!request) {
      // Nothing in flight: a stray prompt at connect, or the late answer after a timeout.
      this.log?.add('rx', `(discarded) ${showControlChars(chunk)}`);
      if (this.expectingLateAnswer && chunk.includes('>')) {
        this.expectingLateAnswer = false;
        this.onLateAnswer?.();
      }
      return;
    }

    request.buffer += chunk;
    const end = request.buffer.indexOf('>');
    if (end === -1) return;

    const raw = request.buffer.slice(0, end);
    this.pending = null;
    for (const line of raw.split(/[\r\n]+/)) {
      const trimmed = line.trim();
      if (trimmed !== '') this.log?.add('rx', trimmed);
    }
    request.resolve(raw);
  }

  private handleClose(error?: Error): void {
    this.log?.add(
      error ? 'error' : 'info',
      error ? `Connection closed: ${error.message}` : 'Connection closed',
    );
    const request = this.pending;
    this.pending = null;
    if (request) {
      const reason = error ? error.message : 'connection closed';
      request.reject(new DisconnectedError(`${request.command}: ${reason}`, request.command));
    }
    this.onLateAnswer?.();
  }
}
