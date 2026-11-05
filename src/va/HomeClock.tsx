import { useCallback, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { AppText as Text } from '../ui/AppText';
import { useAppPreferences } from '../app/AppPreferences';
import { appTimeZone, isHour12 } from '../i18n/date-time';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const toBn = (text: string) => text.replace(/\d/g, (d) => BN_DIGITS[Number(d)]!);

/** Bangla day parts for a 24-hour clock hour: মধ্যরাত 0-3, ভোর 4-5, সকাল 6-11, দিন 12-16, সন্ধ্যা 17-19, রাত 20-23. */
function bnPart(hour: number): string {
  return hour < 4 ? 'মধ্যরাত' : hour < 6 ? 'ভোর' : hour < 12 ? 'সকাল' : hour < 17 ? 'দিন' : hour < 20 ? 'সন্ধ্যা' : 'রাত';
}
function enPart(hour: number): string {
  return hour < 4 ? 'Midnight' : hour < 6 ? 'Dawn' : hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 20 ? 'Evening' : 'Night';
}

function wall(now: Date): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: appTimeZone(), hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { h: get('hour') % 24, m: get('minute'), s: get('second') };
}

/**
 * Dashboard corner: a live Bangladesh clock with seconds (the logo lives in the side menu).
 * Bangla UI: Bangla digits and the day part in words (সকাল, দিন, সন্ধ্যা, রাত, মধ্যরাত), no এএম/পিএম.
 * English UI: English digits, 12-hour with AM/PM and the day part in words. The 12/24-hour Settings choice is respected.
 */
export function HomeClock() {
  const { colors, language, design } = useAppPreferences();
  const [now, setNow] = useState(() => new Date());
  // Ticks once a second only while this screen is in view and the app is in the foreground; updates at once on return.
  useFocusEffect(useCallback(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    let first: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      if (id) return;
      first = setTimeout(() => setNow(new Date()), 0);
      id = setInterval(() => setNow(new Date()), 1000);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = null;
      if (first) clearTimeout(first);
      first = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') start(); else stop(); });
    return () => { stop(); sub.remove(); };
  }, []));
  const bn = language === 'bn';
  const { h, m, s } = wall(now);
  const twelve = isHour12();
  const hh = twelve ? (h % 12 === 0 ? 12 : h % 12) : h;
  const two = (n: number) => String(n).padStart(2, '0');
  const fmt = (t: string) => (bn ? toBn(t) : t);
  const main = fmt(`${two(hh)}:${two(m)}`);
  const sec = fmt(two(s));
  const part = bn ? bnPart(h) : enPart(h);
  const suffix = !bn && twelve ? (h < 12 ? ' AM' : ' PM') : '';
  const spoken = `${bn ? 'এখন সময়' : 'Time now'} ${main}:${sec}${suffix} ${part}`;
  return (
    <View style={styles.wrap} accessible accessibilityLabel={spoken}>
      <View style={[styles.pill, { backgroundColor: design.barFill, borderColor: colors.accent }]}>
        <Text style={[styles.part, { color: colors.accent }]}>{part}{suffix}</Text>
        <View style={styles.row}>
          <Text style={[styles.time, { color: colors.textPrimary }]}>{main}</Text>
          <Text style={[styles.sec, { color: colors.textMuted }]}>:{sec}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { paddingHorizontal: 16, paddingVertical: 8, minHeight: 72, borderRadius: 20, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  part: { fontSize: 13, fontWeight: '600', letterSpacing: 0.8 },
  row: { flexDirection: 'row', alignItems: 'baseline' },
  time: { fontSize: 32, fontWeight: '700', letterSpacing: 0.8 },
  sec: { fontSize: 19, fontWeight: '500', marginLeft: 2 },
});
