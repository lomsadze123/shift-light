import { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import type { Settings } from '../core/settings';
import { colors, spacing } from './theme';

interface Props {
  host: string;
  port: number;
  onChange: (changes: Partial<Settings>) => void;
  disabled?: boolean;
}

/**
 * Emulator address for the TCP connection. Edits stay local while typing and are saved
 * (sanitized) when the field loses focus or you press return.
 */
export const TcpSettings = memo(function TcpSettings({ host, port, onChange, disabled }: Props) {
  const [hostText, setHostText] = useState(host);
  const [portText, setPortText] = useState(String(port));

  // Show the saved values again if they change from outside (e.g. loaded from storage).
  useEffect(() => setHostText(host), [host]);
  useEffect(() => setPortText(String(port)), [port]);

  const saveHost = () => onChange({ tcpHost: hostText });
  const savePort = () => {
    const value = Number(portText);
    if (Number.isFinite(value) && portText.trim() !== '') onChange({ tcpPort: value });
    else setPortText(String(port));
  };

  return (
    <View style={styles.row}>
      <View style={styles.hostField}>
        <Text style={styles.label}>Emulator IP</Text>
        <TextInput
          value={hostText}
          onChangeText={setHostText}
          onBlur={saveHost}
          onSubmitEditing={saveHost}
          placeholder="192.168.x.x"
          placeholderTextColor={colors.disabled}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          editable={!disabled}
          style={[styles.input, disabled && styles.disabled]}
        />
      </View>
      <View style={styles.portField}>
        <Text style={styles.label}>Port</Text>
        <TextInput
          value={portText}
          onChangeText={setPortText}
          onBlur={savePort}
          onSubmitEditing={savePort}
          keyboardType="number-pad"
          returnKeyType="done"
          editable={!disabled}
          style={[styles.input, disabled && styles.disabled]}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  hostField: {
    flex: 3,
  },
  portField: {
    flex: 1,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: spacing.xs,
  },
  input: {
    color: colors.text,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  disabled: {
    opacity: 0.5,
  },
});
