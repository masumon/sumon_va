// One month, everything on it.
//
// A kisti in the debt ledger, a task in the planner and a bill that only exists as a habit
// are all just "the tenth" to the person living the month. This is the screen where they
// finally sit together.
//
// Days with nothing on them are still shown. A calendar that hides empty days is a list,
// and a list cannot answer "when is my next free week".

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../src/ui/AppText';
import { AppIcon } from '../src/ui/AppIcon';
import { EmptyNote, ScreenHeader, useKit } from '../src/ui/AppKit';
import { asciiDigitsToBengali, formatPaisa } from '../src/services/debt/money';
import { agendaForMonth, dayKey, type AgendaDay, type AgendaKind } from '../src/services/agenda-service';
import { monthName } from '../src/modules/finance.module';
import { border, icon as iconSize, layout, radius, spacing, typography, type ThemeColors } from '../src/theme';
import { tapLight } from '../src/ui/haptics';

const WEEKDAYS_BN = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shiftMonth(key: string, by: number): string {
  const [year = 1970, month = 1] = key.split('-').map(Number);
  const date = new Date(year, month - 1 + by, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default function CalendarScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn, language } = useKit();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [month, setMonth] = useState(() => dayKey().slice(0, 7));
  const [days, setDays] = useState<AgendaDay[]>([]);
  const [openDay, setOpenDay] = useState<string | null>(dayKey());

  const money = useCallback((paisa: number) => formatPaisa(paisa, { bnDigits: bn }), [bn]);
  const digits = useCallback((v: string | number) => (bn ? asciiDigitsToBengali(String(v)) : String(v)), [bn]);

  const load = useCallback(async () => {
    try { setDays(await agendaForMonth(db, language, month)); }
    catch { setDays([]); }
  }, [db, language, month]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const today = dayKey();
  const isThisMonth = month === today.slice(0, 7);
  const chosen = days.find((day) => day.day === openDay) ?? null;
  const busiest = days.filter((day) => day.items.length);
  const monthDue = days.reduce((total, day) => total + day.duePaisa, 0);

  // The grid needs a blank cell for each day before the first, so dates line up under
  // their weekday. Everything else about the month follows from the same array.
  const firstWeekday = new Date(`${month}-01T12:00:00Z`).getUTCDay();

  // Which kinds of thing fall on a day, in a fixed order so the dots never reshuffle
  // between renders. Money owed first, because that is the one people scan for.
  const ORDER: AgendaKind[] = ['DUE', 'EXPECTED', 'TASK', 'REMINDER', 'NOTE'];
  const kindsOn = (day: AgendaDay): AgendaKind[] =>
    ORDER.filter((kind) => day.items.some((item) => item.kind === kind && !item.done));

  const kindTone = (kind: AgendaKind, overdue: boolean) => {
    if (overdue) return accents.red;
    switch (kind) {
      case 'DUE': return accents.red;
      case 'EXPECTED': return accents.orange;
      case 'TASK': return accents.blue;
      case 'REMINDER': return accents.purple;
      default: return accents.green;
    }
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        title={bn ? 'ক্যালেন্ডার' : 'Calendar'}
        subtitle={bn ? 'কিস্তি, কাজ, নিয়মিত খরচ — সব এক জায়গায়' : 'Instalments, tasks and regular bills, together'}
        backTo="/"
        backLabel={bn ? 'হোম' : 'Home'}
      />

      <View style={s.monthRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bn ? 'আগের মাস' : 'Previous month'}
          onPress={() => { tapLight(); setMonth((m) => shiftMonth(m, -1)); setOpenDay(null); }}
          style={({ pressed }) => StyleSheet.flatten([s.monthArrow, pressed && s.pressed])}
        >
          <AppIcon name="chevron-left" size={iconSize.md} color={colors.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => { tapLight(); setMonth(today.slice(0, 7)); setOpenDay(today); }}
          style={({ pressed }) => StyleSheet.flatten([s.monthName, pressed && s.pressed])}
        >
          <Text numberOfLines={1} style={s.monthText}>{`${monthName(month, bn)} ${digits(month.slice(0, 4))}`}</Text>
          {!isThisMonth ? <Text style={s.monthHint}>{bn ? 'এই মাসে ফিরুন' : 'Back to this month'}</Text> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bn ? 'পরের মাস' : 'Next month'}
          onPress={() => { tapLight(); setMonth((m) => shiftMonth(m, 1)); setOpenDay(null); }}
          style={({ pressed }) => StyleSheet.flatten([s.monthArrow, pressed && s.pressed])}
        >
          <AppIcon name="chevron-right" size={iconSize.md} color={colors.primary} />
        </Pressable>
      </View>

      {monthDue > 0 ? (
        <View style={[s.summary, { backgroundColor: accents.orange.soft }]}>
          <Text numberOfLines={2} style={[s.summaryText, { color: accents.orange.on }]}>
            {bn
              ? `এ মাসে মোট ${money(monthDue)} দিতে হবে · ${digits(busiest.length)} দিনে কিছু না কিছু আছে`
              : `${money(monthDue)} falls due this month, across ${busiest.length} ${busiest.length === 1 ? 'day' : 'days'}`}
          </Text>
        </View>
      ) : null}

      <View style={s.legend}>
        {([
          { kind: 'DUE' as const, bn: 'দিতে হবে', en: 'Owed' },
          { kind: 'EXPECTED' as const, bn: 'নিয়মিত খরচ', en: 'Regular spending' },
          { kind: 'TASK' as const, bn: 'কাজ', en: 'Task' },
        ]).map((entry) => (
          <View key={entry.kind} style={s.legendItem}>
            <View style={[s.dot, { backgroundColor: kindTone(entry.kind, false).on }]} />
            <Text numberOfLines={1} style={s.legendText}>{bn ? entry.bn : entry.en}</Text>
          </View>
        ))}
      </View>

      <View style={s.weekRow}>
        {(bn ? WEEKDAYS_BN : WEEKDAYS_EN).map((label) => (
          <Text key={label} numberOfLines={1} style={s.weekday}>{label}</Text>
        ))}
      </View>

      <View style={s.grid}>
        {Array.from({ length: firstWeekday }, (_, index) => (
          <View key={`blank-${index}`} style={s.cell} />
        ))}
        {days.map((day) => {
          const isToday = day.day === today;
          const selected = day.day === openDay;
          const has = day.items.length > 0;
          return (
            <Pressable
              key={day.day}
              accessibilityRole="button"
              accessibilityLabel={`${digits(Number(day.day.slice(8, 10)))}${has ? `, ${digits(day.items.length)}` : ''}`}
              accessibilityState={{ selected }}
              onPress={() => { tapLight(); setOpenDay(day.day); }}
              style={({ pressed }) => StyleSheet.flatten([
                s.cell,
                // A tinted day is one that costs money; the tint is the warning, the dots
                // are the detail.
                !selected && day.duePaisa > 0 && { backgroundColor: (day.overdue ? accents.red : accents.orange).soft },
                selected && { backgroundColor: colors.primary },
                !selected && isToday && { borderColor: colors.primary, borderWidth: 2 },
                pressed && s.pressed,
              ])}
            >
              <Text numberOfLines={1} style={[s.cellDay, selected && { color: colors.onPrimary }]}>
                {digits(Number(day.day.slice(8, 10)))}
              </Text>
              {has ? (
                <View style={s.dotRow}>
                  {kindsOn(day).slice(0, 3).map((kind) => (
                    <View
                      key={kind}
                      style={[
                        s.dot,
                        { backgroundColor: selected ? colors.onPrimary : kindTone(kind, day.overdue).on },
                      ]}
                    />
                  ))}
                </View>
              ) : <View style={s.dotSpace} />}
            </Pressable>
          );
        })}
      </View>

      {chosen ? (
        <>
          <Text style={s.section}>
            {chosen.day === today
              ? (bn ? 'আজ' : 'Today')
              : `${digits(Number(chosen.day.slice(8, 10)))} ${monthName(month, bn)}`}
          </Text>
          {chosen.items.length ? (
            chosen.items.map((item) => {
              const tone = item.done ? accents.green
                : item.kind === 'DUE' ? accents.red
                : item.kind === 'EXPECTED' ? accents.orange
                : accents.blue;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  disabled={!item.route}
                  onPress={() => { if (item.route) { tapLight(); router.push(item.route as never); } }}
                  style={({ pressed }) => StyleSheet.flatten([s.item, pressed && item.route && s.pressed])}
                >
                  <View style={[s.itemIcon, { backgroundColor: tone.soft }]}>
                    <AppIcon
                      name={item.done ? 'check' : item.kind === 'DUE' ? 'calendar-alert' : item.kind === 'EXPECTED' ? 'clock-outline' : 'checkbox-blank-circle-outline'}
                      size={iconSize.sm}
                      color={tone.on}
                    />
                  </View>
                  <View style={s.grow}>
                    <Text numberOfLines={1} style={[s.itemTitle, item.done && s.doneText]}>{item.title}</Text>
                    {item.subtitle ? <Text numberOfLines={1} style={s.itemMeta}>{item.subtitle}</Text> : null}
                  </View>
                  {item.amountPaisa ? (
                    <Text numberOfLines={1} style={[s.itemAmount, { color: tone.on }]}>{money(item.amountPaisa)}</Text>
                  ) : null}
                </Pressable>
              );
            })
          ) : (
            <EmptyNote
              icon="calendar-blank-outline"
              text={bn ? 'এই দিনে কিছু নেই।' : 'Nothing on this day.'}
              action={bn ? 'একটা কাজ যোগ করুন' : 'Add a task'}
              onAction={() => { tapLight(); router.push('/task-editor'); }}
            />
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    grow: { flex: 1, minWidth: 0 },
    monthRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    monthArrow: { width: layout.minTouchTarget, height: layout.minTouchTarget, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border },
    monthName: { flex: 1, minHeight: layout.minTouchTarget, justifyContent: 'center', alignItems: 'center' },
    monthText: { color: colors.textPrimary, ...typography.cardTitle, flexShrink: 1 },
    monthHint: { color: colors.primary, ...typography.caption, fontWeight: '700' },
    summary: { borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm },
    summaryText: { ...typography.bodySmall, fontWeight: '700', lineHeight: 19 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendText: { color: colors.textMuted, ...typography.caption, fontWeight: '700' },
    weekRow: { flexDirection: 'row', marginTop: spacing.md },
    weekday: { flex: 1, textAlign: 'center', color: colors.textMuted, ...typography.caption, fontWeight: '800' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
    // flexBasis rather than a width percentage: seven `100/7`% cells round up past 100%
    // and the last one wraps, which put every date under the wrong weekday.
    cell: { flexBasis: '14.2857%', maxWidth: '14.2857%', height: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, gap: 3 },
    cellDay: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    dotRow: { flexDirection: 'row', gap: 2, alignItems: 'center' },
    dot: { width: 5, height: 5, borderRadius: 3 },
    dotSpace: { width: 5, height: 5 },
    section: { color: colors.textPrimary, ...typography.section, fontWeight: '800', marginTop: spacing.lg, marginBottom: spacing.sm },
    item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget + 8, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs },
    itemIcon: { width: 32, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    itemTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    itemMeta: { color: colors.textMuted, ...typography.caption, marginTop: 1 },
    itemAmount: { ...typography.caption, fontWeight: '800', flexShrink: 1 },
    doneText: { textDecorationLine: 'line-through', color: colors.textMuted },
    pressed: { opacity: 0.78 },
  });
}
