import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { AppText as Text } from '../ui/AppText';
import { AppIcon } from '../ui/AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { spacing } from '../theme';
import { notify } from '../../modules/va-bridge';
import { useHealth } from './useHealth';

/** A strip under the header that appears the moment something is wrong, says what, and opens the Health screen. */
export function HealthBanner() {
  const { colors, language } = useAppPreferences();
  const bn = language === 'bn';
  const pathname = usePathname();
  const { issues } = useHealth();
  const problems = issues.filter((i) => i.severity !== 'info');
  const critical = problems.some((i) => i.severity === 'critical');
  const seen = useRef<Set<string> | null>(null);
  const styles = useMemo(() => StyleSheet.create({
    bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 40, paddingVertical: 6 },
  }), []);

  // A NEW serious problem also rings a normal notification, so it is noticed even when the app is in your pocket.
  useEffect(() => {
    const keys = new Set(issues.filter((i) => i.severity === 'critical').map((i) => i.key));
    if (seen.current) {
      for (const i of issues) if (i.severity === 'critical' && !seen.current.has(i.key)) notify('p3', `⚠ ${bn ? i.bn : i.en}\n${bn ? i.whyBn : i.whyEn}`, `problem-${i.key}`);
    }
    seen.current = keys;
  }, [issues, bn]);

  if (!problems.length || pathname === '/health') return null;
  const first = problems[0]!;
  const bg = critical ? colors.danger : colors.warning;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'সমস্যার বিস্তারিত' : 'Problem details'} onPress={() => router.push('/health' as never)} style={[styles.bar, { backgroundColor: bg }]}>
      <AppIcon name={critical ? 'alert-circle' : 'alert'} size={20} color="#FFFFFF" />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>
          {problems.length > 1 ? (bn ? `${problems.length}টি সমস্যা — ` : `${problems.length} problems — `) : ''}{bn ? first.bn : first.en}
        </Text>
      </View>
      <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>{bn ? 'দেখুন ›' : 'View ›'}</Text>
    </Pressable>
  );
}
