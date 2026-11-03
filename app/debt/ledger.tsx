import { useCallback, useMemo, useState } from 'react';
import { formatBangladeshDate , bangladeshDateKey } from '../../src/i18n/date-time';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../src/ui/AppText';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppConfirmDialog, useAppFeedback } from '../../src/ui/AppFeedback';
import { reverseTransaction } from '../../src/services/debt/debt-service';
import { removeFinanceEntryForReversedDebt } from '../../src/services/money-bridge';
import { countLedger, listAccounts, listLedger, listPeople } from '../../src/services/debt/repository';
import type { Account, Person, Transaction, TxnKind } from '../../src/services/debt/types';
import { RecordPreview } from '../../src/ui/RecordPreview';

import { asciiDigitsToBengali } from '../../src/services/debt/money';
import { AppIcon, type IconName } from '../../src/ui/AppIcon';
import { Card, Chip, DebtHeader, EmptyNote, useDebt } from '../../src/ui/DebtKit';
import { AppDateField } from '../../src/ui/AppDateField';
import { success, warn } from '../../src/ui/haptics';
import { icon, spacing } from '../../src/theme';
import { logAppError } from '../../src/services/error-log';

type Filter = 'ALL' | 'PAYMENT' | 'RECEIPT' | 'NEW' | 'OTHER';
const FILTERS: Filter[] = ['ALL', 'PAYMENT', 'RECEIPT', 'NEW', 'OTHER'];

const KIND_ICON: Record<string, IconName> = {
  NEW_DEBT: 'cash-plus', NEW_RECEIVABLE: 'cash-plus', PAYMENT: 'cash-minus', RECEIPT: 'cash-minus',
  ADJUSTMENT: 'tune', REVERSAL: 'close-circle-outline', SETTLEMENT: 'handshake-outline',
  WRITE_OFF: 'cancel', INTEREST_ACCRUAL: 'percent-outline',
};
const KIND_LABEL: Record<string, [string, string]> = {
  NEW_DEBT: ['ঋণ গ্রহণ', 'Debt taken'], NEW_RECEIVABLE: ['ঋণ প্রদান', 'Loan given'],
  PAYMENT: ['পরিশোধ', 'Payment'], RECEIPT: ['আদায়', 'Receipt'], ADJUSTMENT: ['সমন্বয়', 'Adjustment'],
  REVERSAL: ['বাতিল', 'Reversal'], SETTLEMENT: ['মিটমাট', 'Settlement'], WRITE_OFF: ['অবলোপন', 'Write-off'],
  INTEREST_ACCRUAL: ['সুদ', 'Interest'],
};

const PAGE = 100;

function matches(kind: TxnKind, f: Filter): boolean {
  if (f === 'ALL') return true;
  if (f === 'NEW') return kind === 'NEW_DEBT' || kind === 'NEW_RECEIVABLE';
  if (f === 'PAYMENT') return kind === 'PAYMENT' || kind === 'SETTLEMENT';
  if (f === 'RECEIPT') return kind === 'RECEIPT';
  return kind === 'ADJUSTMENT' || kind === 'REVERSAL' || kind === 'WRITE_OFF' || kind === 'INTEREST_ACCRUAL';
}

