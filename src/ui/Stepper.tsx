import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from './theme';

interface Props {
  label: string;
  value: number;
  unit: string;
  /** Change per tap. */
  step: number;
  /** Change per long press. */
  longStep: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

/** − value + control. Tap changes by `step`, long press by `longStep`. */
export const Stepper = memo(function Stepper({
  label,
  value,
  unit,
  step,
  longStep,
  onChange,
  disabled = false,
}: Props) {
  const button = (sign: 1 | -1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${sign > 0 ? 'Increase' : 'Decrease'} ${label}`}
      disabled={disabled}
      onPress={() => onChange(value + sign * step)}
      onLongPress={() => onChange(value + sign * longStep)}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.buttonText}>{sign > 0 ? '+' : '−'}</Text>
    </Pressable>
  );

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {button(-1)}
      <Text style={styles.value}>
        {value}
        <Text style={styles.unit}> {unit}</Text>
      </Text>
      {button(1)}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  label: {
    color: colors.muted,
    fontSize: 16,
    flex: 1,
  },
  button: {
    width: 52,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: colors.border,
  },
  disabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '600',
  },
  value: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    minWidth: 96,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  unit: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '400',
  },
});
