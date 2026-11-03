// Adjustments — the amounts that are neither borrowing nor repayment.
//
// A lender waives the last 500. A late fee of 200 is added. A figure was mis-recorded
// years ago and the two sides agree on a number. `addAdjustment` has always existed in
// the service layer; it simply had no screen, so there was no way to record any of that
// except by inventing a fake payment, which then lied about how much money moved.

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { AppText as Text } from '../../../src/ui/AppText';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppConfirmDialog, useAppFeedback } from '../../../src/ui/AppFeedback';
import { addAdjustment, getAccountView, type AccountView } from '../../../src/services/debt/debt-service';
import { parseTakaToPaisa } from '../../../src/services/debt/money';
import { bangladeshDateKey } from '../../../src/i18n/date-time';
import { AppDateField, isValidDayKey } from '../../../src/ui/AppDateField';
import { Card, Chip, DebtHeader, EmptyNote, Field, FormBar, Stat, useDebt } from '../../../src/ui/DebtKit';
import { useUnsavedGuard } from '../../../src/hooks/useUnsavedGuard';
import { success, warn } from '../../../src/ui/haptics';
import { spacing } from '../../../src/theme';
import { logAppError } from '../../../src/services/error-log';

export default function AdjustScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { s, c, bn, colors, accents, money } = useDebt();
  const { showSnackbar } = useAppFeedback();

  const [view, setView] = useState<AccountView | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'SAVE' | null>(null);

  const [sign, setSign] = useState<1 | -1>(-1);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<string | null>(bangladeshDateKey(new Date()));
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setReady(true); return; }
    try { setView(await getAccountView(db, id)); }
    catch { setView(null); }
    finally { setReady(true); }
  }, [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const edited = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setDirty(true); };
  const paisa = useMemo(() => { try { return parseTakaToPaisa(amount); } catch { return 0; } }, [amount]);
  const guard = useUnsavedGuard(dirty && !busy);

  const back = () => (router.canGoBack() ? router.back() : router.replace(`/debt/account/${id}` as never));
  const leave = () => guard.attemptLeave(back);

  if (!ready) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!view || !id) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={s.container} contentContainerStyle={s.content}>
        <DebtHeader title={c.adjust} />
        <EmptyNote icon="wallet-outline" text={bn ? 'হিসাব পাওয়া যায়নি' : 'Account not found'} />
      </ScrollView>
    );
  }

  const isDebt = view.account.direction === 'DEBT';
  const after = Math.max(0, view.balance.remainingPaisa + sign * paisa);

  // "দেনা কমান" reads wrong on a receivable — there it is the amount they owe you.
  const increaseLabel = isDebt ? c.adjustAdd : (bn ? 'পাওনা বাড়ান' : 'Increase what is owed');
  const decreaseLabel = isDebt ? c.adjustSub : (bn ? 'পাওনা কমান' : 'Reduce what is owed');

  const save = async () => {
    setConfirm(null);
    if (busy || !id) return;
    if (paisa <= 0) { warn(); showSnackbar(bn ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount', 'danger'); return; }
    if (!isValidDayKey(date)) { warn(); showSnackbar(bn ? 'তারিখ সঠিক নয়' : 'That date is not valid', 'danger'); return; }
    if (!reason.trim()) { warn(); showSnackbar(bn ? 'কারণ লিখুন' : 'Give a reason', 'danger'); return; }
    setBusy(true);
    try {
      await addAdjustment(db, id, paisa, sign, reason.trim(), date!);
      success();
      showSnackbar(bn ? 'সমন্বয় যোগ হয়েছে' : 'Adjustment recorded', 'success');
      router.replace(`/debt/account/${id}` as never);
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/adjust/id', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  return (
    <View style={s.container}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <DebtHeader title={c.adjust} subtitle={view.account.title || view.person?.name || undefined} onBack={() => guard.attemptLeave(() => router.dismissTo('/debt' as never))} />

        <Card>
          <Text style={s.fieldHint}>{c.adjustHint}</Text>
        </Card>

        <Card title={bn ? 'কী করতে চান' : 'What is this'}>
          <View style={s.chipRow}>
            <Chip label={decreaseLabel} icon="minus-circle-outline" active={sign === -1} onPress={() => edited(setSign)(-1)} />
            <Chip label={increaseLabel} icon="plus-circle-outline" active={sign === 1} onPress={() => edited(setSign)(1)} />
          </View>
          <Text style={s.fieldHint}>
            {sign === -1
              ? (bn ? 'যেমন: মাফ, ছাড়, বা আগের ভুল হিসাব কমানো। কোনো টাকা হাতবদল হয়নি।' : 'A waiver, a discount, or correcting an over-recorded figure. No money changed hands.')
              : (bn ? 'যেমন: দেরির জরিমানা, বা আগের ভুল হিসাব বাড়ানো। কোনো টাকা হাতবদল হয়নি।' : 'A late fee, or correcting an under-recorded figure. No money changed hands.')}
          </Text>

          <Field label={`${c.amount} (৳)`} value={amount} onChangeText={edited(setAmount)} keyboardType="numeric" placeholder={bn ? '০' : '0'} />
          <AppDateField label={c.date} value={date} onChange={edited(setDate)} />
          <Field
            label={c.reason}
            value={reason}
            onChangeText={edited(setReason)}
            multiline
            placeholder={sign === -1 ? (bn ? 'যেমন: শেষ ৫০০ টাকা মাফ করেছেন' : 'e.g. the last 500 was waived') : (bn ? 'যেমন: দেরির জরিমানা' : 'e.g. late fee')}
            hint={bn ? 'কারণটি খতিয়ানে থেকে যাবে — পরে নিজেই বুঝতে পারবেন কেন হিসাব বদলেছিল।' : 'The reason stays in the ledger, so the change makes sense to you later.'}
          />
        </Card>

        {paisa > 0 ? (
          <Card title={bn ? 'যা হবে' : 'What will happen'}>
            <Stat label={bn ? 'এখন বাকি' : 'Owed now'} value={money(view.balance.remainingPaisa)} />
            <Stat
              label={bn ? 'সমন্বয়ের পরে' : 'After the adjustment'}
              value={money(after)}
              tone={sign === -1 ? accents.green : accents.orange}
            />
          </Card>
        ) : null}

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      <FormBar
        onCancel={leave}
        onSave={() => setConfirm('SAVE')}
        saving={busy}
        disabled={paisa <= 0 || !reason.trim()}
        saveLabel={c.save}
        cancelLabel={c.cancel}
      />

      <AppConfirmDialog
        visible={confirm !== null || guard.confirming}
        title={guard.confirming ? c.unsavedAsk : (bn ? 'সমন্বয় যোগ করবেন?' : 'Record this adjustment?')}
        description={guard.confirming
          ? c.unsavedWarn
          : (bn ? `বাকি ${money(view.balance.remainingPaisa)} থেকে ${money(after)} হবে। খতিয়ানে সারিটি থেকে যাবে।` : `Owed goes from ${money(view.balance.remainingPaisa)} to ${money(after)}. The entry stays in the ledger.`)}
        confirmLabel={guard.confirming ? c.discard : c.save}
        cancelLabel={guard.confirming ? c.keepEditing : c.cancel}
        icon={guard.confirming ? 'alert' : 'information'}
        danger={guard.confirming}
        onConfirm={() => (guard.confirming ? (guard.setConfirming(false), back()) : void save())}
        onCancel={() => { setConfirm(null); guard.setConfirming(false); }}
      />
    </View>
  );
}
