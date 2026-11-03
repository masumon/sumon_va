import { useCallback, useMemo, useState } from 'react';
import { AppDateField } from '../../src/ui/AppDateField';
import { formatBangladeshDate , bangladeshDateKey } from '../../src/i18n/date-time';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../src/ui/AppText';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppFeedback } from '../../src/ui/AppFeedback';
import { createPromise, listAccounts, listPeople, listPromises, setPromiseStatus } from '../../src/services/debt/repository';
import { parseTakaToPaisa } from '../../src/services/debt/money';
import type { Account, Person, PromiseStatus, PromiseToPay } from '../../src/services/debt/types';

import { AppIcon } from '../../src/ui/AppIcon';
import { Card, Chip, DebtHeader, EmptyNote, useDebt } from '../../src/ui/DebtKit';
import { success, warn } from '../../src/ui/haptics';
import { icon, spacing } from '../../src/theme';
import { logAppError } from '../../src/services/error-log';

export default function DebtPromises() {
  const db = useSQLiteContext();
  const { s, c, bn, colors, accents, money , language } = useDebt();
  const fmtDate = (value: string | null | undefined) => (value ? formatBangladeshDate(value, language) : '—');
  const { showSnackbar } = useAppFeedback();

  const [promises, setPromises] = useState<PromiseToPay[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const [accountId, setAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(bangladeshDateKey(new Date()));
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [pr, ac, pe] = await Promise.all([listPromises(db), listAccounts(db, {}), listPeople(db)]);
      setPromises(pr); setAccounts(ac); setPeople(pe);
    } catch { setPromises([]); }
    finally { setReady(true); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  // A promise is a date somebody committed to — theirs on a receivable, yours on a debt.
  // Restricting it to receivables meant "I'll pay Karim on the 15th" could not be recorded
  // at all, which is the half of the module the user actually controls.
  const receivables = useMemo(
    () => accounts.filter((a) => !['COMPLETED', 'SETTLED', 'WRITTEN_OFF', 'CANCELLED'].includes(a.status)),
    [accounts],
  );

  const accountLabel = (a: Account) => a.title || personById.get(a.personId)?.name || c.totalReceivable;

  const add = async () => {
    if (busy) return;
    let paisa = 0;
    try { paisa = parseTakaToPaisa(amount); } catch { paisa = 0; }
    if (!accountId || paisa <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      warn();
      showSnackbar(bn ? 'ব্যক্তি, পরিমাণ ও তারিখ দিন' : 'Pick an account, amount and date', 'danger');
      return;
    }
    setBusy(true);
    try {
      await createPromise(db, { accountId, amountPaisa: paisa, promisedDate: date, followUpDate: date, note: note.trim() || null });
      success();
      showSnackbar(bn ? 'যোগ হয়েছে' : 'Added', 'success');
      setAmount(''); setNote('');
      await load();
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/promises', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  const mark = async (id: string, status: PromiseStatus) => {
    try {
      await setPromiseStatus(db, id, status);
      success();
      await load();
    } catch { warn(); }
  };

  const statusLabel = (st: PromiseStatus) => (st === 'FULFILLED' ? c.kept : st === 'BROKEN' ? c.broken : c.pending);

  return (
    <ScrollView keyboardDismissMode="on-drag" style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <DebtHeader title={c.promises} subtitle={c.promiseHint} />

      <Card title={c.addPromise}>
        {receivables.length === 0 ? (
          <Text style={s.statLabel}>{c.noReceivables}</Text>
        ) : (
          <>
            <Text style={s.label}>{c.person}</Text>
            <View style={s.chipRow}>
              {receivables.map((a) => <Chip key={a.id} label={accountLabel(a)} active={accountId === a.id} onPress={() => setAccountId(a.id)} />)}
            </View>
            <Text style={s.label}>{c.amount}</Text>
            <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder={bn ? '০' : '0'} placeholderTextColor={colors.textMuted} accessibilityLabel={c.amount} />
            <AppDateField label={c.date} value={date} onChange={(next) => setDate(next ?? '')} />
            <Text style={s.label}>{c.note}</Text>
            <TextInput style={s.input} value={note} onChangeText={setNote} placeholder={c.note} placeholderTextColor={colors.textMuted} accessibilityLabel={c.note} />
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void add()}
              style={({ pressed }) => StyleSheet.flatten([s.primary, { marginTop: spacing.md }, busy && s.disabled, pressed && s.pressed])}
            >
              <AppIcon name="plus" size={icon.sm} color={colors.onPrimary} />
              <Text style={s.primaryText}>{c.addPromise}</Text>
            </Pressable>
          </>
        )}
      </Card>

      {!ready ? (
        <ActivityIndicator color={colors.primary} />
      ) : promises.length === 0 ? (
        <EmptyNote icon="hand-coin-outline" text={bn ? 'কোনো প্রতিশ্রুতি নেই' : 'No promises yet'} />
      ) : (
        <Card title={c.promises}>
          {promises.map((p) => {
            const a = accById.get(p.accountId);
            const tone = p.status === 'FULFILLED' ? accents.green : p.status === 'BROKEN' ? accents.red : accents.orange;
            return (
              <View key={p.id} style={s.listRow}>
                <View style={s.grow}>
                  <Text numberOfLines={1} style={s.listTitle}>{a ? accountLabel(a) : '—'}</Text>
                  <Text numberOfLines={1} style={s.listMeta}>{fmtDate(p.promisedDate)} · {money(p.amountPaisa)}{p.note ? ` · ${p.note}` : ''}</Text>
                  {p.status === 'OPEN' ? (
                    <View style={[s.chipRow, { marginTop: spacing.xs }]}>
                      <Chip label={c.kept} active={false} onPress={() => void mark(p.id, 'FULFILLED')} />
                      <Chip label={c.broken} active={false} onPress={() => void mark(p.id, 'BROKEN')} />
                    </View>
                  ) : null}
                </View>
                <View style={[s.badge, { backgroundColor: tone.soft, borderColor: tone.border }]}>
                  <Text style={[s.badgeText, { color: tone.on }]}>{statusLabel(p.status)}</Text>
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </ScrollView>
  );
}
