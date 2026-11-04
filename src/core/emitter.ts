/**
 * A tiny typed event emitter. `Events` maps event names to payload types, e.g.
 * `type Events = { sample: RpmSample; state: PollerState }`. Pure TS, so it works in Node and
 * React Native alike (Node's `events` module does not exist in React Native).
 */
export class Emitter<Events extends object> {
  private listeners: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};

  /** Subscribe to one event. Returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners[event];
    if (!set) {
      set = new Set();
      this.listeners[event] = set;
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    for (const listener of [...set]) listener(payload);
  }

  /** Remove all listeners. */
  clear(): void {
    this.listeners = {};
  }
}