export default function DebtLedger() {
  const db = useSQLiteContext();
  const { s, c, bn, colors, accents, money, language } = useDebt();
  const fmtDate = (value: string | null | undefined) => (value ? formatBangladeshDate(value, language) : '—');
  const { showSnackbar } = useAppFeedback();

  const [txns, setTxns] = useState<Transaction[]>([]);

  const [preview, setPreview] = useState<{ id: string; title: string; who: string | null; date: string; amount: string; note: string | null; reversed: boolean } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [personId, setPersonId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [pageSize, setPageSize] = useState(PAGE);
  const [total, setTotal] = useState(0);
  const [ready, setReady] = useState(false);
  const [pendingReverse, setPendingReverse] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      // The query does the narrowing now. It used to pull a flat 300 rows and filter in
      // JavaScript, so anything older than the 300th row was simply unreachable.
      const scope = {
        personId: personId ?? undefined,
        fromDate: fromDate ?? undefined,
        toDate: toDate ?? undefined,
      };
      const [t, n, a, p] = await Promise.all([
        listLedger(db, { ...scope, limit: pageSize }),
        countLedger(db, scope),
        listAccounts(db, {}),
        listPeople(db),
      ]);
      setTxns(t); setTotal(n); setAccounts(a); setPeople(p);
    } catch { setTxns([]); }
    finally { setReady(true); }
  }, [db, personId, fromDate, toDate, pageSize]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const rows = useMemo(() => txns.filter((t) => matches(t.kind, filter)), [txns, filter]);
  const filtersOn = !!(personId || fromDate || toDate);
  const clearFilters = () => { setPersonId(null); setFromDate(null); setToDate(null); setPageSize(PAGE); };

  const doReverse = async () => {
    const txnId = pendingReverse;
    setPendingReverse(null);
    if (!txnId || busy) return;
    setBusy(true);
    try {
      await reverseTransaction(db, txnId, bangladeshDateKey(new Date()));
      // A reversed payment that had a wallet expense riding along with it (see
      // money-bridge) must not leave that expense standing.
      await removeFinanceEntryForReversedDebt(db, txnId).catch(() => {});
      success();
      showSnackbar(bn ? 'বাতিল হয়েছে' : 'Reversed', 'success');
      await load();
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/ledger', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  const filterLabel = (f: Filter): string => {
    if (f === 'ALL') return c.all;
    if (f === 'NEW') return bn ? 'নতুন' : 'New';
    if (f === 'OTHER') return bn ? 'অন্যান্য' : 'Other';
    return bn ? KIND_LABEL[f]![0]! : KIND_LABEL[f]![1]!;
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <DebtHeader title={c.ledger} subtitle={bn ? 'সব লেনদেন — বাতিল করতে চেপে ধরুন।' : 'Every transaction — long-press to reverse.'} />

      <View style={s.chipRow}>
        {FILTERS.map((f) => <Chip key={f} label={filterLabel(f)} active={filter === f} onPress={() => setFilter(f)} />)}
        <Chip
          label={filtersOn ? (bn ? 'ছাঁকনি চালু' : 'Filtered') : (bn ? 'ছাঁকনি' : 'Filter')}
          icon="filter-variant"
          active={showFilters || filtersOn}
          onPress={() => setShowFilters((v) => !v)}
        />
      </View>

      {showFilters ? (
        <Card>
          <Text style={s.label}>{c.person}</Text>
          <View style={s.chipRow}>
            <Chip label={c.all} active={personId === null} onPress={() => { setPersonId(null); setPageSize(PAGE); }} />
            {people.map((p) => (
              <Chip key={p.id} label={p.name} active={personId === p.id} onPress={() => { setPersonId(personId === p.id ? null : p.id); setPageSize(PAGE); }} />
            ))}
          </View>
          <AppDateField label={bn ? 'শুরু' : 'From'} value={fromDate} onChange={(v) => { setFromDate(v); setPageSize(PAGE); }} clearable placeholder={bn ? 'শুরু থেকে' : 'From the beginning'} />
          <AppDateField label={bn ? 'শেষ' : 'To'} value={toDate} onChange={(v) => { setToDate(v); setPageSize(PAGE); }} clearable placeholder={bn ? 'আজ পর্যন্ত' : 'Up to today'} />
          {filtersOn ? (
            <Pressable accessibilityRole="button" onPress={clearFilters} style={({ pressed }) => StyleSheet.flatten([s.ghost, { marginTop: spacing.sm }, pressed && s.pressed])}>
              <AppIcon name="close-circle-outline" size={icon.sm} color={colors.primary} />
              <Text style={s.ghostText}>{bn ? 'ছাঁকনি সরান' : 'Clear filters'}</Text>
            </Pressable>
          ) : null}
        </Card>
      ) : null}

      <View style={{ height: spacing.md }} />

      {!ready ? (
        <ActivityIndicator color={colors.primary} />
      ) : rows.length === 0 ? (
        <EmptyNote icon="book-open-outline" text={bn ? 'কোনো লেনদেন নেই' : 'No transactions yet'} />
      ) : (
        <Card>
          {total > txns.length ? (
            <Text style={[s.listMeta, { marginBottom: spacing.sm }]}>
              {bn
                ? `${asciiDigitsToBengali(String(total))}টির মধ্যে ${asciiDigitsToBengali(String(txns.length))}টি দেখানো হচ্ছে`
                : `Showing ${txns.length} of ${total}`}
            </Text>
          ) : null}
          {rows.map((t) => {
            const a = accById.get(t.accountId);
            const person = personById.get(t.personId);
            const reversible = !t.reversed && t.kind !== 'REVERSAL';
            const tone = t.kind === 'PAYMENT' || t.kind === 'SETTLEMENT' ? accents.green
              : t.kind === 'RECEIPT' ? accents.blue
                : t.kind === 'NEW_DEBT' ? accents.red : accents.orange;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityHint={reversible ? (bn ? 'বাতিল করতে চেপে ধরুন' : 'Long-press to reverse') : undefined}
                onPress={() => setPreview({ id: t.id, title: (bn ? KIND_LABEL[t.kind]?.[0] : KIND_LABEL[t.kind]?.[1]) ?? t.kind, who: person?.name ?? a?.title ?? null, date: fmtDate(t.txnDate), amount: money(t.amountPaisa), note: t.note ?? null, reversed: Boolean(t.reversed) })}
                onLongPress={reversible ? () => setPendingReverse(t.id) : undefined}
                style={({ pressed }) => StyleSheet.flatten([s.listRow, t.reversed && s.disabled, pressed && s.pressed])}
              >
                <AppIcon name={KIND_ICON[t.kind] ?? 'swap-horizontal'} size={icon.sm} color={tone.on} />
                <View style={s.grow}>
                  <Text numberOfLines={1} style={s.listTitle}>
                    {bn ? KIND_LABEL[t.kind]?.[0] ?? t.kind : KIND_LABEL[t.kind]?.[1] ?? t.kind}
                    {t.reversed ? (bn ? ' (বাতিল)' : ' (reversed)') : ''}
                  </Text>
                  <Text numberOfLines={1} style={s.listMeta}>
                    {fmtDate(t.txnDate)} · {person?.name ?? a?.title ?? '—'}{t.note ? ` · ${t.note}` : ''}
                  </Text>
                </View>
                <Text numberOfLines={1} style={s.listAmt}>{money(t.amountPaisa)}</Text>
              </Pressable>
            );
          })}
          {total > txns.length ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setPageSize((n) => n + PAGE)}
              style={({ pressed }) => StyleSheet.flatten([s.ghost, { marginTop: spacing.md }, pressed && s.pressed])}
            >
              <AppIcon name="chevron-down" size={icon.sm} color={colors.primary} />
              <Text style={s.ghostText}>{bn ? 'আরও দেখুন' : 'Load more'}</Text>
            </Pressable>
          ) : null}
        </Card>
      )}

      <AppConfirmDialog
        visible={pendingReverse !== null}
        title={bn ? 'লেনদেন বাতিল করবেন?' : 'Reverse this transaction?'}
        description={bn ? 'হিসাব থেকে বাদ যাবে, তবে খতিয়ানে চিহ্ন থাকবে।' : 'It stops counting, but stays visible in the ledger.'}
        confirmLabel={bn ? 'হ্যাঁ' : 'Yes'}
        cancelLabel={c.cancel}
        danger
        icon="alert"
        onConfirm={() => void doReverse()}
        onCancel={() => setPendingReverse(null)}
      />
    {/* Same read-first preview as the health cards; the transaction page keeps every action. */}
      {preview ? (
        <RecordPreview
          visible
          icon="swap-horizontal"
          title={preview.title}
          subtitle={preview.reversed ? (bn ? 'বাতিল করা হয়েছে' : 'Reversed') : preview.who ?? undefined}
          headline={preview.amount}
          rows={[
            { label: bn ? 'তারিখ' : 'Date', value: preview.date },
            { label: bn ? 'কার সাথে' : 'With', value: preview.who },
            { label: bn ? 'নোট' : 'Note', value: preview.note },
          ]}
          editIcon="open-in-new"
          editLabel={bn ? 'বিস্তারিত খুলুন' : 'Open details'}
          onEdit={() => { const id = preview.id; setPreview(null); router.push(`/debt/txn/${id}` as never); }}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </ScrollView>
  );
}
