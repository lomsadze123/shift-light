// Each class sets `name` explicitly: bundlers may minify class names in release builds.

/** Base class for everything the ELM327 driver can throw. */
export class ElmError extends Error {
  name = 'ElmError';

  constructor(
    message: string,
    /** The command that failed. */
    readonly command: string,
    /** The cleaned answer lines, if an answer arrived. */
    readonly lines: readonly string[] = [],
  ) {
    super(message);
  }
}

/** `NO DATA`: the car did not answer (PID unsupported, or ignition off). */
export class NoDataError extends ElmError {
  name = 'NoDataError';
}

/** `?`: the adapter did not understand the command. */
export class UnsupportedCommandError extends ElmError {
  name = 'UnsupportedCommandError';
}

/** `UNABLE TO CONNECT`: no OBD protocol found (usually ignition off). */
export class UnableToConnectError extends ElmError {
  name = 'UnableToConnectError';
}

/** `CAN ERROR`: problem on the CAN bus. */
export class CanError extends ElmError {
  name = 'CanError';
}

/** `BUS INIT: ...ERROR`: initialising an older (non-CAN) protocol failed. */
export class BusInitError extends ElmError {
  name = 'BusInitError';
}

/** `STOPPED`: the adapter was interrupted, usually by data sent while it was busy. */
export class StoppedError extends ElmError {
  name = 'StoppedError';
}

/** Any other ELM327 failure message (BUFFER FULL, BUS ERROR, ERRxx, ...). */
export class AdapterError extends ElmError {
  name = 'AdapterError';
}

/** No `>` prompt within the timeout. */
export class TimeoutError extends ElmError {
  name = 'TimeoutError';
}

/** Rejected by the safety allowlist. Nothing was sent. */
export class ForbiddenCommandError extends ElmError {
  name = 'ForbiddenCommandError';
}

/** The transport is closed, or closed while waiting for an answer. */
export class DisconnectedError extends ElmError {
  name = 'DisconnectedError';
}
