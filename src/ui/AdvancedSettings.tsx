import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Settings } from '../core/settings';
import { Stepper } from './Stepper';
import { colors, spacing } from './theme';

interface Props {
  settings: Settings;
  onChange: (changes: Partial<Settings>) => void;
  disabled?: boolean;
}

/** Calibration knobs for the in-car tuning (Phase 8). Hidden by default. */
export const AdvancedSettings = memo(function AdvancedSettings({
  settings,
  onChange,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)} style={styles.toggle}>
        <Text style={styles.toggleText}>{open ? '▾' : '▸'} Advanced</Text>
      </Pressable>
      {open && (
        <View>
          <Stepper
            label="Lead time"
            value={settings.leadMs}
            unit="ms"
            step={10}
            longStep={50}
            onChange={(leadMs) => onChange({ leadMs })}
            disabled={disabled}
          />
          <Text style={styles.help}>Light too late → increase. Too early → decrease.</Text>
          <Stepper
            label="Hysteresis"
            value={settings.hysteresisRpm}
            unit="RPM"
            step={50}
            longStep={100}
            onChange={(hysteresisRpm) => onChange({ hysteresisRpm })}
            disabled={disabled}
          />
          <Text style={styles.help}>How far RPM must drop before the light can turn off.</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  toggle: {
    paddingVertical: spacing.sm,
  },
  toggleText: {
    color: colors.muted,
    fontSize: 16,
  },
  help: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
});
