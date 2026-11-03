// Borrowing more on an account that already exists.
//
// `topUpAccount` was written and tested and reachable only from inside the payment flow's
// "borrowed to repay" path. Taking another 5,000 from the same lender — the single most
// ordinary thing that happens to a hand loan — had no screen, so people opened a second
// account for the same person and the totals split in two.
//
// A top-up is a new principal tranche, not an edit: the original loan and the extra both
// stay in the ledger with their own dates, which is what makes the history readable later.

import { useCallback, useMemo, useState } from 'react';
import { listWallets, type Wallet } from '../../../src/services/wallet-service';
import { recordWalletSideOfNewDebt } from '../../../src/services/money-bridge';
import { atomic } from '../../../src/database/atomic';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { AppText as Text } from '../../../src/ui/AppText';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppConfirmDialog, useAppFeedback } from '../../../src/ui/AppFeedback';
import { getAccountView, topUpAccount, type AccountView } from '../../../src/services/debt/debt-service';
import { parseTakaToPaisa } from '../../../src/services/debt/money';
import { bangladeshDateKey } from '../../../src/i18n/date-time';
import { AppDateField, isValidDayKey } from '../../../src/ui/AppDateField';
import { Card, DebtHeader, EmptyNote, Field, FormBar, Stat, useDebt } from '../../../src/ui/DebtKit';
import { useUnsavedGuard } from '../../../src/hooks/useUnsavedGuard';
import { success, warn } from '../../../src/ui/haptics';
import { FundSourcePicker, WalletPicker, backDatedNote, moneyDetailsProblem } from '../../../src/ui/MoneyPickers';
import type { FundSource } from '../../../src/services/finance-service';
import { spacing } from '../../../src/theme';
import { logAppError } from '../../../src/services/error-log';

