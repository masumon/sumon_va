import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../ui/AppText';
import { AppIcon } from '../ui/AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { border, radius, type ThemeColors } from '../theme';
import type { DesignTokens } from '../theme/designs';
import { getStatus, startService } from '../../modules/va-bridge';
import { useAppFeedback } from '../ui/AppFeedback';
import { formatBangladeshDateTime, formatBangladeshNumber, formatBangladeshTime, formatBangladeshWeekdayDate } from '../i18n/date-time';
import { clearApiCache, va } from './api';
import { sameValue, useAppActive, useLoad } from './hooks';
import { useShell } from './shell';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';


/** The top bar on every signed-in screen: menu, logo and title, connection light, urgent bell, and your initial. */
export function AppHeader() {
  const { colors, language, design, reduceMotion } = useAppPreferences();
  const bn = language === 'bn';
  const active = useAppActive();
  const open = useShell((s) => s.open);
  const refresh = useShell((s) => s.refresh);
  const [spin, setSpin] = useState(false);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (spinTimer.current) clearTimeout(spinTimer.current); }, []);
  const { showSnackbar } = useAppFeedback();
  const [lastSync, setLastSync] = useState<number | null>(null);
  // A real sync: it keeps turning until the server has really answered, then says so with the date and time (or why not).
  const doRefresh = async () => {
    if (spin) return;
    clearApiCache();
    setSpin(true);
    if (spinTimer.current) clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => setSpin(false), 30000); // never spins forever
    try { startService(); } catch { /* the background sync starts itself anyway */ }
    let ok = true;
    let why = '';
    try { await va.overview(); } catch (e) { ok = false; why = e instanceof Error ? e.message : ''; }
    refresh();
    if (spinTimer.current) clearTimeout(spinTimer.current);
    setSpin(false);
    if (ok) {
      const now = Date.now();
      setLastSync(now);
      showSnackbar(bn ? `সিঙ্ক হয়েছে ✓ · ${formatBangladeshDateTime(new Date(now), language)}` : `Synced ✓ · ${formatBangladeshDateTime(new Date(now), language)}`, 'success');
    } else {
      showSnackbar(bn ? `সিঙ্ক হয়নি: ${why || 'সার্ভারে পৌঁছানো যায়নি'}` : `Sync failed: ${why || 'server not reached'}`, 'danger');
    }
  };
  const styles = useMemo(() => makeStyles(colors, design), [colors, design]);
  const overview = useLoad(() => va.overview(), 'header-overview', 30000, { always: true });
  // The phone's sync state, re-read every few seconds (cheap: no server call).
  const [snap, setSnap] = useState(() => ({ bridge: getStatus(), at: Date.now() }));
  useEffect(() => {
    // Re-renders only when the status really changed (or every ~16 s so the "silent for N seconds" age stays right). Paused in the background.
    const check = () => {
      if (AppState.currentState !== 'active') return;
      const next = getStatus();
      setSnap((prev) => (!sameValue(prev.bridge, next) || Date.now() - prev.at >= 16000 ? { bridge: next, at: Date.now() } : prev));
    };
    const id = setInterval(check, 4000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setSnap({ bridge: getStatus(), at: Date.now() }); });
    return () => { clearInterval(id); sub.remove(); };
  }, []);
  const { bridge, at } = snap;
  const ov = overview.data;
  const urgent = ov?.urgent ?? 0;
  const assistantOn = ov ? ov.enabled : true;
  const statusLabel = ov?.status_now?.label || (bn ? 'সচল' : 'Active');
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      const cur = new Date();
      setClock(cur);
      const rem = (60 - cur.getSeconds()) * 1000 - cur.getMilliseconds() + 50;
      t = setTimeout(tick, Math.max(1000, rem));
    };
    if (active) tick();
    return () => { if (t) clearTimeout(t); };
  }, [active]);
  const dayShort = formatBangladeshWeekdayDate(clock, language).split(',')[0] ?? '';
  const timeShort = formatBangladeshTime(clock, language);
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
    cancelAnimation(pulse);
    pulse.value = 0;
    // Green = a still ring. Amber / red pulse, but never in the background or with reduced motion.
    if (mood !== 'green' && active && !reduceMotion) pulse.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [mood, pulse, active, reduceMotion]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.55 - pulse.value * 0.45, transform: [{ scale: 1 + pulse.value * 0.35 }] }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: mood === 'red' ? 1 - pulse.value * 0.6 : 1 - pulse.value * 0.25 }));
  const turn = useSharedValue(0);
  useEffect(() => {
    if (syncing && active && !reduceMotion) turn.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
    else { cancelAnimation(turn); turn.value = 0; }
  }, [syncing, turn, active, reduceMotion]);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));


  return (
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'মেনু খুলুন' : 'Open menu'} onPress={open} style={styles.iconBtn} hitSlop={4}>
        <AppIcon name="menu" size={23} color={colors.textPrimary} />
      </Pressable>
      <View style={styles.titleBlock}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={styles.title}>{bn ? 'সুমন সহকারী' : 'Sumon VA'}</Text>
          <View style={[styles.livePill, { backgroundColor: assistantOn ? 'rgba(16,185,129,0.16)' : 'rgba(244,63,94,0.16)' }]}>
            <View style={[styles.liveDot, { backgroundColor: assistantOn ? colors.success : colors.danger }]} />
            <Text style={[styles.liveText, { color: assistantOn ? colors.success : colors.danger }]}>
              {assistantOn ? (bn ? 'সচল' : 'On') : (bn ? 'বন্ধ' : 'Off')}
            </Text>
          </View>
        </View>
        <Text numberOfLines={1} style={styles.subLine}>
          {`${dayShort} · ${timeShort}${ov?.status_now?.label ? ` · ${statusLabel}` : ''}`}
        </Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'সহকারীকে বলুন' : 'Tell the assistant'} onPress={() => router.push('/f0' as never)} style={styles.iconBtn} hitSlop={4}>
        <AppIcon name="robot-happy-outline" size={20} color={colors.primary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={(bn ? 'এখনই সিঙ্ক করুন' : 'Sync now') + (lastSync ? (bn ? `, শেষ সিঙ্ক ${formatBangladeshDateTime(new Date(lastSync), language)}` : `, last sync ${formatBangladeshDateTime(new Date(lastSync), language)}`) : '')}
        onPress={() => { if (syncOk || bridge.serviceAlive) void doRefresh(); else router.push('/health' as never); }} style={styles.syncBtn}>
        <Animated.View pointerEvents="none" style={[styles.syncRing, { backgroundColor: light }, ringStyle]} />
        <Animated.View style={[styles.syncCore, { borderColor: light, backgroundColor: colors.surface }, dotStyle]}>
          <Animated.View style={spinStyle}><AppIcon name={syncOk ? 'sync' : mood === 'amber' ? 'sync-alert' : 'sync-off'} size={19} color={light} /></Animated.View>
        </Animated.View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'বিজ্ঞপ্তি' : 'Notifications'} onPress={() => router.push('/alerts' as never)} style={styles.iconBtn} hitSlop={4}>
        <AppIcon name={urgent ? 'bell-badge' : 'bell-outline'} size={21} color={urgent ? colors.danger : colors.textPrimary} />
        {urgent ? <View style={styles.badge}><Text style={styles.badgeText}>{urgent > 9 ? (bn ? '৯+' : '9+') : formatBangladeshNumber(urgent, language)}</Text></View> : null}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors, design: DesignTokens) => StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, minHeight: 54, marginHorizontal: 10, marginTop: 4, marginBottom: 4, borderRadius: design.radiusBar, backgroundColor: design.barFill, borderWidth: border.thin, borderColor: design.barBorder, ...(design.shadow ?? {}) },
  syncBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  syncRing: { position: 'absolute', width: 38, height: 38, borderRadius: 19 },
  syncCore: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 40, height: 40, borderRadius: Math.min(12, design.radiusButton), alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  titleBlock: { flex: 1, minWidth: 0, justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: radius.pill },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 10, fontWeight: '800' },
  subLine: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  badge: { position: 'absolute', top: 2, right: 2, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '800' },
});
