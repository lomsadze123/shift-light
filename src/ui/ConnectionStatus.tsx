import { memo } from 'react';
import { StyleSheet, Text } from 'react-native';

import type { PollerStats } from '../core/rpmPoller';
import { colors } from './theme';
import type { ConnectionState } from './useShiftLight';

interface Props {
  connection: ConnectionState;
  stats: PollerStats | null;
  error: string | null;
}

const LABELS: Record<ConnectionState, string> = {
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  lost: 'Connection lost',
  failed: 'Connection failed',
};

/** One line: state, sample rate, round-trip time, errors. */
export const ConnectionStatus = memo(function ConnectionStatus({
  connection,
  stats,
  error,
}: Props) {
  const bad = connection === 'lost' || connection === 'failed';
  const parts = [LABELS[connection]];
  if (connection === 'connected' && stats) {
    parts.push(
      `${stats.samplesPerSec.toFixed(1)} Hz`,
      `${stats.avgRttMs.toFixed(0)} ms (p95 ${stats.p95RttMs.toFixed(0)})`,
      `${stats.errors} err`,
    );
  }

  return (
    <Text style={[styles.text, bad && styles.bad]} numberOfLines={2}>
      {parts.join(' · ')}
      {bad && error ? `\n${error}` : ''}
    </Text>
  );
});

const styles = StyleSheet.create({
  text: {
    color: colors.muted,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  bad: {
    color: colors.error,
  },
});
