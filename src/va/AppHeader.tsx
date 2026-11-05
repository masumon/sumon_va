import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { AppText as Text } from '../ui/AppText';
import { AppIcon } from '../ui/AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { border, radius, spacing, type ThemeColors } from '../theme';
import type { DesignTokens } from '../theme/designs';
import { getStatus } from '../../modules/va-bridge';
import { va } from './api';
import { useLoad } from './hooks';
import { titleFor } from './menu';
import { useShell } from './shell';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';


/** The top bar on every signed-in screen: menu, logo and title, connection light, urgent bell, and your initial. */
export function AppHeader() {
  const { colors, language, design } = useAppPreferences();
  const bn = language === 'bn';
  const pathname = usePathname();
  const open = useShell((s) => s.open);
  const refresh = useShell((s) => s.refresh);
  const [spin, setSpin] = useState(false);
  const doRefresh = () => { refresh(); setSpin(true); setTimeout(() => setSpin(false), 1500); };
  const styles = useMemo(() => makeStyles(colors, design), [colors, design]);
  const overview = useLoad(() => va.overview(), 'header-overview', 30000, { always: true });
  // The phone's sync state, re-read every few seconds (cheap: no server call).
  const [snap, setSnap] = useState(() => ({ bridge: getStatus(), at: Date.now() }));
  useEffect(() => { const id = setInterval(() => setSnap({ bridge: getStatus(), at: Date.now() }), 4000); return () => clearInterval(id); }, []);
  const { bridge, at } = snap;
  const urgent = overview.data?.urgent ?? 0;
  // One sync light instead of messages: green = running and in step with the server; red = not running or no contact for a
  // while (one short failed try is not shown); it spins while the screens reload.
  const age = bridge.lastOk ? at - bridge.lastOk : Infinity;
  // Three moods: red = sync is stopped (or silent for 5+ minutes); amber = running but with a problem (error, waiting messages, 90 s of silence); green = running and in step.
  const mood: 'red' | 'amber' | 'green' = !bridge.serviceAlive || (!!bridge.lastError && age > 300_000) ? 'red'
    : (!!bridge.lastError || bridge.queued > 0 || age > 90_000) ? 'amber' : 'green';
  const syncOk = mood === 'green';
  const syncing = spin || (overview.loading && !overview.data);
  const light = mood === 'green' ? colors.success : mood === 'amber' ? colors.warning : colors.danger;
  // The light breathes: slow and calm when fine, quicker when amber, a sharp blink when red.
  const pulse = useSharedValue(0);
  useEffect(() => {
    const ms = mood === 'green' ? 1600 : mood === 'amber' ? 900 : 500;
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [mood, pulse]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.55 - pulse.value * 0.45, transform: [{ scale: 1 + pulse.value * 0.35 }] }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: mood === 'red' ? 1 - pulse.value * 0.6 : 1 - pulse.value * 0.25 }));
  const turn = useSharedValue(0);
  useEffect(() => {
    if (syncing) turn.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
    else { cancelAnimation(turn); turn.value = 0; }
  }, [syncing, turn]);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));


  return (
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'মেনু খুলুন' : 'Open menu'} onPress={open} style={styles.iconBtn} hitSlop={0}>
        <AppIcon name="menu" size={26} color={colors.textPrimary} />
      </Pressable>
      <Text numberOfLines={1} style={styles.title}>{titleFor(pathname, bn)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'AI সংযোগ' : 'AI connections'} onPress={() => router.push('/ai' as never)} style={styles.iconBtn} hitSlop={0}>
        <AppIcon name="brain" size={22} color={colors.textPrimary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? (syncOk ? 'সিঙ্ক চালু আছে, চাপলে এখনই নতুন করে আনবে' : 'সিঙ্ক চলছে না, চাপলে কারণ দেখাবে') : (syncOk ? 'Sync is on; tap to refresh now' : 'Sync is not running; tap for the reason')}
        onPress={() => { if (syncOk) doRefresh(); else router.push('/health' as never); }} style={styles.syncBtn}>
        <Animated.View pointerEvents="none" style={[styles.syncRing, { backgroundColor: light }, ringStyle]} />
        <Animated.View style={[styles.syncCore, { borderColor: light, backgroundColor: colors.surface }, dotStyle]}>
          <Animated.View style={spinStyle}><AppIcon name={syncOk ? 'sync' : mood === 'amber' ? 'sync-alert' : 'sync-off'} size={26} color={light} /></Animated.View>
        </Animated.View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'জরুরি বার্তা' : 'Urgent messages'} onPress={() => router.push({ pathname: '/inbox', params: { view: 'urgent' } } as never)} style={styles.iconBtn} hitSlop={0}>
        <AppIcon name={urgent ? 'bell-badge' : 'bell-outline'} size={24} color={urgent ? colors.danger : colors.textPrimary} />
        {urgent ? <View style={styles.badge}><Text style={styles.badgeText}>{urgent > 9 ? '9+' : urgent}</Text></View> : null}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors, design: DesignTokens) => StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.sm, height: 56, marginHorizontal: 10, marginTop: 6, marginBottom: 6, borderRadius: design.radiusBar, backgroundColor: design.barFill, borderWidth: border.thin, borderColor: design.barBorder, ...(design.shadow ?? {}) },
  syncBtn: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  syncRing: { position: 'absolute', width: 46, height: 46, borderRadius: 23 },
  syncCore: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 48, height: 48, marginHorizontal: 1, borderRadius: Math.min(14, design.radiusButton), alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  langBtn: { minWidth: 34, height: 28, paddingHorizontal: 6, borderRadius: 8, borderWidth: border.thin, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  langText: { color: colors.textPrimary, fontWeight: '700', fontSize: 12 },
  title: { flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  light: { position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.surface },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
});
