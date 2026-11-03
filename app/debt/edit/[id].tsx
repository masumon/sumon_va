// Editing an account.
//
// The screen is split the way the data is. Everything above "মূল টাকা" is descriptive —
// a title, a purpose, a due date, the interest terms — and is written straight to the row
// with an audit entry. The principal is not: it is the sum of the account's ledger
// tranches, so changing it strikes those through and writes a corrected one, which is why
// it sits behind its own confirmation and its own explanation.

import { asciiDigitsToBengali, bengaliDigitsToAscii, parseTakaToPaisa, paisaToTakaString } from '../../../src/services/debt/money';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../../src/ui/AppText';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppConfirmDialog, useAppFeedback } from '../../../src/ui/AppFeedback';
import { getAccountView, type AccountView } from '../../../src/services/debt/debt-service';
import { correctPrincipal, deleteAccount, updateAccountDetails } from '../../../src/services/debt/editing';
import { listPeople } from '../../../src/services/debt/repository';
import { DEFAULT_PURPOSES, type InterestBasis, type InterestType, type Person, type Priority, type RatePeriod } from '../../../src/services/debt/types';
import { interestBasisLabel, interestTypeLabel, priorityLabel, purposeLabel } from '../../../src/i18n/debt';
import { bangladeshDateKey } from '../../../src/i18n/date-time';
import { AppDateField, isValidDayKey } from '../../../src/ui/AppDateField';
import { AppIcon } from '../../../src/ui/AppIcon';
import { Card, ChipGroup, DebtHeader, Field, FormBar, useDebt } from '../../../src/ui/DebtKit';
import { useUnsavedGuard } from '../../../src/hooks/useUnsavedGuard';
import { MultiChipGroup, ToggleRow, joinMulti, splitMulti } from '../../../src/ui/AppKit';
import { PersonPicker } from '../../../src/ui/DebtPickers';
import { success, warn } from '../../../src/ui/haptics';
import { icon, spacing } from '../../../src/theme';
import { logAppError } from '../../../src/services/error-log';

