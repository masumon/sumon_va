import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text } from '../ui/AppText';
import { AppIcon } from '../ui/AppIcon';
import type { IconName } from '../ui/AppKit';
import { useAppPreferences } from '../app/AppPreferences';
import { radius, spacing } from '../theme';

/** The big card at the top of a screen: an icon, a headline, a line of context, and room for chips or numbers. One look for every screen. */
export function Hero({ icon, eyebrow, title, subtitle, right, children }: { icon?: IconName; eyebrow?: string; title: string; subtitle?: string; right?: ReactNode; children?: ReactNode }) {
  const { themeMode, colors, design } = useAppPreferences();
  // Each design theme has its own gradient; low light uses a warm near-black so nothing glares in a dark room.
  const grad: [string, string] = design.heroGrad;
  const ink = themeMode === 'dim' ? colors.textPrimary : '#FFFFFF';
  const soft = themeMode === 'dim' ? colors.textSecondary : 'rgba(255,255,255,0.78)';
  return (
    <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.card, { borderRadius: design.radiusHero }, design.heroShadow ?? undefined]}>
      <View style={styles.top}>
        {icon ? <View style={styles.icon}><AppIcon name={icon} size={26} color={ink} /></View> : null}
        <View style={{ flex: 1 }}>
          {eyebrow ? <Text style={[styles.eyebrow, { color: soft }]}>{eyebrow}</Text> : null}
          <Text style={[styles.title, { color: ink }]}>{title}</Text>
          {subtitle ? <Text style={[styles.sub, { color: soft }]}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children ? <View style={{ marginTop: spacing.smd }}>{children}</View> : null}
    </LinearGradient>
  );
}

/** A number inside a Hero ("12 waiting"). */
export function HeroStat({ value, label }: { value: string; label: string }) {
  const { themeMode, colors } = useAppPreferences();
  const ink = themeMode === 'dim' ? colors.textPrimary : '#FFFFFF';
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: ink }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: themeMode === 'dim' ? colors.textSecondary : 'rgba(255,255,255,0.75)' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, padding: spacing.md + 2 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
  icon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 12, marginBottom: 2, letterSpacing: 0.3 },
  title: { fontSize: 20, fontWeight: '800' },
  sub: { fontSize: 13, marginTop: 2 },
  stat: { flex: 1, minWidth: 72 },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12 },
});
