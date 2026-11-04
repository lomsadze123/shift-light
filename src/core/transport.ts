/**
 * A byte pipe to an ELM327 adapter (real BLE adapter, TCP emulator or simulated car).
 *
 * Everything above the transport (driver, poller, shift-light logic, UI) only talks to this
 * interface, so swapping the mock for the emulator or the real car changes nothing else.
 *
 * Data arrives in arbitrary chunks: one `onData` call is NOT one answer. Framing on the `>`
 * prompt is the driver's job.
 */
export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(text: string): Promise<void>;
  /** Subscribe to incoming text chunks. Returns an unsubscribe function. */
  onData(listener: (chunk: string) => void): () => void;
  /** Called once when the connection ends; `error` is set if it ended because of a failure. */
  onClose(listener: (error?: Error) => void): () => void;
  readonly isConnected: boolean;
}
