import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type DebugEntry, type DebugLog, showControlChars } from '../core/debugLog';
import { colors, monospace, spacing } from './theme';

const MAX_LINES = 60;
const REFRESH_MS = 250; // at most 4 re-renders per second, however busy the link is

const DIR_COLORS: Record<DebugEntry['dir'], string> = {
  tx: colors.accent,
  rx: colors.text,
  info: colors.muted,
  error: colors.error,
};

/** Toggleable view of the last raw TX/RX lines. Newest first. */
export const DebugPanel = memo(function DebugPanel({ log }: { log: DebugLog }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<DebugEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    const refresh = () => setEntries(log.entries().slice(-MAX_LINES).reverse());
    refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = log.subscribe(() => {
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          refresh();
        }, REFRESH_MS);
      }
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [log, open]);

  return (
    <View>
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)} style={styles.toggle}>
        <Text style={styles.toggleText}>{open ? '▾' : '▸'} Debug</Text>
      </Pressable>
      {open && (
        <View style={styles.panel}>
          {entries.length === 0 && <Text style={styles.line}>(nothing yet)</Text>}
          {entries.map((entry, i) => (
            <Text
              key={`${entry.t}-${i}`}
              style={[styles.line, { color: DIR_COLORS[entry.dir] }]}
              numberOfLines={1}
            >
              {entry.dir.padEnd(5)} {showControlChars(entry.text)}
            </Text>
          ))}
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
  panel: {
    backgroundColor: colors.panel,
    borderRadius: 8,
    padding: spacing.sm,
  },
  line: {
    ...monospace,
    color: colors.text,
    fontSize: 11,
  },
});
