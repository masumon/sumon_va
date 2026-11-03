import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useTaskStore } from '../src/store/task.store';
import { useAppPreferences } from '../src/app/AppPreferences';
import { getStreak } from '../src/services/streak-service';
import { weeklyReview, type WeeklyReview } from '../src/services/review-service';
import { AppIcon } from '../src/ui/AppIcon';
import { AppSkeletonList } from '../src/ui/AppSurface';
import { formatBangladeshDate } from '../src/i18n/date-time';
import { localizeTaskPriority } from '../src/i18n/domain-labels';
import { border, control, elevation, icon, layout, radius, spacing, typography, priorityAccentName, type ThemeAccents, type ThemeColors } from '../src/theme';
import type { TaskPriority } from '../src/types';

const PRIORITIES: TaskPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export default function ReviewScreen() {
  const db = useSQLiteContext();
  const { colors, accents, language, weekStartsOn } = useAppPreferences();
  const bn = language === 'bn';
  const toBnDigits = (v: string | number) => String(v).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!);
  const n = (v: number) => (bn ? toBnDigits(v) : String(v));
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const tasks = useTaskStore(s => s.tasks);
  const load = useTaskStore(s => s.load);
  const [streak, setStreak] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([load(db), getStreak(db).catch(() => 0)]).then(([, s]) => {
      if (!alive) return;
      setStreak(s);
      setReady(true);
    });
    return () => { alive = false; };
  }, [db, load]);

  const review: WeeklyReview = useMemo(() => weeklyReview(tasks, new Date(), weekStartsOn), [tasks, weekStartsOn]);
  const maxDay = Math.max(1, ...review.byDay.map(d => d.count));
  const ratePct = Math.round(review.completionRate * 100);

  const c = bn
    ? { back: 'আরও', eyebrow: 'সাপ্তাহিক রিভিউ', title: 'এই সপ্তাহ', done: 'শেষ হয়েছে', rate: 'শেষের হার', streak: 'দিন ধারাবাহিক', added: 'যোগ হয়েছে', open: 'বাকি আছে', overdue: 'বকেয়া', carried: 'আগের থেকে টানা', byDay: 'দিনভিত্তিক', byPriority: 'অগ্রাধিকার অনুযায়ী শেষ', busiest: 'সবচেয়ে ব্যস্ত', none: 'এই সপ্তাহে এখনো কিছু শেষ হয়নি — শুরু করুন।', loading: 'রিভিউ তৈরি হচ্ছে…' }
    : { back: 'More', eyebrow: 'WEEKLY REVIEW', title: 'This week', done: 'Finished', rate: 'Completion', streak: 'day streak', added: 'Added', open: 'Still open', overdue: 'Overdue', carried: 'Carried over', byDay: 'By day', byPriority: 'Finished by priority', busiest: 'Busiest day', none: 'Nothing finished this week yet — get one done.', loading: 'Building your review…' };

  const dayLabels = bn ? ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={c.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}>
          <AppIcon name="arrow-left" size={icon.md} color={colors.primary} />
          <Text style={styles.backText}>{c.back}</Text>
        </Pressable>
        <Text style={styles.eyebrow}>{c.eyebrow}</Text>
        <Text accessibilityRole="header" style={styles.title}>{c.title}</Text>
        <Text style={styles.range}>{formatBangladeshDate(`${review.weekStartKey}T00:00:00`, language)} – {formatBangladeshDate(`${review.weekEndKey}T00:00:00`, language)}</Text>
      </View>

      {!ready ? <AppSkeletonList rows={4} /> : (
        <>
          <View style={styles.statRow}>
            <View style={[styles.stat, { borderColor: accents.green.border }]}>
              <Text style={[styles.statValue, { color: accents.green.on }]}>{n(review.completed)}</Text>
              <Text style={styles.statLabel}>{c.done}</Text>
            </View>
            <View style={[styles.stat, { borderColor: accents.blue.border }]}>
              <Text style={[styles.statValue, { color: accents.blue.on }]}>{n(ratePct)}%</Text>
              <Text style={styles.statLabel}>{c.rate}</Text>
            </View>
            <View style={[styles.stat, { borderColor: colors.accent }]}>
              <View style={styles.streakVal}><AppIcon name="fire" size={icon.sm} color={colors.accent} /><Text style={[styles.statValue, { color: colors.accent }]}>{n(streak ?? 0)}</Text></View>
              <Text style={styles.statLabel}>{c.streak}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text numberOfLines={2} style={styles.cardTitle}>{c.byDay}</Text>
            <View style={styles.chart}>
              {review.byDay.map((d, i) => {
                const dow = new Date(`${d.key}T12:00:00`).getDay();
                return (
                  <View key={d.key} style={styles.barCol}>
                    <Text style={styles.barNum}>{d.count ? n(d.count) : ''}</Text>
                    <View style={styles.barTrack}><View style={[styles.barFill, { height: `${Math.round((d.count / maxDay) * 100)}%`, backgroundColor: d.count ? colors.primary : colors.border }]} /></View>
                    <Text style={[styles.barLabel, i === review.byDay.length - 1 && null]}>{dayLabels[dow]}</Text>
                  </View>
                );
              })}
            </View>
            {review.busiestDay ? <Text style={styles.hint}>{c.busiest}: {dayLabels[new Date(`${review.busiestDay.key}T12:00:00`).getDay()]} · {n(review.busiestDay.count)}</Text> : <Text style={styles.hint}>{c.none}</Text>}
          </View>

          <View style={styles.miniRow}>
            <View style={styles.mini}><Text style={styles.miniValue}>{n(review.created)}</Text><Text style={styles.miniLabel}>{c.added}</Text></View>
            <View style={styles.mini}><Text style={styles.miniValue}>{n(review.stillOpen)}</Text><Text style={styles.miniLabel}>{c.open}</Text></View>
            <View style={styles.mini}><Text style={[styles.miniValue, review.overdue ? { color: accents.red.on } : null]}>{n(review.overdue)}</Text><Text style={styles.miniLabel}>{c.overdue}</Text></View>
            <View style={styles.mini}><Text style={[styles.miniValue, review.carriedOver ? { color: accents.orange.on } : null]}>{n(review.carriedOver)}</Text><Text style={styles.miniLabel}>{c.carried}</Text></View>
          </View>

          {review.completed > 0 ? (
            <View style={styles.card}>
              <Text numberOfLines={2} style={styles.cardTitle}>{c.byPriority}</Text>
              {PRIORITIES.map(p => {
                const n = review.byPriority[p];
                if (!n) return null;
                const tone = accents[priorityAccentName(p)];
                return (
                  <View key={p} style={styles.pRow}>
                    <View style={[styles.pDot, { backgroundColor: tone.base }]} />
                    <Text style={styles.pLabel}>{localizeTaskPriority(p, bn)}</Text>
                    <View style={styles.pBarTrack}><View style={[styles.pBarFill, { width: `${Math.round((n / review.completed) * 100)}%`, backgroundColor: tone.base }]} /></View>
                    <Text style={styles.pNum}>{bn ? toBnDigits(n) : n}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          <Pressable accessibilityRole="button" onPress={() => router.push('/planning')} style={({ pressed }) => StyleSheet.flatten([styles.cta, pressed && styles.pressed])}>
            <AppIcon name="calendar-arrow-right" size={icon.sm} color={colors.onPrimary} />
            <Text style={styles.ctaText}>{bn ? 'পরের সপ্তাহ প্ল্যান করুন' : 'Plan the week ahead'}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
    header: { paddingTop: spacing.sm, marginBottom: spacing.md },
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    eyebrow: { color: colors.primary, ...typography.label, fontWeight: '700', letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700', marginTop: spacing.xs },
    range: { color: colors.textMuted, ...typography.caption, fontFamily: typography.numeric.fontFamily, marginTop: spacing.xxs },
    statRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    stat: { flex: 1, borderWidth: border.thin, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, alignItems: 'center', ...elevation.soft },
    statValue: { ...typography.title, fontWeight: '700', fontFamily: typography.numeric.fontFamily },
    statLabel: { color: colors.textMuted, ...typography.section, marginTop: spacing.xxs, textAlign: 'center' },
    streakVal: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
    card: { borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.md, ...elevation.soft },
    cardTitle: { color: colors.textSecondary, ...typography.label, fontWeight: '800', letterSpacing: 0.5, marginBottom: spacing.md },
    chart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 128, gap: spacing.xs },
    barCol: { flex: 1, alignItems: 'center', gap: spacing.xxs },
    barNum: { color: colors.textMuted, ...typography.section, fontFamily: typography.numeric.fontFamily },
    barTrack: { flex: 1, width: '62%', borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, justifyContent: 'flex-end', overflow: 'hidden' },
    barFill: { width: '100%', borderRadius: radius.sm, minHeight: 2 },
    barLabel: { color: colors.textMuted, ...typography.section },
    hint: { color: colors.textMuted, ...typography.caption, marginTop: spacing.md },
    miniRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    mini: { flex: 1, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingVertical: spacing.smd, alignItems: 'center' },
    miniValue: { color: colors.textPrimary, ...typography.cardTitle, fontWeight: '700', fontFamily: typography.numeric.fontFamily },
    miniLabel: { color: colors.textMuted, ...typography.section, marginTop: spacing.xxs, textAlign: 'center' },
    pRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
    pDot: { width: 8, height: 8, borderRadius: radius.pill },
    pLabel: { color: colors.textSecondary, ...typography.caption, fontWeight: '700', minWidth: 64 },
    pBarTrack: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
    pBarFill: { height: 8, borderRadius: radius.pill },
    pNum: { color: colors.textPrimary, ...typography.caption, fontFamily: typography.numeric.fontFamily, minWidth: 18, textAlign: 'right' },
    cta: { minHeight: control.buttonHeight, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.md, backgroundColor: colors.primary, marginTop: spacing.xs },
    ctaText: { color: colors.onPrimary, ...typography.bodySmall, fontWeight: '800' },
    pressed: { opacity: 0.78 },
  });
}
