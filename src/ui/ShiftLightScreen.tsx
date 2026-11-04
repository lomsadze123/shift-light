import { useKeepAwake } from 'expo-keep-awake';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdvancedSettings } from './AdvancedSettings';
import { ConnectionPicker } from './ConnectionPicker';
import { ConnectionStatus } from './ConnectionStatus';
import { DebugPanel } from './DebugPanel';
import { FlashOverlay } from './FlashOverlay';
import { RpmDisplay } from './RpmDisplay';
import { useSettings } from './settings';
import { colors, spacing } from './theme';
import { ThresholdControl } from './ThresholdControl';
import { useBeep } from './useBeep';
import { useShiftLight } from './useShiftLight';

/** The one and only screen. Landscape: RPM left, controls right. Portrait: stacked. */
export function ShiftLightScreen() {
  useKeepAwake(); // the screen must never sleep while this is shown

  const { settings, loaded, update } = useSettings();
  const shiftLight = useShiftLight(settings);
  useBeep(shiftLight.active);

  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const setThreshold = useCallback((thresholdRpm: number) => update({ thresholdRpm }), [update]);

  // Only the RPM digits and the flash change often. The controls are memo'ed components with
  // stable props, so the ~10 RPM updates per second don't re-render them.
  return (
    <View style={styles.root}>
      <FlashOverlay active={shiftLight.active} />
      <SafeAreaView style={[styles.content, landscape && styles.landscape]}>
        <View style={[styles.rpmArea, landscape && styles.rpmAreaLandscape]}>
          <RpmDisplay
            rpm={shiftLight.rpm}
            thresholdRpm={settings.thresholdRpm}
            landscape={landscape}
          />
        </View>
        <ScrollView
          style={landscape ? styles.controlsLandscape : styles.controls}
          contentContainerStyle={styles.controlsContent}
        >
          <ConnectionPicker
            connection={shiftLight.connection}
            onConnect={shiftLight.connect}
            onDisconnect={shiftLight.disconnect}
          />
          <ConnectionStatus
            connection={shiftLight.connection}
            stats={shiftLight.stats}
            error={shiftLight.error}
          />
          <ThresholdControl
            value={settings.thresholdRpm}
            onChange={setThreshold}
            disabled={!loaded}
          />
          <AdvancedSettings settings={settings} onChange={update} disabled={!loaded} />
          <DebugPanel log={shiftLight.debugLog} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  landscape: {
    flexDirection: 'row',
  },
  rpmArea: {
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  rpmAreaLandscape: {
    flex: 3,
    paddingVertical: 0,
  },
  controls: {
    flex: 1,
  },
  controlsLandscape: {
    flex: 2,
  },
  controlsContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
});
