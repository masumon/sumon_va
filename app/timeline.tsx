// The life timeline: what happened, in the order it happened.
//
// Every other screen in this app is a view of one domain — the money book, the debt
// ledger, the health record. This is the only one that asks the plain question a person
// actually asks: what happened on the tenth? Borrowing from a friend and paying the lab
// with it are one afternoon, and until now they were two screens apart with nothing to say
// they were related.
//
// It reads `life_events`, which every writer fills in alongside the records it creates, so
// nothing here recomputes or second-guesses a total. The amounts are the events' own.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../src/ui/AppText';
import { AppIcon } from '../src/ui/AppIcon';
import { AppState } from '../src/ui/AppSurface';
import { useAppPreferences } from '../src/app/AppPreferences';
import { lifeTimeline, type TimelineDay } from '../src/services/life-event-service';
import { eventLook, eventTypeLabel, eventWord } from '../src/services/life-event-copy';
import { formatPaisa } from '../src/services/debt/money';
import { bangladeshDateKey, formatBangladeshWeekdayDate, formatBangladeshRelativeDate } from '../src/i18n/date-time';
import { border, elevation, icon, layout, radius, spacing, typography, type ThemeColors } from '../src/theme';

/** The windows worth offering. Anything longer is a report, not a timeline. */
const RANGES = [30, 90, 365] as const;
type Range = (typeof RANGES)[number];

