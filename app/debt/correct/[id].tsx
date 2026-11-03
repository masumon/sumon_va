// Correcting a ledger row.
//
// A payment that was typed as 5,000 when it was 500 has to be fixable, but the module's
// whole promise is that a counted figure is never quietly rewritten. So this screen does
// what a bookkeeper does with a pen: the original entry is struck through and stays on the
// page, and the corrected one is written beside it. The preview at the bottom says exactly
// that before anything is saved.

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { AppText as Text } from '../../../src/ui/AppText';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppConfirmDialog, useAppFeedback } from '../../../src/ui/AppFeedback';
import { getTransactionDetail, type TransactionDetail } from '../../../src/services/debt/debt-service';
import { correctTransaction } from '../../../src/services/debt/editing';
import { syncFinanceEntryToDebtCorrection } from '../../../src/services/money-bridge';
import { useUnsavedGuard } from '../../../src/hooks/useUnsavedGuard';
import { paisaToTakaString, parseTakaToPaisa } from '../../../src/services/debt/money';
import { DEFAULT_PAYMENT_METHODS } from '../../../src/services/debt/types';
import { methodLabel, txnKindLabel } from '../../../src/i18n/debt';
import { bangladeshDateKey } from '../../../src/i18n/date-time';
import { AppDateField, isValidDayKey } from '../../../src/ui/AppDateField';
import { Card, ChipGroup, DebtHeader, EmptyNote, Field, FormBar, Stat, useDebt } from '../../../src/ui/DebtKit';
import { success, warn } from '../../../src/ui/haptics';
import { spacing } from '../../../src/theme';
import { splitOwnWords, withOwnWords } from '../../../src/services/money-rules';
import { logAppError } from '../../../src/services/error-log';

