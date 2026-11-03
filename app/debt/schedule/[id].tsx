// The instalment schedule, editable.
//
// Rescheduling is the thing people actually need most from a hand loan — "I'll pay it in
// four goes instead of two", "push next month's to the 20th" — and it was the one thing
// the module could not do at all: the old save path deleted every instalment and rewrote
// them, which foreign keys refuse the moment any payment has been allocated.
//
// So a row that already has money against it is shown as locked: its date can move and it
// can grow, but it cannot shrink below what is paid and it cannot be removed. That is not
// a limitation to apologise for — it is the ledger refusing to disagree with itself.

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../../src/ui/AppText';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppConfirmDialog, useAppFeedback } from '../../../src/ui/AppFeedback';
import { getAccountView, saveInstallmentPlan, type AccountView } from '../../../src/services/debt/debt-service';
import { paidByInstallment } from '../../../src/services/debt/repository';
import { asciiDigitsToBengali, paisaToTakaString, parseTakaToPaisa, splitEven } from '../../../src/services/debt/money';
import { AppDateField, formatLongDate, isValidDayKey } from '../../../src/ui/AppDateField';
import { AppIcon } from '../../../src/ui/AppIcon';
import { Card, DebtHeader, EmptyNote, FormBar, Stat, useDebt } from '../../../src/ui/DebtKit';
import { useUnsavedGuard } from '../../../src/hooks/useUnsavedGuard';
import { tapLight, success, warn } from '../../../src/ui/haptics';
import { border, control, icon, radius, spacing, typography } from '../../../src/theme';
import { logAppError } from '../../../src/services/error-log';

type Row = {
  key: string;
  id: string | null;
  amount: string;
  dueDate: string | null;
  /** How much is already allocated to this instalment. A locked row cannot go below it. */
  paidPaisa: number;
};

