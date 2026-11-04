import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { SoftIcon } from './SoftIcon';
import type { IconName } from '../ui/AppKit';
import { useAppPreferences } from '../app/AppPreferences';
import { border, radius, spacing, type AccentRole, type ThemeColors } from '../theme';

/** One number with a label and an icon. Dashboard tiles and channel tiles all use this, so counts always look the same. */
export function StatTile({ label, value, icon, tone, onPress }: { label: string; value: string; icon: IconName; tone?: AccentRole; onPress?: () => void }) {
  const { colors } = useAppPreferences();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const body = (
    <View style={[styles.tile, tone && { backgroundColor: tone.soft, borderColor: tone.border }]}>
      <View style={styles.top}>
        <SoftIcon name={icon} size={32} color={tone ? tone.on : colors.primary} />
        <Text style={[styles.value, tone && { color: tone.on }]}>{value}</Text>
      </View>
      <Text numberOfLines={2} style={[styles.label, tone && { color: tone.on }]}>{label}</Text>
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${value}`} onPress={onPress} style={({ pressed }) => [styles.cell, pressed && { opacity: 0.9 }]}>{body}</Pressable> : <View style={styles.cell}>{body}</View>;
}

export function TileGrid({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smd }}>{children}</View>;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  cell: { flexBasis: '47%', flexGrow: 1 },
  tile: { padding: spacing.md, minHeight: 84, borderRadius: radius.card, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'space-between', gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  value: { color: colors.textPrimary, fontSize: 26, fontWeight: '800' },
  label: { color: colors.textSecondary, fontSize: 13 },
});