export default function CorrectTransactionScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { s, c, bn, colors, accents, money, language } = useDebt();
  const { showSnackbar } = useAppFeedback();

  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'SAVE' | null>(null);

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [methodOther, setMethodOther] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setReady(true); return; }
    try {
      const d = await getTransactionDetail(db, id);
      setDetail(d);
      if (d) {
        setAmount(paisaToTakaString(d.txn.amountPaisa));
        setDate(d.txn.txnDate.slice(0, 10));
        const m = splitOwnWords(d.txn.method, DEFAULT_PAYMENT_METHODS);
        setMethod(m.key);
        setMethodOther(m.text);
        setReference(d.txn.reference ?? '');
        setNote(d.txn.note ?? '');
        setDirty(false);
      }
    } catch { setDetail(null); }
    finally { setReady(true); }
  }, [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const edited = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setDirty(true); };

  const paisa = useMemo(() => { try { return parseTakaToPaisa(amount); } catch { return 0; } }, [amount]);
  const guard = useUnsavedGuard(dirty && !busy);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`/debt/txn/${id}` as never);
  };
  const leave = () => guard.attemptLeave(back);

  if (!ready) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!detail || !id) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={s.container} contentContainerStyle={s.content}>
        <DebtHeader title={c.correctTxn} />
        <EmptyNote icon="book-remove-outline" text={bn ? 'লেনদেন পাওয়া যায়নি' : 'Transaction not found'} />
      </ScrollView>
    );
  }

  const t = detail.txn;
  const kind = txnKindLabel(t.kind, language);

  if (t.reversed || t.kind === 'REVERSAL') {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={s.container} contentContainerStyle={s.content}>
        <DebtHeader title={c.correctTxn} subtitle={kind} />
        <EmptyNote
          icon="close-circle-outline"
          text={bn ? 'এই সারিটি ইতিমধ্যে বাতিল — এটি সংশোধন করা যায় না।' : 'This entry is already reversed, so it cannot be corrected.'}
        />
      </ScrollView>
    );
  }

  const changed = paisa !== t.amountPaisa
    || (date ?? '') !== t.txnDate.slice(0, 10)
    || (withOwnWords(method, methodOther) ?? null) !== (t.method ?? null)
    || (reference.trim() || null) !== (t.reference ?? null)
    || (note.trim() || null) !== (t.note ?? null);

  const save = async () => {
    setConfirm(null);
    if (busy || !id) return;
    if (paisa <= 0) { warn(); showSnackbar(bn ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount', 'danger'); return; }
    if (!isValidDayKey(date)) { warn(); showSnackbar(bn ? 'তারিখ সঠিক নয়' : 'That date is not valid', 'danger'); return; }
    setBusy(true);
    try {
      const replacement = await correctTransaction(
        db, id,
        { amountPaisa: paisa, txnDate: date!, method: withOwnWords(method, methodOther), reference: reference.trim() || null, note: note.trim() || null },
        bangladeshDateKey(new Date()),
      );
      // A wallet expense riding along with this row (see money-bridge) has to move by the
      // same correction and follow the link to the replacement's new id.
      await syncFinanceEntryToDebtCorrection(db, id, { id: replacement.id, amountPaisa: replacement.amountPaisa, txnDate: replacement.txnDate }).catch(() => {});
      success();
      showSnackbar(bn ? 'সংশোধিত হয়েছে' : 'Corrected', 'success');
      router.replace(`/debt/txn/${replacement.id}` as never);
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/correct/id', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  const isRepayment = t.kind === 'PAYMENT' || t.kind === 'RECEIPT';

  return (
    <View style={s.container}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <DebtHeader title={c.correctTxn} subtitle={`${kind} · ${detail.person?.name ?? ''}`} onBack={() => guard.attemptLeave(() => router.dismissTo('/debt' as never))} />

        <Card>
          <Text style={s.fieldHint}>{c.correctHint}</Text>
        </Card>

        <Card title={bn ? 'সংশোধিত তথ্য' : 'Corrected entry'}>
          <Field label={`${c.amount} (৳)`} value={amount} onChangeText={edited(setAmount)} keyboardType="numeric" placeholder={bn ? '০' : '0'} />
          <AppDateField label={c.date} value={date} onChange={edited(setDate)} />
          {isRepayment ? (
            <ChipGroup
              label={bn ? 'মাধ্যম' : 'Method'}
              options={DEFAULT_PAYMENT_METHODS}
              value={method as (typeof DEFAULT_PAYMENT_METHODS)[number] | null}
              onChange={(v) => edited(setMethod)(v)}
              labelOf={(k) => methodLabel(k, language)}
            />
          ) : null}
          {isRepayment && method === 'OTHER' ? (
            <Field label={bn ? 'কোন মাধ্যমে' : 'Which method'} value={methodOther} onChangeText={edited(setMethodOther)} placeholder={bn ? 'নিজে লিখুন' : 'Type it'} />
          ) : null}
          <Field label={bn ? 'রেফারেন্স' : 'Reference'} value={reference} onChangeText={edited(setReference)} placeholder={bn ? 'ট্রানজেকশন আইডি ইত্যাদি' : 'Transaction id etc.'} />
          <Field label={c.note} value={note} onChangeText={edited(setNote)} multiline placeholder={c.note} />
        </Card>

        {changed ? (
          <Card title={bn ? 'যা হবে' : 'What will happen'}>
            <Stat label={bn ? 'পুরনো সারি' : 'Old entry'} value={`${money(t.amountPaisa)} · ${t.txnDate.slice(0, 10)}`} tone={accents.orange} hint={bn ? 'বাতিল হয়ে খতিয়ানে থাকবে' : 'Struck through, kept in the ledger'} />
            <Stat label={bn ? 'নতুন সারি' : 'New entry'} value={`${money(paisa)} · ${date ?? '—'}`} tone={accents.green} />
            {isRepayment ? (
              <Text style={s.fieldHint}>
                {bn
                  ? 'কিস্তিতে বণ্টন নতুন করে হিসাব হবে — সংশোধিত টাকা যেখানে যাওয়ার কথা, সেখানেই যাবে।'
                  : 'The instalment allocation is recalculated, so the corrected amount lands where it should.'}
              </Text>
            ) : null}
            {detail.sources.length && paisa !== t.amountPaisa ? (
              <Text style={s.fieldHint}>
                {bn
                  ? 'টাকার অঙ্ক বদলাচ্ছে বলে পুরনো “টাকার উৎস” বহন করা হবে না — উৎসের যোগফল আর মিলত না।'
                  : 'The funding sources are not carried over, because they would no longer add up to the amount.'}
              </Text>
            ) : null}
          </Card>
        ) : null}

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      <FormBar
        onCancel={leave}
        onSave={() => setConfirm('SAVE')}
        saving={busy}
        disabled={!changed}
        saveLabel={c.correct}
        cancelLabel={c.cancel}
      />

      <AppConfirmDialog
        visible={confirm !== null || guard.confirming}
        title={guard.confirming ? c.unsavedAsk : (bn ? 'সংশোধন করবেন?' : 'Save this correction?')}
        description={guard.confirming ? c.unsavedWarn : c.correctHint}
        confirmLabel={guard.confirming ? c.discard : c.correct}
        cancelLabel={guard.confirming ? c.keepEditing : c.cancel}
        icon={guard.confirming ? 'alert' : 'information'}
        danger={guard.confirming}
        onConfirm={() => (guard.confirming ? (guard.setConfirming(false), back()) : void save())}
        onCancel={() => { setConfirm(null); guard.setConfirming(false); }}
      />
    </View>
  );
}