export default function ScheduleScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { s, c, bn, colors, accents, money } = useDebt();
  const { showSnackbar } = useAppFeedback();

  const [view, setView] = useState<AccountView | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setReady(true); return; }
    try {
      const [v, paid] = await Promise.all([getAccountView(db, id), paidByInstallment(db, id)]);
      setView(v);
      setRows(v.installments.map((i) => ({
        key: i.id,
        id: i.id,
        amount: paisaToTakaString(i.amountPaisa),
        dueDate: i.dueDate,
        paidPaisa: paid.get(i.id) ?? 0,
      })));
      setDirty(false);
    } catch { setView(null); }
    finally { setReady(true); }
  }, [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const touch = () => setDirty(true);
  const setRow = (key: string, patch: Partial<Row>) => {
    touch();
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  };
  const addRow = () => {
    tapLight(); touch();
    setRows((r) => {
      const last = r[r.length - 1];
      return [...r, { key: `new_${Date.now()}_${r.length}`, id: null, amount: '', dueDate: last?.dueDate ? addMonth(last.dueDate) : null, paidPaisa: 0 }];
    });
  };
  const removeRow = (key: string) => { tapLight(); touch(); setRows((r) => r.filter((x) => x.key !== key)); };

  const parsed = useMemo(
    () => rows.map((r) => ({ ...r, paisa: safeParse(r.amount) })),
    [rows],
  );
  const total = parsed.reduce((sum, r) => sum + r.paisa, 0);

  const guard = useUnsavedGuard(dirty && !busy);
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/debt/account/${id}` as never));
  const leave = () => guard.attemptLeave(back);

  if (!ready) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!view || !id) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={s.container} contentContainerStyle={s.content}>
        <DebtHeader title={c.schedule} />
        <EmptyNote icon="wallet-outline" text={bn ? 'হিসাব পাওয়া যায়নি' : 'Account not found'} />
      </ScrollView>
    );
  }

  const target = view.balance.totalPayablePaisa;
  const gap = total - target;

  /** Rebuild the whole plan as N equal instalments, one month apart. Locked rows survive. */
  const spread = (count: number) => {
    tapLight(); touch();
    const locked = parsed.filter((r) => r.paidPaisa > 0);
    const lockedTotal = locked.reduce((sum, r) => sum + Math.max(r.paisa, r.paidPaisa), 0);
    const rest = Math.max(0, target - lockedTotal);
    const amounts = splitEven(rest, count);
    const start = view.account.firstDueDate ?? view.account.openedDate ?? null;
    setRows([
      ...locked.map((r) => ({ key: r.key, id: r.id, amount: r.amount, dueDate: r.dueDate, paidPaisa: r.paidPaisa })),
      ...amounts.map((amt, i) => ({
        key: `new_${Date.now()}_${i}`,
        id: null,
        amount: paisaToTakaString(amt),
        dueDate: start ? addMonths(start, locked.length + i) : null,
        paidPaisa: 0,
      })),
    ]);
  };

  const save = async () => {
    if (busy || !id) return;
    for (const r of parsed) {
      if (r.paisa <= 0) { warn(); showSnackbar(bn ? 'প্রতিটি কিস্তিতে টাকার অঙ্ক দিন' : 'Every instalment needs an amount', 'danger'); return; }
      if (r.dueDate && !isValidDayKey(r.dueDate)) { warn(); showSnackbar(bn ? 'তারিখ সঠিক নয়' : 'That date is not valid', 'danger'); return; }
      if (r.paisa < r.paidPaisa) {
        warn();
        showSnackbar(bn ? `একটি কিস্তিতে ইতিমধ্যে ${money(r.paidPaisa)} জমা আছে` : `One instalment already has ${money(r.paidPaisa)} paid into it`, 'danger');
        return;
      }
    }
    setBusy(true);
    try {
      // Numbered in the order shown; the derived views sort by due date anyway.
      await saveInstallmentPlan(db, id, parsed.map((r, i) => ({ id: r.id, seq: i + 1, dueDate: r.dueDate, amountPaisa: r.paisa })));
      success();
      showSnackbar(bn ? 'সূচি সংরক্ষিত' : 'Schedule saved', 'success');
      router.replace(`/debt/account/${id}` as never);
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/schedule/id', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  return (
    <View style={s.container}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <DebtHeader title={c.editSchedule} subtitle={view.account.title || view.person?.name || undefined} onBack={() => guard.attemptLeave(() => router.dismissTo('/debt' as never))} />

        <Card>
          <Stat label={bn ? 'মোট প্রদেয়' : 'Total payable'} value={money(target)} />
          <Stat
            label={bn ? 'সূচির যোগফল' : 'Schedule adds up to'}
            value={money(total)}
            tone={gap === 0 ? accents.green : accents.orange}
            hint={gap === 0
              ? (bn ? 'মিলে গেছে' : 'matches')
              : gap > 0
                ? (bn ? `${money(gap)} বেশি` : `${money(gap)} more`)
                : (bn ? `${money(-gap)} কম` : `${money(-gap)} short`)}
          />
          <Text style={s.fieldHint}>
            {bn
              ? 'যোগফল না মিললেও সংরক্ষণ করা যাবে — কিছু ঋণে শেষ কিস্তি আলাদা থাকে।'
              : 'It can be saved even when it does not match — the last instalment is often different.'}
          </Text>
          <View style={[s.chipRow, { marginTop: spacing.sm }]}>
            {[2, 3, 4, 6, 12].map((n) => (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={bn ? `${asciiDigitsToBengali(String(n))} কিস্তিতে ভাগ করুন` : `Split into ${n}`}
                onPress={() => spread(n)}
                style={({ pressed }) => StyleSheet.flatten([s.chipHit, pressed && s.pressed])}
              >
                <View style={s.chip}><Text numberOfLines={1} style={s.chipText}>{bn ? `${asciiDigitsToBengali(String(n))} কিস্তি` : `${n}×`}</Text></View>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card title={`${c.schedule} · ${bn ? asciiDigitsToBengali(String(rows.length)) : rows.length}`}>
          {rows.length === 0 ? (
            <Text style={s.fieldHint}>
              {bn ? 'কোনো কিস্তি নেই। উপরের বোতাম দিয়ে ভাগ করুন, বা নিচে একটি একটি করে যোগ করুন।' : 'No instalments yet. Use the split buttons above, or add them one by one below.'}
            </Text>
          ) : null}

          {parsed.map((r, i) => {
            const locked = r.paidPaisa > 0;
            return (
              <View key={r.key} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
                <View style={styles.rowHead}>
                  <Text style={[styles.seq, { color: colors.textMuted }]}>#{bn ? asciiDigitsToBengali(String(i + 1)) : i + 1}</Text>
                  {locked ? (
                    <View style={[styles.lock, { backgroundColor: accents.green.soft, borderColor: accents.green.border }]}>
                      <AppIcon name="lock-outline" size={icon.xs} color={accents.green.on} />
                      <Text style={[styles.lockText, { color: accents.green.on }]}>
                        {bn ? `${money(r.paidPaisa)} জমা` : `${money(r.paidPaisa)} paid`}
                      </Text>
                    </View>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={bn ? `কিস্তি ${asciiDigitsToBengali(String(i + 1))} মুছুন` : `Remove instalment ${i + 1}`}
                      hitSlop={10}
                      onPress={() => removeRow(r.key)}
                      style={({ pressed }) => StyleSheet.flatten([styles.remove, pressed && s.pressed])}
                    >
                      <AppIcon name="close-circle-outline" size={icon.md} color={colors.textMuted} />
                    </Pressable>
                  )}
                </View>
                <TextInput
                  value={r.amount}
                  onChangeText={(v) => setRow(r.key, { amount: v })}
                  keyboardType="numeric"
                  placeholder={bn ? '০' : '0'}
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel={bn ? `কিস্তি ${asciiDigitsToBengali(String(i + 1))}-এর পরিমাণ` : `Instalment ${i + 1} amount`}
                  style={[s.input, { backgroundColor: colors.surface }]}
                />
                <AppDateField
                  value={r.dueDate}
                  onChange={(v) => setRow(r.key, { dueDate: v })}
                  clearable
                  placeholder={bn ? 'তারিখ নেই' : 'No date'}
                  accessibilityLabel={bn ? `কিস্তি ${i + 1}-এর তারিখ` : `Instalment ${i + 1} due date`}
                />
                {locked && r.paisa < r.paidPaisa ? (
                  <Text style={[s.fieldHint, { color: colors.danger }]}>
                    {bn ? `জমা ${money(r.paidPaisa)}-এর কম করা যাবে না` : `Cannot be less than the ${money(r.paidPaisa)} already paid`}
                  </Text>
                ) : null}
              </View>
            );
          })}

          <Pressable
            accessibilityRole="button"
            onPress={addRow}
            style={({ pressed }) => StyleSheet.flatten([s.ghost, { marginTop: spacing.sm }, pressed && s.pressed])}
          >
            <AppIcon name="plus" size={icon.sm} color={colors.primary} />
            <Text style={s.ghostText}>{c.addInstallment}</Text>
          </Pressable>
        </Card>

        {view.balance.nextDueDate ? (
          <Card>
            <Stat
              label={bn ? 'বর্তমানে পরবর্তী কিস্তি' : 'Currently next due'}
              value={formatLongDate(view.balance.nextDueDate.slice(0, 10), bn)}
              hint={money(view.balance.nextDuePaisa)}
            />
          </Card>
        ) : null}

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      <FormBar onCancel={leave} onSave={() => void save()} saving={busy} saveLabel={c.save} cancelLabel={c.cancel} />

      <AppConfirmDialog
        visible={guard.confirming}
        title={c.unsavedAsk}
        description={c.unsavedWarn}
        confirmLabel={c.discard}
        cancelLabel={c.keepEditing}
        danger
        icon="alert"
        onConfirm={() => { guard.setConfirming(false); back(); }}
        onCancel={() => guard.setConfirming(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: border.thin, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, gap: spacing.xs },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: spacing.sm},
  seq: { ...typography.meta, fontWeight: '800' },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: border.thin, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  lockText: { ...typography.caption, fontWeight: '700' },
  remove: { width: control.iconButtonSize, height: 32, alignItems: 'flex-end', justifyContent: 'center' },
});

function safeParse(v: string): number {
  try { return parseTakaToPaisa(v); } catch { return 0; }
}

function addMonths(dayKey: string, n: number): string {
  const d = new Date(`${dayKey.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  const target = d.getMonth() + n;
  const y = d.getFullYear() + Math.floor(target / 12);
  const m = ((target % 12) + 12) % 12;
  const day = Math.min(d.getDate(), new Date(y, m + 1, 0).getDate());
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const addMonth = (dayKey: string) => addMonths(dayKey, 1);
