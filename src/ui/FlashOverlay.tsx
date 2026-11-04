import { useEffect, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';

import { colors } from './theme';

/** Flash rate. Photosensitivity rule (PLAN.md, Section 7): must stay at 3 Hz or slower. */
export const FLASH_HZ = 2.5;

/**
 * Full-screen flashing layer. Rendered behind the content, so the white RPM digits stay
 * readable on the red. Hard on/off steps (no fade) give the strongest signal.
 */
export function FlashOverlay({ active }: { active: boolean }) {
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active) {
      opacity.setValue(0);
      return;
    }
    const halfPeriodMs = 1000 / FLASH_HZ / 2;
    const step = (toValue: number) =>
      Animated.timing(opacity, { toValue, duration: 0, useNativeDriver: true });
    // The native driver runs the animation on the UI thread: smooth even when JS is busy.
    const loop = Animated.loop(
      Animated.sequence([
        step(1),
        Animated.delay(halfPeriodMs),
        step(0),
        Animated.delay(halfPeriodMs),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      opacity.setValue(0);
    };
  }, [active, opacity]);

  return <Animated.View style={[styles.flash, { opacity }]} />;
}

const styles = StyleSheet.create({
  flash: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.flash,
    pointerEvents: 'none',
  },
});
