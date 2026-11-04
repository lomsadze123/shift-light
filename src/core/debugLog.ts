export type DebugDirection = 'tx' | 'rx' | 'info' | 'error';

export interface DebugEntry {
  /** Milliseconds timestamp from the injected clock. */
  t: number;
  dir: DebugDirection;
  text: string;
}

/** Make control characters readable in logs: \r → ⏎, \n → ␊. */
export function showControlChars(text: string): string {
  return text.replace(/\r/g, '⏎').replace(/\n/g, '␊');
}

/**
 * Keeps the last `capacity` raw TX/RX lines and notes, so the UI (and you) can see exactly
 * what went over the wire. Oldest entries are dropped once full.
 */
export class DebugLog {
  private items: DebugEntry[] = [];
  private readonly listeners = new Set<(entry: DebugEntry) => void>();

  constructor(
    private readonly capacity = 300,
    private readonly now: () => number = () => Date.now(),
  ) {}

  add(dir: DebugDirection, text: string): void {
    const entry: DebugEntry = { t: this.now(), dir, text };
    this.items.push(entry);
    if (this.items.length > this.capacity) this.items.shift();
    for (const listener of [...this.listeners]) listener(entry);
  }

  /** A copy of the stored entries, oldest first. */
  entries(): DebugEntry[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }

  /** Called for every new entry. Returns an unsubscribe function. */
  subscribe(listener: (entry: DebugEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
