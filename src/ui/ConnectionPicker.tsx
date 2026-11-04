import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Settings } from '../core/settings';
import { TcpSettings } from './TcpSettings';
import { colors, spacing } from './theme';
import type { ConnectionKind, ConnectionState } from './useShiftLight';

const OPTIONS: { kind: ConnectionKind; label: string; available: boolean; note?: string }[] = [
  { kind: 'mock', label: 'Mock', available: true },
  { kind: 'tcp', label: 'TCP', available: true, note: 'emulator' },
  { kind: 'ble', label: 'BLE', available: false, note: 'Phase 7' },
];

interface Props {
  connection: ConnectionState;
  onConnect: (kind: ConnectionKind) => void;
  onDisconnect: () => void;
  settings: Settings;
  onSettingsChange: (changes: Partial<Settings>) => void;
}

export const ConnectionPicker = memo(function ConnectionPicker({
  connection,
  onConnect,
  onDisconnect,
  settings,
  onSettingsChange,
}: Props) {
  const [kind, setKind] = useState<ConnectionKind>('mock');
  const busy = connection === 'connecting' || connection === 'connected';

  return (
    <View style={styles.container}>
      <View style={styles.segments}>
        {OPTIONS.map((option) => {
          const selected = option.kind === kind;
          const enabled = option.available && !busy;
          return (
            <Pressable
              key={option.kind}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: !enabled }}
              disabled={!enabled}
              onPress={() => setKind(option.kind)}
              style={[styles.segment, selected && styles.selected, !option.available && styles.off]}
            >
              <Text style={[styles.segmentText, selected && styles.selectedText]}>
                {option.label}
              </Text>
              {option.note && <Text style={styles.note}>{option.note}</Text>}
            </Pressable>
          );
        })}
      </View>
      {kind === 'tcp' && (
        <TcpSettings
          host={settings.tcpHost}
          port={settings.tcpPort}
          onChange={onSettingsChange}
          disabled={busy}
        />
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => (busy ? onDisconnect() : onConnect(kind))}
        style={({ pressed }) => [
          styles.action,
          busy && styles.actionStop,
          pressed && styles.actionPressed,
        ]}
      >
        <Text style={styles.actionText}>
          {connection === 'connecting' ? 'Cancel' : busy ? 'Disconnect' : 'Connect'}
        </Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  segments: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  selected: {
    borderColor: colors.accent,
  },
  off: {
    opacity: 0.4,
  },
  segmentText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  selectedText: {
    color: colors.accent,
  },
  note: {
    color: colors.muted,
    fontSize: 10,
  },
  action: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: colors.ok,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionStop: {
    backgroundColor: colors.border,
  },
  actionPressed: {
    opacity: 0.7,
  },
  actionText: {
    color: colors.background,
    fontSize: 18,
    fontWeight: '700',
  },
});