export default function TopUpScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { s, c, bn, colors, accents, money } = useDebt();
  const { showSnackbar } = useAppFeedback();

  const [view, setView] = useState<AccountView | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'SAVE' | null>(null);

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<string | null>(bangladeshDateKey(new Date()));
  // Borrowing more puts more money somewhere. Say where, and the wallet moves with it.
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [walletId, setWalletId] = useState<string | null>(null);
  // Lending more takes money out, so it names whose money it was.
  const [fundSource, setFundSource] = useState<FundSource | null>(null);
  const [fundAccountId, setFundAccountId] = useState<string | null>(null);
  const [fundNote, setFundNote] = useState('');
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setReady(true); return; }
    try {
      const [v, ws] = await Promise.all([getAccountView(db, id), listWallets(db)]);
      setView(v); setWallets(ws);
      // No pocket is picked for the person — a guessed wallet is a quietly wrong balance.
      // save() asks for one instead (the v1.0 rule: every money move names its wallet).
    }
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
        <DebtHeader title={c.topUp} />
        <EmptyNote icon="wallet-outline" text={bn ? 'হিসাব পাওয়া যায়নি' : 'Account not found'} />
      </ScrollView>
    );
  }

  const isDebt = view.account.direction === 'DEBT';

  const save = async () => {
    setConfirm(null);
    if (busy || !id) return;
    if (paisa <= 0) { warn(); showSnackbar(bn ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount', 'danger'); return; }
    if (!isValidDayKey(date)) { warn(); showSnackbar(bn ? 'তারিখ সঠিক নয়' : 'That date is not valid', 'danger'); return; }
    const problem = moneyDetailsProblem({ walletId, needsSource: !isDebt, fundSource }, bn);
    if (problem) { warn(); showSnackbar(problem, 'danger'); return; }
    setBusy(true);
    try {
      // The ledger row and the wallet side, together or not at all.
      await atomic(db, async () => {
        const txn = await topUpAccount(db, id, paisa, date!, note.trim() || undefined);
        if (walletId) {
          await recordWalletSideOfNewDebt(db, {
            transactionId: txn.id,
            direction: view?.account.direction === 'RECEIVABLE' ? 'RECEIVABLE' : 'DEBT',
            amountPaisa: paisa,
            walletId,
            fundSource: isDebt ? null : fundSource,
            fundAccountId: !isDebt && fundSource === 'LOAN' ? fundAccountId : null,
            fundNote: !isDebt && fundSource === 'OTHER' ? fundNote : null,
            occurredAt: date!,
            personId: view?.account.personId ?? null,
            note: note.trim() || null,
          });
        }
      });
      success();
      showSnackbar(bn ? 'যোগ হয়েছে' : 'Added', 'success');
      router.replace(`/debt/account/${id}` as never);
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/topup/id', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  return (
    <View style={s.container}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <DebtHeader
          title={isDebt ? c.topUp : (bn ? 'আরও ধার দিন' : 'Lend more')}
          subtitle={view.account.title || view.person?.name || undefined}
          onBack={() => guard.attemptLeave(() => router.dismissTo('/debt' as never))}
        />

        <Card>
          <Text style={s.fieldHint}>
            {isDebt
              ? c.topUpHint
              : (bn ? 'একই ব্যক্তিকে আরও টাকা দিলে এখানে যোগ করুন।' : 'Add to this account when you lend the same person more.')}
          </Text>
        </Card>

        <Card title={bn ? 'নতুন কিস্তি নয় — নতুন ধার' : 'A new tranche, not a payment'}>
          <Field label={`${c.amount} (৳)`} value={amount} onChangeText={edited(setAmount)} keyboardType="numeric" placeholder={bn ? '০' : '0'} />
          <AppDateField label={c.date} value={date} onChange={edited(setDate)} />

          {/* The label follows the direction: borrowing more brings money in, lending more
              takes it out (it used to say "came in" for both). */}
          <WalletPicker
            label={isDebt ? (bn ? 'টাকা কোন মানিব্যাগে এলো' : 'Into which wallet') : (bn ? 'টাকা কোন মানিব্যাগ থেকে গেল' : 'Out of which wallet')}
            value={walletId}
            onChange={edited(setWalletId)}
            wallets={wallets}
            onWalletsChange={setWallets}
            note={backDatedNote(date, bangladeshDateKey(new Date()), isDebt, bn)}
          />
          {!isDebt ? (
            <FundSourcePicker value={fundSource} onChange={edited(setFundSource)} note={fundNote} onNoteChange={setFundNote} loanAccountId={fundAccountId} onLoanAccountChange={setFundAccountId} excludeAccountId={id ?? null} />
          ) : null}
          <Field
            label={c.note}
            value={note}
            onChangeText={edited(setNote)}
            placeholder={bn ? 'কী কারণে নিলেন' : 'What it was for'}
          />
        </Card>

        {paisa > 0 ? (
          <Card title={bn ? 'যা হবে' : 'What will happen'}>
            <Stat label={bn ? 'এখনকার মূল টাকা' : 'Principal now'} value={money(view.balance.principalPaisa)} />
            <Stat label={bn ? 'যোগ হবে' : 'Adding'} value={money(paisa)} tone={accents.orange} />
            <Stat label={bn ? 'নতুন মূল টাকা' : 'New principal'} value={money(view.balance.principalPaisa + paisa)} tone={accents.red} />
            {view.installments.length ? (
              <Text style={s.fieldHint}>
                {bn
                  ? 'কিস্তির সূচি নিজে থেকে বদলাবে না — দরকার হলে “সূচি সম্পাদনা” থেকে ঠিক করে নিন।'
                  : 'The instalment plan does not change by itself — adjust it from “Edit plan” if you need to.'}
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
        disabled={paisa <= 0}
        saveLabel={c.save}
        cancelLabel={c.cancel}
      />

      <AppConfirmDialog
        visible={confirm !== null || guard.confirming}
        title={guard.confirming ? c.unsavedAsk : (bn ? 'যোগ করবেন?' : 'Add this?')}
        description={guard.confirming
          ? c.unsavedWarn
          : (bn
            ? `মূল টাকা ${money(view.balance.principalPaisa)} থেকে ${money(view.balance.principalPaisa + paisa)} হবে।`
            : `The principal goes from ${money(view.balance.principalPaisa)} to ${money(view.balance.principalPaisa + paisa)}.`)}
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
