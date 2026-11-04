import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { SoftIcon } from './SoftIcon';
import type { IconName } from '../ui/AppKit';
import { useAppPreferences } from '../app/AppPreferences';
import { border, spacing, type AccentRole, type ThemeColors } from '../theme';
import type { DesignTokens } from '../theme/designs';

/** One number with a label and an icon. Dashboard tiles and channel tiles all use this, so counts always look the same. */
export function StatTile({ label, value, icon, tone, onPress }: { label: string; value: string; icon: IconName; tone?: AccentRole; onPress?: () => void }) {
  const { colors, design } = useAppPreferences();
  const styles = useMemo(() => makeStyles(colors, design), [colors, design]);
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

const makeStyles = (colors: ThemeColors, design: DesignTokens) => StyleSheet.create({
  cell: { flexBasis: '47%', flexGrow: 1 },
  tile: { padding: spacing.md, minHeight: 84, borderRadius: design.radiusCard, borderWidth: border.thin, borderColor: design.cardBorder, backgroundColor: design.cardFill, justifyContent: 'space-between', gap: 6, ...(design.shadow ?? {}) },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  value: { color: colors.textPrimary, fontSize: 26, fontWeight: '800' },
  label: { color: colors.textSecondary, fontSize: 13 },
});
