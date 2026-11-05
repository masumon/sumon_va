import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import Animated, { Easing, cancelAnimation, scrollTo, useAnimatedRef, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { AppText as Text } from '../ui/AppText';
import { AppIcon } from '../ui/AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { spacing } from '../theme';
import { notify } from '../../modules/va-bridge';
import { useHealth } from './useHealth';

/** A strip under the header that appears the moment something is wrong, says what, and opens the Health screen. */
const SYNC_KEYS = new Set(['sync-stopped', 'sync-error', 'sync-stale', 'slow', 'offline', 'queued']);

export function HealthBanner() {
  const { colors, language, design } = useAppPreferences();
  const bn = language === 'bn';
  const pathname = usePathname();
  const { issues: all } = useHealth();
  // Sync and connection states live in the header light (green / red / spinning): no strip, no repeated notification for them.
  const issues = all.filter((i) => !SYNC_KEYS.has(i.key));
  const problems = issues.filter((i) => i.severity !== 'info');
  const critical = problems.some((i) => i.severity === 'critical');
  const bd = (n: number) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!);
  const seen = useRef<Set<string> | null>(null);
  const [dismissed, setDismissed] = useState('');
  const styles = useMemo(() => StyleSheet.create({
    card: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 8, height: 48, borderWidth: StyleSheet.hairlineWidth * 2, overflow: 'hidden' },
    edge: { width: 4, alignSelf: 'stretch' },
    main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.sm, height: 48 },
    badge: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    action: { width: 36, height: 36, alignItems: 'center', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth * 2, justifyContent: 'center' },
    close: { width: 40, height: 48, alignItems: 'center', justifyContent: 'center' },
  }), []);

  // A NEW serious problem also rings a normal notification, so it is noticed even when the app is in your pocket.
  useEffect(() => {
    const keys = new Set(issues.filter((i) => i.severity === 'critical').map((i) => i.key));
    if (seen.current) {
      for (const i of issues) if (i.severity === 'critical' && !seen.current.has(i.key)) notify('p3', `⚠ ${bn ? i.bn : i.en}\n${bn ? i.whyBn : i.whyEn}`, `problem-${i.key}`);
    }
    seen.current = keys;
  }, [issues, bn]);

  // Calm, not jumpy: nothing is shown during the first moments after opening (the first checks are still running and would
  // flash a false alarm), and when a strip does appear or go, the screen below eases down or up instead of snapping.
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 5000); return () => clearTimeout(t); }, []);
  const shownCount = ready && (pathname === '/' || pathname === '/inbox') ? problems.length : 0;
  const visible = shownCount > 0;
  useEffect(() => { LayoutAnimation.configureNext(LayoutAnimation.create(260, 'easeInEaseOut', 'opacity')); }, [visible]);
  if (!visible) return null;
  const first = problems[0]!;
  const sig = problems.map((i) => i.key).join('|');
  if (dismissed === sig) return null;
  // Mood follows the message: red for danger, amber for a warning. One calm line in the same glass as the header; a long
  // message slides by itself (pause, glide, pause, back) so nothing is cut off and the bar never grows tall.
  const tone = critical ? colors.danger : colors.warning;
  const tint = (a: string) => (/^#[0-9a-fA-F]{6}$/.test(tone) ? `${tone}${a}` : tone);
  const more = problems.length > 1 ? (bn ? ` (+${bd(problems.length - 1)})` : ` (+${problems.length - 1})`) : '';
  return (
    <View style={[styles.card, { backgroundColor: design.barFill, borderColor: design.barBorder, borderRadius: design.radiusBar }]}>
      <View style={[styles.edge, { backgroundColor: tone }]} />
      <Pressable accessibilityRole="button" accessibilityLabel={`${bn ? first.bn : first.en}. ${bn ? first.whyBn : first.whyEn}`} onPress={() => router.push('/health' as never)} style={styles.main}>
        <View style={[styles.badge, { backgroundColor: tint('26') }]}><AppIcon name={critical ? 'alert-circle-outline' : 'alert-outline'} size={18} color={tone} /></View>
        <MarqueeLine>
          <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 14 }}>{(bn ? first.bn : first.en) + more}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{'   ·   ' + (bn ? first.whyBn : first.whyEn)}</Text>
        </MarqueeLine>
        <View style={[styles.action, { backgroundColor: tint('1F'), borderColor: tint('55') }]}><AppIcon name="eye-outline" size={20} color={tone} /></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'এই সতর্কবার্তা সরান' : 'Dismiss'} onPress={() => setDismissed(sig)} style={styles.close}>
        <AppIcon name="close" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

/** One line of text. If it is wider than the space, it glides to the end and back on its own (no touch needed). */
function MarqueeLine({ children }: { children: ReactNode }) {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const x = useSharedValue(0);
  const [box, setBox] = useState(0);
  const [content, setContent] = useState(0);
  const overflow = Math.max(0, content - box);
  useEffect(() => {
    cancelAnimation(x);
    x.value = 0;
    if (overflow > 4) {
      x.value = withRepeat(withSequence(
        withDelay(1800, withTiming(overflow, { duration: Math.max(2500, overflow * 28), easing: Easing.inOut(Easing.quad) })),
        withDelay(1500, withTiming(0, { duration: 600, easing: Easing.out(Easing.quad) })),
      ), -1);
    }
    return () => cancelAnimation(x);
  }, [overflow, x]);
  useDerivedValue(() => { scrollTo(ref, x.value, 0, false); });
  return (
    <Animated.ScrollView ref={ref} horizontal scrollEnabled={false} pointerEvents="none" showsHorizontalScrollIndicator={false} style={{ flex: 1 }}
      contentContainerStyle={{ alignItems: 'center' }} onLayout={(e) => setBox(e.nativeEvent.layout.width)} onContentSizeChange={(w) => setContent(w)}>
      <Text numberOfLines={1} style={{ flexShrink: 0 }}>{children}</Text>
    </Animated.ScrollView>
  );
}
