import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../src/ui/AppText';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { monthDueItems, type DueItem } from '../../src/services/debt/debt-service';
import { bangladeshDateKey } from '../../src/i18n/date-time';
import { AppIcon } from '../../src/ui/AppIcon';
import { asciiDigitsToBengali } from '../../src/services/debt/money';
import { Card, DebtHeader, EmptyNote, useDebt } from '../../src/ui/DebtKit';
import { tapLight } from '../../src/ui/haptics';
import { border, icon, radius, spacing, typography, layout } from '../../src/theme';

const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const BN_DOW = ['র', 'সো', 'ম', 'বু', 'বৃ', 'শু', 'শ'];
const EN_DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Shift a `YYYY-MM` key by `delta` months (UTC maths, so no DST surprises). */
function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function DebtCalendar() {
  const db = useSQLiteContext();
  const { s, c, bn, colors, accents, money } = useDebt();
  const today = bangladeshDateKey(new Date());

  const [monthKey, setMonthKey] = useState(today.slice(0, 7));
  const [items, setItems] = useState<DueItem[]>([]);
  const [selected, setSelected] = useState<string | null>(today);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await monthDueItems(db, monthKey)); }
    catch { setItems([]); }
    finally { setReady(true); }
  }, [db, monthKey]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // day key -> the slices due that day, so the grid and the detail list share one pass.
  const byDay = useMemo(() => {
    const map = new Map<string, DueItem[]>();
    for (const it of items) {
      const list = map.get(it.dueDate);
      if (list) list.push(it); else map.set(it.dueDate, [it]);
    }
    return map;
  }, [items]);

  const [year, month] = monthKey.split('-').map(Number);
  const firstDow = new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year ?? 2000, month ?? 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, '0')}`),
  ];

  const monthLabel = `${(bn ? BN_MONTHS : EN_MONTHS)[(month ?? 1) - 1]} ${year}`;
  const selectedItems = selected ? (byDay.get(selected) ?? []) : [];
  // "You owe" and "you are owed" are different facts and must not be added together.
  const monthDebt = items.filter((i) => i.direction === 'DEBT').reduce((sum, it) => sum + Math.max(0, it.amountPaisa - it.paidPaisa), 0);
  const monthRecv = items.filter((i) => i.direction === 'RECEIVABLE').reduce((sum, it) => sum + Math.max(0, it.amountPaisa - it.paidPaisa), 0);

  const step = (delta: number) => { tapLight(); setSelected(null); setMonthKey(shiftMonth(monthKey, delta)); setReady(false); };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <DebtHeader title={c.calendar} subtitle={c.dueDates} />

      <Card>
        <View style={styles.navRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'আগের মাস' : 'Previous month'} onPress={() => step(-1)} style={({ pressed }) => StyleSheet.flatten([styles.navBtn, pressed && s.pressed])}>
            <AppIcon name="chevron-left" size={icon.md} color={colors.primary} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.monthLabel(colors.textPrimary)}>{monthLabel}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'পরের মাস' : 'Next month'} onPress={() => step(1)} style={({ pressed }) => StyleSheet.flatten([styles.navBtn, pressed && s.pressed])}>
            <AppIcon name="chevron-right" size={icon.md} color={colors.primary} />
          </Pressable>
        </View>

        <View style={styles.grid}>
          {(bn ? BN_DOW : EN_DOW).map((d, i) => (
            <View key={`dow-${i}`} style={styles.cell}><Text style={styles.dow(colors.textMuted)}>{d}</Text></View>
          ))}
          {cells.map((day, i) => {
            if (!day) return <View key={`pad-${i}`} style={styles.cell} />;
            const dayItems = byDay.get(day) ?? [];
            const unpaid = dayItems.reduce((sum, it) => sum + Math.max(0, it.amountPaisa - it.paidPaisa), 0);
            const overdue = unpaid > 0 && day < today;
            const tone = unpaid === 0 ? null : overdue ? accents.red : dayItems.some((it) => it.direction === 'DEBT') ? accents.orange : accents.green;
            const isToday = day === today;
            const isSelected = day === selected;
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityLabel={`${day}${unpaid ? ` · ${money(unpaid)}` : ''}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => { tapLight(); setSelected(day); }}
                style={({ pressed }) => StyleSheet.flatten([styles.cell, pressed && s.pressed])}
              >
                <View style={[
                  styles.dayBox,
                  isToday && { borderColor: colors.primary, borderWidth: border.medium },
                  isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}>
                  <Text style={styles.dayNum(isSelected ? colors.onPrimary : colors.textPrimary)}>{bn ? asciiDigitsToBengali(String(Number(day.slice(8)))) : Number(day.slice(8))}</Text>
                  <View style={[styles.dot, tone ? { backgroundColor: tone.base } : { backgroundColor: 'transparent' }]} />
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginTop: spacing.sm, gap: 2 }}>
          <Text style={s.statLabel}>{bn ? 'এই মাসে দিতে হবে' : 'To pay this month'}: {money(monthDebt)}</Text>
          {monthRecv > 0 ? <Text style={s.statLabel}>{bn ? 'এই মাসে পাওয়ার কথা' : 'To collect this month'}: {money(monthRecv)}</Text> : null}
        </View>
      </Card>

      {!ready ? (
        <ActivityIndicator color={colors.primary} />
      ) : selectedItems.length === 0 ? (
        <EmptyNote icon="calendar-blank-outline" text={c.noDue} />
      ) : (
        <Card title={selected ?? ''}>
          {selectedItems.map((it) => {
            const remaining = Math.max(0, it.amountPaisa - it.paidPaisa);
            const tone = remaining === 0 ? accents.green : it.direction === 'DEBT' ? accents.red : accents.blue;
            return (
              <Pressable
                key={it.installmentId}
                accessibilityRole="button"
                accessibilityHint={remaining > 0 ? (bn ? 'এই কিস্তির পরিশোধ লিখতে চাপুন' : 'Opens a payment for this instalment') : undefined}
                onPress={() => router.push(
                  remaining > 0
                    // Straight to a payment aimed at this instalment — seeing "5,000 due
                    // today" and then having to walk home → list → account → pay was four
                    // taps to do the one thing the screen exists to prompt.
                    ? `/debt/pay/${it.accountId}?installment=${it.installmentId}` as never
                    : `/debt/account/${it.accountId}` as never,
                )}
                style={({ pressed }) => StyleSheet.flatten([s.listRow, pressed && s.pressed])}
              >
                <View style={[styles.dot, { backgroundColor: tone.base }]} />
                <View style={s.grow}>
                  <Text numberOfLines={1} style={s.listTitle}>{it.title || it.personName || (it.direction === 'DEBT' ? c.totalDebt : c.totalReceivable)}</Text>
                  <Text numberOfLines={1} style={s.listMeta}>#{bn ? asciiDigitsToBengali(String(it.seq)) : it.seq} · {c.remaining} {money(remaining)}</Text>
                </View>
                <Text numberOfLines={1} style={s.listAmt}>{money(it.amountPaisa)}</Text>
              </Pressable>
            );
          })}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = {
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm} as const,
  navBtn: { width: layout.minTouchTarget, height: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center' } as const,
  monthLabel: (color: string) => ({ color, ...typography.cardTitle, fontWeight: '700' as const }),
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm } as const,
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 } as const,
  dow: (color: string) => ({ color, ...typography.caption, fontWeight: '700' as const }),
  dayBox: { width: 42, height: layout.minTouchTarget, borderRadius: radius.md, borderWidth: border.thin, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: 2 } as const,
  dayNum: (color: string) => ({ color, ...typography.caption, fontWeight: '700' as const }),
  dot: { width: 6, height: 6, borderRadius: 3 } as const,
};
