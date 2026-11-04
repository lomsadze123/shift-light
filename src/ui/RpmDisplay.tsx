import { memo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { colors } from './theme';

interface Props {
  /** null = no data. */
  rpm: number | null;
  thresholdRpm: number;
  landscape: boolean;
}

/** The big number. Shows NO DATA whenever there is no fresh RPM (fail-safe). */
export const RpmDisplay = memo(function RpmDisplay({ rpm, thresholdRpm, landscape }: Props) {
  const { width, height } = useWindowDimensions();
  // Size for ~4 digits in the space the layout gives this view.
  const available = landscape ? width * 0.6 : width;
  const fontSize = Math.min(available * 0.3, height * (landscape ? 0.45 : 0.22));
  const noData = rpm === null;

  return (
    <View style={styles.container}>
      <Text
        style={[styles.rpm, { fontSize }, noData && styles.noData]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {noData ? 'NO DATA' : rpm}
      </Text>
      <Text style={styles.caption}>
        {noData ? 'no fresh RPM' : 'RPM'} · shift at {thresholdRpm}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rpm: {
    color: colors.text,
    fontWeight: '800',
    fontVariant: ['tabular-nums'], // equal-width digits: the number doesn't jump around
  },
  noData: {
    color: colors.error,
    fontWeight: '700',
  },
  caption: {
    color: colors.muted,
    fontSize: 18,
  },
});