/** Bengali numerals inside Bengali text. Android mis-measures a line that mixes ASCII
 *  digits with Bengali and cuts it short, so every number in a Bengali sentence goes
 *  through here. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

const INTEREST_TYPES: InterestType[] = ['FLAT_TOTAL', 'SIMPLE', 'COMPOUND', 'MONTHLY_FLAT'];
const BASES: InterestBasis[] = ['ORIGINAL', 'REDUCING'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
const PERIODS: RatePeriod[] = ['YEAR', 'MONTH', 'WEEK', 'DAY'];

type Pending = 'PRINCIPAL' | 'DELETE' | null;

export default function EditAccountScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { s, c, bn, colors, money, language } = useDebt();
  const { showSnackbar } = useAppFeedback();

  const [view, setView] = useState<AccountView | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  // form state
  const [personId, setPersonId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [typedName, setTypedName] = useState('');
  const [purposes, setPurposes] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  // The switches mirror what is stored: interest is on when a type is set, instalments
  // are on when a schedule exists. Turning one off clears its terms on save.
  const [hasInterest, setHasInterest] = useState(false);
  const [openedDate, setOpenedDate] = useState<string | null>(null);
  const [firstDue, setFirstDue] = useState<string | null>(null);
  const [finalDue, setFinalDue] = useState<string | null>(null);
  const [interestType, setInterestType] = useState<InterestType>('NONE');
  const [basis, setBasis] = useState<InterestBasis>('ORIGINAL');
  const [ratePct, setRatePct] = useState('');
  const [period, setPeriod] = useState<RatePeriod>('YEAR');
  const [flatTotal, setFlatTotal] = useState('');
  const [notes, setNotes] = useState('');
  const [principal, setPrincipal] = useState('');
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setReady(true); return; }
    try {
      const [v, ppl] = await Promise.all([getAccountView(db, id), listPeople(db)]);
      setView(v); setPeople(ppl);
      const a = v.account;
      setPersonId(a.personId);
      setTitle(a.title ?? '');
      setPurposes(splitMulti(a.purpose));
      setPriorities(splitMulti(a.priority));
      setTypedName('');
      setHasInterest(a.interestType !== 'NONE');
      setOpenedDate(a.openedDate);
      setFirstDue(a.firstDueDate);
      setFinalDue(a.finalDueDate);
      setInterestType(a.interestType === 'NONE' ? 'MONTHLY_FLAT' : a.interestType);
      setBasis(a.interestBasis);
      setRatePct(a.interestRateBps ? String(a.interestRateBps / 100) : '');
      setPeriod((a.compoundPeriod ?? a.interestPeriod ?? 'YEAR') as RatePeriod);
      setFlatTotal(a.manualTotalPayablePaisa ? paisaToTakaString(a.manualTotalPayablePaisa) : '');
      setNotes(a.notes ?? '');
      setPrincipal(paisaToTakaString(v.balance.principalPaisa));
      setDirty(false);
    } catch { setView(null); }
    finally { setReady(true); }
  }, [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Every setter goes through this so the leave-guard knows whether anything moved.
  const edited = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setDirty(true); };

  const guard = useUnsavedGuard(dirty && !busy);
  const leave = () => guard.attemptLeave(() => {
    if (router.canGoBack()) router.back(); else router.replace(`/debt/account/${id}` as never);
  });

  if (!ready) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!view || !id) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={s.container} contentContainerStyle={s.content}>
        <DebtHeader title={c.editAccount} />
        <Text style={s.statLabel}>{bn ? 'হিসাব পাওয়া যায়নি' : 'Account not found'}</Text>
      </ScrollView>
    );
  }

  const a = view.account;
  const showRate = hasInterest && interestType !== 'FLAT_TOTAL';
  const principalPaisa = safeParse(principal);
  const principalChanged = principalPaisa > 0 && principalPaisa !== view.balance.principalPaisa;

  const save = async () => {
    if (busy) return;
    if (openedDate && !isValidDayKey(openedDate)) { warn(); showSnackbar(bn ? 'তারিখ সঠিক নয়' : 'That date is not valid', 'danger'); return; }
    const rateBps = showRate && ratePct.trim() ? Math.round(parseFloat(ratePct) * 100) : null;
    if (showRate && ratePct.trim() && !Number.isFinite(rateBps)) {
      warn(); showSnackbar(bn ? 'সুদের হার সঠিক নয়' : 'That interest rate is not valid', 'danger'); return;
    }
    setBusy(true);
    try {
      await updateAccountDetails(db, id, {
        personId: personId ?? a.personId,
        title: title.trim() || null,
        purpose: joinMulti(purposes),
        priority: (joinMulti(priorities) ?? 'MEDIUM') as Priority,
        notes: notes.trim() || null,
        openedDate,
        firstDueDate: firstDue,
        finalDueDate: finalDue,
        // Switched off means nothing about interest is stored — no type, rate or basis,
        // so nothing accrues and nothing is shown next time this account is opened.
        interestType: hasInterest ? interestType : 'NONE',
        interestBasis: hasInterest ? basis : 'ORIGINAL',
        interestRateBps: hasInterest ? rateBps : null,
        interestPeriod: hasInterest ? (interestType === 'MONTHLY_FLAT' ? 'MONTH' : (showRate ? period : null)) : null,
        compoundPeriod: hasInterest && interestType === 'COMPOUND' ? period : null,
        manualTotalPayablePaisa: hasInterest && interestType === 'FLAT_TOTAL' && flatTotal.trim() ? safeParse(flatTotal) : null,
      });
      success();
      showSnackbar(bn ? 'সংরক্ষিত হয়েছে' : 'Saved', 'success');
      router.replace(`/debt/account/${id}` as never);
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/edit/id', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  const runPending = async () => {
    const task = pending;
    setPending(null);
    if (!task || !id) return;
    setBusy(true);
    try {
      if (task === 'PRINCIPAL') {
        await correctPrincipal(db, id, principalPaisa, bangladeshDateKey(new Date()), bn ? 'মূল টাকা সংশোধন' : 'principal corrected');
        success();
        showSnackbar(bn ? 'মূল টাকা সংশোধিত' : 'Principal corrected', 'success');
        await load();
      } else {
        await deleteAccount(db, id);
        success();
        showSnackbar(bn ? 'মুছে ফেলা হয়েছে' : 'Deleted', 'success');
        router.replace('/debt/accounts' as never);
      }
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/edit/id', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  const dialog = () => {
    if (pending === 'PRINCIPAL') return {
      title: bn ? 'মূল টাকা সংশোধন করবেন?' : 'Correct the principal?',
      description: bn
        ? `${money(view.balance.principalPaisa)} থেকে ${money(principalPaisa)} হবে। পুরনো সারিটি বাতিল হয়ে খতিয়ানে থেকে যাবে।`
        : `From ${money(view.balance.principalPaisa)} to ${money(principalPaisa)}. The old entry is struck through and stays in the ledger.`,
      confirm: c.correct,
    };
    if (pending === 'DELETE') return { title: c.deleteAccountAsk, description: c.deleteAccountWarn, confirm: c.deleteAccount };
    return { title: c.unsavedAsk, description: c.unsavedWarn, confirm: c.discard };
  };

  return (
    <View style={s.container}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <DebtHeader title={c.editAccount} subtitle={a.title || view.person?.name || undefined} onBack={() => guard.attemptLeave(() => router.dismissTo('/debt' as never))} />

        <Card title={bn ? 'পরিচয়' : 'Details'}>
          <PersonPicker
            people={people}
            personId={personId}
            onPickExisting={(v) => edited(setPersonId)(v)}
            typedName={typedName}
            onTypeName={(v) => { setTypedName(v); setDirty(true); }}
          />

          <Field label={bn ? 'শিরোনাম' : 'Title'} value={title} onChangeText={edited(setTitle)} placeholder={bn ? 'যেমন: ব্যাংক গাড়ি ঋণ' : 'e.g. Bank car loan'} />

          <MultiChipGroup
            label={c.purpose}
            options={DEFAULT_PURPOSES}
            values={purposes}
            onChange={(v) => { setPurposes(v); setDirty(true); }}
            labelOf={(k) => purposeLabel(k, language)}
            otherKey="OTHER"
            addPlaceholder={bn ? 'নিজের কারণ লিখুন' : 'Your own reason'}
          />

          <MultiChipGroup
            label={c.priority}
            options={PRIORITIES}
            values={priorities}
            onChange={(v) => { setPriorities(v); setDirty(true); }}
            labelOf={(k) => priorityLabel(k, language)}
            addPlaceholder={bn ? 'নিজের অগ্রাধিকার' : 'Your own priority'}
            hint={bn ? 'পরিকল্পনা পর্দায় “নিজের ক্রম” এই অগ্রাধিকার মেনে চলে।' : 'The plan screen’s custom order follows this.'}
          />

          <Field label={c.note} value={notes} onChangeText={edited(setNotes)} multiline placeholder={c.note} />
        </Card>

        <Card title={bn ? 'তারিখ' : 'Dates'}>
          <AppDateField label={bn ? 'গ্রহণের তারিখ' : 'Date taken'} value={openedDate} onChange={edited(setOpenedDate)} clearable />
          <AppDateField label={bn ? 'প্রথম কিস্তির তারিখ' : 'First due date'} value={firstDue} onChange={edited(setFirstDue)} clearable />
          <AppDateField label={c.dueDate} value={finalDue} onChange={edited(setFinalDue)} clearable />
          <Text style={s.fieldHint}>
            {bn
              ? 'কিস্তি না থাকলে এই শেষ তারিখটিই সময় পেরোনো ধরা ও রিমাইন্ডারের ভিত্তি।'
              : 'With no instalment plan, this final date is what overdue and reminders work from.'}
          </Text>
        </Card>

        <Card>
          <ToggleRow
            icon="percent-outline"
            label={bn ? 'সুদ প্রযোজ্য' : 'Interest applies'}
            hint={bn ? 'বন্ধ করলে সুদের হিসাব সম্পূর্ণ বন্ধ হবে।' : 'Off means no interest is calculated at all.'}
            value={hasInterest}
            onChange={(v) => edited(setHasInterest)(v)}
          />
          {hasInterest ? (
          <ChipGroup
            label={bn ? 'সুদের ধরন' : 'Interest type'}
            options={INTEREST_TYPES}
            value={interestType}
            onChange={(v) => edited(setInterestType)(v ?? 'MONTHLY_FLAT')}
            labelOf={(k) => interestTypeLabel(k, language)}
          />
          ) : null}
          {interestType === 'FLAT_TOTAL' ? (
            <Field label={bn ? 'মোট ফেরতযোগ্য (৳)' : 'Total repayable (৳)'} value={flatTotal} onChangeText={edited(setFlatTotal)} keyboardType="numeric" placeholder={bn ? '০' : '0'} />
          ) : null}
          {showRate ? (
            <>
              <Field label={bn ? 'হার %' : 'Rate %'} value={ratePct} onChangeText={(t) => edited(setRatePct)(bengaliDigitsToAscii(t))} keyboardType="numeric" placeholder={bn ? '০' : '0'} />
              {interestType !== 'MONTHLY_FLAT' ? (
                <ChipGroup
                  label={bn ? 'প্রতি' : 'Per'}
                  options={PERIODS}
                  value={period}
                  onChange={(v) => edited(setPeriod)(v ?? 'YEAR')}
                  labelOf={(k) => periodLabel(k, bn)}
                />
              ) : null}
              <ChipGroup
                label={c.interestBasis}
                options={BASES}
                value={basis}
                onChange={(v) => edited(setBasis)(v ?? 'ORIGINAL')}
                labelOf={(k) => interestBasisLabel(k, language)}
                hint={basis === 'ORIGINAL'
                  ? (bn ? 'যতই শোধ করুন, সুদ মূল টাকার উপরেই বসবে — হাতধারের ঋণ সাধারণত এভাবেই চলে।' : 'Interest keeps being charged on the full amount however much is repaid — how a hand loan usually works.')
                  : (bn ? 'পরিশোধের সঙ্গে সঙ্গে সুদের ভিত্তি কমবে — ব্যাংক ঋণের মতো।' : 'The base falls as you repay — like a bank loan.')}
              />
            </>
          ) : null}
        </Card>

        <Card>
          <ToggleRow
            icon="calendar-month-outline"
            label={bn ? 'কিস্তি প্রযোজ্য' : 'Instalments apply'}
            hint={view.installments.length
              ? (bn ? `${asciiDigitsToBengali(String(view.installments.length))}টি কিস্তি আছে` : `${bnNum(view.installments.length)} instalments set`)
              : (bn ? 'এখনো কোনো কিস্তির সূচি নেই।' : 'No schedule yet.')}
            value={view.installments.length > 0}
            onChange={() => router.push(`/debt/schedule/${id}` as never)}
          />
          <Text style={s.fieldHint}>
            {bn ? 'কিস্তির অঙ্ক ও তারিখ “সূচি সম্পাদনা” পর্দায় বদলানো যায়।' : 'Amounts and dates are edited on the schedule screen.'}
          </Text>
        </Card>

        <Card title={bn ? 'মূল টাকা' : 'Principal'}>
          <Text style={s.fieldHint}>
            {bn
              ? 'মূল টাকা খতিয়ানের সারি থেকে আসে, তাই এটি বদলালে পুরনো সারি বাতিল হয়ে নতুন সারি লেখা হবে — ইতিহাস মুছবে না।'
              : 'The principal comes from the ledger, so changing it strikes the old entry through and writes a corrected one. Nothing is erased.'}
          </Text>
          <Field label={`${c.amount} (৳)`} value={principal} onChangeText={setPrincipal} keyboardType="numeric" placeholder={bn ? '০' : '0'} />
          {principalChanged ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setPending('PRINCIPAL')}
              style={({ pressed }) => StyleSheet.flatten([s.ghost, { marginTop: spacing.sm }, busy && s.disabled, pressed && s.pressed])}
            >
              <AppIcon name="pencil-outline" size={icon.sm} color={colors.primary} />
              <Text style={s.ghostText}>
                {money(view.balance.principalPaisa)} → {money(principalPaisa)}
              </Text>
            </Pressable>
          ) : null}
        </Card>

        <Card title={bn ? 'বিপজ্জনক' : 'Danger zone'}>
          <Text style={s.fieldHint}>{c.deleteAccountWarn}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => setPending('DELETE')}
            style={({ pressed }) => StyleSheet.flatten([s.dangerBtn, { marginTop: spacing.sm }, busy && s.disabled, pressed && s.pressed])}
          >
            <AppIcon name="trash-can-outline" size={icon.sm} color={colors.danger} />
            <Text style={s.dangerText}>{c.deleteAccount}</Text>
          </Pressable>
        </Card>

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      <FormBar
        onCancel={leave}
        onSave={() => void save()}
        saving={busy}
        saveLabel={c.save}
        cancelLabel={c.cancel}
      />

      <AppConfirmDialog
        visible={pending !== null || guard.confirming}
        title={dialog().title}
        description={dialog().description}
        confirmLabel={dialog().confirm}
        cancelLabel={pending === null ? c.keepEditing : c.cancel}
        danger={pending === 'DELETE'}
        icon={pending === 'DELETE' ? 'alert' : 'information'}
        onConfirm={() => (guard.confirming ? (guard.setConfirming(false), (router.canGoBack() ? router.back() : router.replace(`/debt/account/${id}` as never))) : void runPending())}
        onCancel={() => { setPending(null); guard.setConfirming(false); }}
      />
    </View>
  );
}

function periodLabel(p: RatePeriod, bn: boolean): string {
  return { YEAR: bn ? 'বছর' : 'yr', MONTH: bn ? 'মাস' : 'mo', WEEK: bn ? 'সপ্তাহ' : 'wk', DAY: bn ? 'দিন' : 'day' }[p];
}

function safeParse(v: string): number {
  try { return parseTakaToPaisa(v); } catch { return 0; }
}