export default function TimelineScreen() {
  const db = useSQLiteContext();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [range, setRange] = useState<Range>(30);
  // What is on screen, and which window it answers. Held together rather than as two
  // pieces of state, so switching window cannot briefly show a month's events under a
  // year's heading — and so nothing has to be reset from inside the effect.
  const [loaded, setLoaded] = useState<{ range: Range; days: TimelineDay[] } | null>(null);
  const ready = loaded?.range === range;
  const days = ready ? loaded.days : [];

  const load = useCallback(async (window: Range) => {
    const to = bangladeshDateKey(new Date());
    const from = bangladeshDateKey(new Date(Date.now() - window * 86_400_000));
    return lifeTimeline(db, { from, to, limit: 400 });
  }, [db]);

  useEffect(() => {
    let alive = true;
    void load(range)
      .then((rows) => { if (alive) setLoaded({ range, days: rows }); })
      .catch(() => { if (alive) setLoaded({ range, days: [] }); });
    return () => { alive = false; };
  }, [load, range]);

  const c = bn
    ? {
      back: 'আরও', eyebrow: 'জীবনরেখা', title: 'যা যা ঘটেছে',
      sub: 'টাকা, ঋণ, স্বাস্থ্য — সব এক সময়রেখায়',
      none: 'এই সময়ে কিছু লেখা হয়নি',
      noneHint: 'খরচ, ঋণ বা চিকিৎসা লিখলে সেটা এখানে নিজে থেকেই চলে আসবে।',
      window: (d: Range) => (d === 30 ? '৩০ দিন' : d === 90 ? '৩ মাস' : '১ বছর'),
    }
    : {
      back: 'More', eyebrow: 'LIFE', title: 'What happened',
      sub: 'Money, debt and health on one line',
      none: 'Nothing recorded in this window',
      noneHint: 'Write down an expense, a debt or a visit and it shows up here on its own.',
      window: (d: Range) => (d === 30 ? '30 days' : d === 90 ? '3 months' : '1 year'),
    };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={c.back}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
          style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}
        >
          <AppIcon name="arrow-left" size={icon.md} color={colors.primary} />
          <Text style={styles.backText}>{c.back}</Text>
        </Pressable>
        <Text style={styles.eyebrow}>{c.eyebrow}</Text>
        <Text accessibilityRole="header" style={styles.title}>{c.title}</Text>
        <Text style={styles.sub}>{c.sub}</Text>
      </View>

      <View accessibilityRole="tablist" style={styles.tabs}>
        {RANGES.map((value) => {
          const on = value === range;
          return (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setRange(value)}
              style={({ pressed }) => StyleSheet.flatten([styles.tab, on && styles.tabOn, pressed && styles.pressed])}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{c.window(value)}</Text>
            </Pressable>
          );
        })}
      </View>

      {!ready ? null : days.length === 0 ? (
        <AppState icon="timeline-text-outline" title={c.none} description={c.noneHint} />
      ) : (
        days.map((day) => (
          <View key={day.dayKey} style={styles.day}>
            <View style={styles.dayHead}>
              {/* "আজ"/"গতকাল" with the date beside it; any other day shows its date once, not twice. */}
              {/[0-9০-৯]/u.test(formatBangladeshRelativeDate(`${day.dayKey}T12:00:00.000Z`, language))
                ? <Text style={styles.dayTitle}>{formatBangladeshWeekdayDate(`${day.dayKey}T12:00:00.000Z`, language)}</Text>
                : <>
                  <Text style={styles.dayTitle}>{formatBangladeshRelativeDate(`${day.dayKey}T12:00:00.000Z`, language)}</Text>
                  <Text style={styles.dayDate}>{formatBangladeshWeekdayDate(`${day.dayKey}T12:00:00.000Z`, language)}</Text>
                </>}
            </View>

            {day.events.map((event) => {
              const look = eventLook(event.type);
              const tone = accents[look.tone];
              // Where it came from, or where it went — whichever the event knows. This is
              // the provenance line: the answer to "that five thousand, from what?"
              const trail = [
                eventWord(event.source, language),
                eventWord(event.destination, language),
              ].filter(Boolean).join(' → ');
              const detail = [event.personName, event.place, trail, eventWord(event.purpose, language)]
                .filter(Boolean).join(' · ');

              return (
                <View key={event.id} style={styles.card}>
                  <View style={[styles.badge, { backgroundColor: tone.soft, borderColor: tone.border }]}>
                    <AppIcon name={look.icon} size={icon.sm} color={tone.on} />
                  </View>
                  <View style={styles.body}>
                    <Text numberOfLines={2} style={styles.cardTitle}>
                      {/* A wallet-to-wallet move carries an internal name ("__transfer__"); never show it. */}
                      {event.title?.trim() && !event.title.trim().startsWith('__') ? event.title.trim() : eventTypeLabel(event.type, language)}
                    </Text>
                    <Text style={styles.kind}>{eventTypeLabel(event.type, language)}</Text>
                    {detail ? <Text numberOfLines={2} style={styles.detail}>{detail}</Text> : null}
                    {event.note ? <Text numberOfLines={2} style={styles.note}>{event.note}</Text> : null}
                  </View>
                  {event.amountPaisa ? (
                    <Text style={[styles.amount, { color: look.flow === 'IN' ? colors.success : look.flow === 'OUT' ? colors.textPrimary : colors.textSecondary }]}>
                      {look.flow === 'IN' ? '+' : look.flow === 'OUT' ? '−' : ''}
                      {formatPaisa(event.amountPaisa, { symbol: true, bnDigits: bn })}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))
      )}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
    header: { paddingTop: spacing.sm, marginBottom: spacing.md },
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    eyebrow: { color: colors.primary, ...typography.label, fontWeight: '700', letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700', marginTop: spacing.xs },
    sub: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.xs },

    tabs: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.lg },
    tab: { flex: 1, minHeight: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center', borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
    tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { color: colors.textSecondary, ...typography.bodySmall, fontWeight: '700' },
    tabTextOn: { color: colors.onPrimary },

    day: { marginBottom: spacing.lg },
    dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
    dayTitle: { color: colors.textPrimary, ...typography.section, fontWeight: '800' },
    dayDate: { flexShrink: 1, color: colors.textMuted, ...typography.label },

    card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.sm, ...elevation.soft },
    badge: { width: 34, height: 34, borderRadius: radius.md, borderWidth: border.thin, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, minWidth: 0, gap: 2 },
    cardTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    kind: { color: colors.textMuted, ...typography.label },
    detail: { color: colors.textSecondary, ...typography.bodySmall },
    note: { color: colors.textMuted, ...typography.bodySmall, fontStyle: 'italic' },
    amount: { flexShrink: 0, ...typography.body, fontWeight: '800' },
    pressed: { opacity: 0.78 },
  });
}
