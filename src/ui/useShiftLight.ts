import { useCallback, useEffect, useRef, useState } from 'react';

import { DebugLog } from '../core/debugLog';
import { Elm327 } from '../core/elm327';
import { type PollerStats, RpmPoller, type RpmSample } from '../core/rpmPoller';
import type { Settings } from '../core/settings';
import { ShiftLight } from '../core/shiftLight';
import type { Transport } from '../core/transport';
import { MockTransport } from '../transports/mock';
import { SimulatedCar } from '../transports/simulatedCar';
import { TcpTransport } from '../transports/tcp';
import { createNativeSocket } from '../transports/tcpNative';

export type ConnectionKind = 'mock' | 'tcp' | 'ble';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'lost' | 'failed';

/** What the screen shows. Changes only when something visible changes. */
export interface ShiftLightView {
  /** Rounded to 10 RPM so the digits don't flicker; null = NO DATA. */
  rpm: number | null;
  active: boolean;
  stale: boolean;
}

interface Pipeline {
  transport: Transport;
  elm: Elm327;
  poller: RpmPoller;
  unsubscribers: (() => void)[];
}

function message(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

const TCP_HINT =
  'Is the emulator running with "elm -n 35000 -i 0.0.0.0", on the same Wi-Fi, ' +
  'and is Local Network access allowed for this app (Settings → Privacy)?';

/** Build the transport for a connection kind, or explain why it can't be built. */
function createTransport(
  kind: ConnectionKind,
  settings: Settings,
): { transport: Transport; label: string } | { error: string } {
  switch (kind) {
    case 'mock': {
      // Let the mock driver shift a bit above the threshold, so it is always crossed.
      const car = new SimulatedCar({
        scenario: 'pull',
        shiftRpm: Math.min(settings.thresholdRpm + 400, 6700),
      });
      return { transport: new MockTransport({ car }), label: 'the simulated car' };
    }
    case 'tcp':
      if (settings.tcpHost === '') return { error: "Enter the emulator's IP address" };
      return {
        transport: new TcpTransport(settings.tcpHost, settings.tcpPort, createNativeSocket),
        label: `${settings.tcpHost}:${settings.tcpPort}`,
      };
    case 'ble':
      return { error: 'BLE is not available yet' };
  }
}

/**
 * Owns the whole pipeline: transport → Elm327 → RpmPoller → ShiftLight.
 *
 * The pipeline objects live in refs (changing them must not re-render). A frame loop feeds new
 * samples to the ShiftLight and only sets React state when the displayed values change.
 */
export function useShiftLight(settings: Settings) {
  const [debugLog] = useState(() => new DebugLog());
  const [light] = useState(() => new ShiftLight({ ...settings }));
  const pipeline = useRef<Pipeline | null>(null);
  const pendingSamples = useRef<RpmSample[]>([]);
  const attempt = useRef(0); // bumped by disconnect() to cancel a connect in progress
  const settingsRef = useRef(settings);

  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PollerStats | null>(null);
  const [view, setView] = useState<ShiftLightView>({ rpm: null, active: false, stale: true });

  // Settings can change at any time (threshold buttons, advanced section).
  useEffect(() => {
    settingsRef.current = settings;
    light.setConfig({
      thresholdRpm: settings.thresholdRpm,
      leadMs: settings.leadMs,
      hysteresisRpm: settings.hysteresisRpm,
    });
  }, [light, settings]);

  // Frame loop: every screen frame, feed new samples (or none) to the shift light.
  useEffect(() => {
    let frame = 0;
    let shown: ShiftLightView = { rpm: null, active: false, stale: true };
    const tick = () => {
      const now = Date.now();
      const samples = pendingSamples.current;
      pendingSamples.current = [];
      // Usually 0 or 1 new sample per frame; feed every one so none is lost.
      let state = light.update(samples[0] ?? null, now);
      for (let i = 1; i < samples.length; i++) state = light.update(samples[i], now);

      const rpm = state.rpm === null ? null : Math.round(state.rpm / 10) * 10;
      if (rpm !== shown.rpm || state.active !== shown.active || state.stale !== shown.stale) {
        shown = { rpm, active: state.active, stale: state.stale };
        setView(shown);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [light]);

  const teardown = useCallback(() => {
    const current = pipeline.current;
    if (!current) return;
    pipeline.current = null;
    for (const unsubscribe of current.unsubscribers) unsubscribe();
    current.poller.stop();
    current.elm.dispose();
    void current.transport.disconnect();
    pendingSamples.current = [];
    light.reset();
    setStats(null);
  }, [light]);

  const connect = useCallback(
    async (kind: ConnectionKind) => {
      if (pipeline.current) return;
      const created = createTransport(kind, settingsRef.current);
      if ('error' in created) {
        setConnection('failed');
        setError(created.error);
        return;
      }

      const myAttempt = ++attempt.current;
      setConnection('connecting');
      setError(null);
      debugLog.add('info', `Connecting to ${created.label}`);

      const { transport } = created;
      const elm = new Elm327(transport, debugLog);

      try {
        await transport.connect();
        await elm.init();
        await elm.detectFastRpm();
      } catch (err) {
        elm.dispose();
        void transport.disconnect();
        if (myAttempt !== attempt.current) return;
        debugLog.add('error', `Connect failed: ${message(err)}`);
        setConnection('failed');
        setError(kind === 'tcp' ? `${message(err)}\n${TCP_HINT}` : message(err));
        return;
      }

      if (myAttempt !== attempt.current) {
        // disconnect() was pressed while we were connecting
        elm.dispose();
        void transport.disconnect();
        return;
      }

      const poller = new RpmPoller(elm);
      const unsubscribers = [
        poller.on('sample', (sample) => {
          pendingSamples.current.push(sample);
        }),
        poller.on('stats', setStats),
        poller.on('state', (state) => {
          if (state !== 'disconnected') return;
          debugLog.add('error', 'Connection lost');
          teardown();
          setConnection('lost');
          setError('Connection lost');
        }),
      ];
      pipeline.current = { transport, elm, poller, unsubscribers };
      light.reset();
      poller.start();
      setConnection('connected');
    },
    [debugLog, light, teardown],
  );

  const disconnect = useCallback(() => {
    attempt.current++;
    teardown();
    setConnection('disconnected');
    setError(null);
    debugLog.add('info', 'Disconnected');
  }, [debugLog, teardown]);

  // Leaving the screen: stop everything.
  useEffect(() => teardown, [teardown]);

  return { ...view, connection, error, stats, debugLog, connect, disconnect };
}
