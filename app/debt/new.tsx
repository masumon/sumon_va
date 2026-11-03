// Recording a new debt or receivable.
//
// The form is ordered the way the conversation goes: who, how much, when, why — then, only
// if they apply, the terms. Interest and instalments are behind switches because most hand
// loans have neither, and showing a rate box and a schedule to someone who borrowed 2,000
// from a cousin is asking them to ignore half the screen. Nothing below a switch runs, is
// stored or is calculated while that switch is off.

import { useEffect, useMemo, useRef, useState } from 'react';
import { bangladeshDateKey, businessInstant } from '../../src/i18n/date-time';
import { listWallets, type Wallet } from '../../src/services/wallet-service';
import { recordWalletSideOfNewDebt } from '../../src/services/money-bridge';
import { atomic } from '../../src/database/atomic';
import { ScrollView, View } from 'react-native';
import { AppText as Text } from '../../src/ui/AppText';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppConfirmDialog, useAppFeedback } from '../../src/ui/AppFeedback';
import { createDebtWithTransaction, createReceivableWithTransaction } from '../../src/services/debt/debt-service';
import { FundSourcePicker, WalletPicker, backDatedNote, moneyDetailsProblem } from '../../src/ui/MoneyPickers';
import type { FundSource } from '../../src/services/finance-service';
import { createPerson, listPeople, updatePerson } from '../../src/services/debt/repository';
import { computeInterest } from '../../src/services/debt/interest';
import { asciiDigitsToBengali, bengaliDigitsToAscii, formatPaisa, parseTakaToPaisa } from '../../src/services/debt/money';
import { pickContact, describeContactDenial } from '../../src/services/capture/contacts';
import { DEFAULT_PURPOSES } from '../../src/services/debt/types';
import type { InterestBasis, InterestType, Person, RatePeriod } from '../../src/services/debt/types';
import { interestBasisLabel, interestTypeLabel, priorityLabel, purposeLabel } from '../../src/i18n/debt';
import { AppDateField, isValidDayKey } from '../../src/ui/AppDateField';
import { AppIcon } from '../../src/ui/AppIcon';
import { Card, ChipGroup, DebtHeader, Field, FormBar, useDebt } from '../../src/ui/DebtKit';
import { useUnsavedGuard } from '../../src/hooks/useUnsavedGuard';
import { MultiChipGroup, ToggleRow, joinMulti } from '../../src/ui/AppKit';
import { PersonPicker } from '../../src/ui/DebtPickers';
import { success, warn } from '../../src/ui/haptics';
import { icon, spacing } from '../../src/theme';
import { logAppError } from '../../src/services/error-log';

const INTEREST_TYPES: InterestType[] = ['FLAT_TOTAL', 'SIMPLE', 'COMPOUND', 'MONTHLY_FLAT'];
const BASES: InterestBasis[] = ['ORIGINAL', 'REDUCING'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
const PERIODS: RatePeriod[] = ['YEAR', 'MONTH', 'WEEK', 'DAY'];

/** One month on, clamping the day-of-month (31 Jan + 1 = 28/29 Feb). */
function addMonth(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  const t = d.getMonth() + 1;
  const y = d.getFullYear() + Math.floor(t / 12);
  const m = ((t % 12) + 12) % 12;
  const dd = Math.min(d.getDate(), new Date(y, m + 1, 0).getDate());
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export default function NewAccountScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ direction?: string }>();
  const direction = params.direction === 'RECEIVABLE' ? 'RECEIVABLE' : 'DEBT';
  // Borrowing puts money in a pocket; lending takes it out. Recording only the loan left
  // the wallets untouched, so the money appeared from nowhere or vanished into it.
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [walletId, setWalletId] = useState<string | null>(null);
  // Lending takes money out, so it names whose money it was; borrowing is always loan money.
  const [fundSource, setFundSource] = useState<FundSource | null>(null);
  const [fundAccountId, setFundAccountId] = useState<string | null>(null);
  const [fundNote, setFundNote] = useState('');
  const { s, c, bn, colors, language } = useDebt();
  const { showSnackbar } = useAppFeedback();

  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState<string | null>(null);
  const [typedName, setTypedName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [address, setAddress] = useState('');
  const [importing, setImporting] = useState(false);

  const [amount, setAmount] = useState('');
  const [openedDate, setOpenedDate] = useState<string | null>(bangladeshDateKey(new Date()));
  const [finalDue, setFinalDue] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [purposes, setPurposes] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>(['MEDIUM']);
  const [notes, setNotes] = useState('');

  // Terms — everything under these switches is inert until they are on.
  const [hasInterest, setHasInterest] = useState(false);
  const [interestType, setInterestType] = useState<InterestType>('MONTHLY_FLAT');
  const [basis, setBasis] = useState<InterestBasis>('ORIGINAL');
  const [ratePct, setRatePct] = useState('');
  const [period, setPeriod] = useState<RatePeriod>('MONTH');
  const [flatTotal, setFlatTotal] = useState('');

  const [hasInstalments, setHasInstalments] = useState(false);
  const [instCount, setInstCount] = useState('');
  const [firstDue, setFirstDue] = useState<string | null>(addMonth(bangladeshDateKey(new Date())));

  const [saving, setSaving] = useState(false);
  // `saving` is state, so two taps in one frame both read it false; the ref does not.
  const savingRef = useRef(false);

  useEffect(() => { void listPeople(db).then(setPeople).catch(() => setPeople([])); }, [db]);
  useEffect(() => {
    // Nothing is picked for the person: a wallet chosen by default is a guess, and a guessed
    // wallet is a balance that is quietly wrong (the user's rule for v1.0 — every money
    // movement names its wallet, chosen by the person).
    void listWallets(db).then(setWallets).catch(() => setWallets([]));
  }, [db]);

  const dirty = !!(amount.trim() || typedName.trim() || personId || title.trim() || notes.trim() || purposes.length);
  const guard = useUnsavedGuard(dirty && !saving);
  const isDebt = direction === 'DEBT';
  const showRate = hasInterest && interestType !== 'FLAT_TOTAL';

  const importContact = async () => {
    setImporting(true);
    try {
      const r = await pickContact();
      if (r.status === 'picked') {
        setPersonId(null);
        setTypedName(r.contact.name);
        if (r.contact.phone) setPhone(r.contact.phone);
        success();
      } else if (r.status === 'denied') {
        warn();
        const info = describeContactDenial(bn, r.blocked);
        showSnackbar(info.message, 'danger', info.action);
      } else if (r.status === 'unavailable') {
        warn();
        showSnackbar(bn ? 'ফোনবুক খোলা গেল না' : 'Could not open contacts', 'danger');
      }
    } finally { setImporting(false); }
  };

  // What the loan will actually cost, live, from the engine the account page uses.
  const preview = useMemo(() => {
    if (!hasInterest) return null;
    let principal = 0;
    try { principal = parseTakaToPaisa(amount); } catch { return null; }
    if (principal <= 0) return null;
    const rateBps = showRate && ratePct.trim() ? Math.round(parseFloat(ratePct) * 100) : null;
    if (showRate && (!rateBps || !Number.isFinite(rateBps))) return null;
    const months = hasInstalments && Number(instCount) > 0 ? Number(instCount) : 12;
    const start = openedDate ?? bangladeshDateKey(new Date());
    let end = start;
    for (let i = 0; i < months; i += 1) end = addMonth(end);
    const r = computeInterest({
      principalPaisa: principal,
      interestType,
      interestRateBps: rateBps,
      interestPeriod: interestType === 'MONTHLY_FLAT' ? 'MONTH' : period,
      compoundPeriod: interestType === 'COMPOUND' ? period : null,
      interestBasis: basis,
      manualTotalPayablePaisa: interestType === 'FLAT_TOTAL' && flatTotal.trim() ? safeTaka(flatTotal) : null,
      openedDate: start,
    }, `${end}T00:00:00`);
    if (r.interestPaisa <= 0) return null;
    const fmt = (v: number) => formatPaisa(v, { bnDigits: bn });
    const span = hasInstalments && Number(instCount) > 0
      ? (bn ? ` · ${asciiDigitsToBengali(instCount)} কিস্তিতে` : ` over ${instCount} instalments`)
      : (bn ? ' · ১ বছরে' : ' over a year');
    return {
      total: fmt(r.totalPayablePaisa),
      detail: bn ? `মূল ${fmt(principal)} + সুদ ${fmt(r.interestPaisa)}${span}` : `${fmt(principal)} + ${fmt(r.interestPaisa)} interest${span}`,
    };
  }, [hasInterest, hasInstalments, amount, interestType, ratePct, period, basis, flatTotal, instCount, openedDate, showRate, bn]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/debt'));
  const leave = () => guard.attemptLeave(goBack);

  const save = async () => {
    if (saving || savingRef.current) return;
    let paisa = 0;
    try { paisa = parseTakaToPaisa(amount); } catch { paisa = 0; }
    if (paisa <= 0) { warn(); showSnackbar(bn ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount', 'danger'); return; }
    const name = typedName.trim();
    if (!personId && !name) { warn(); showSnackbar(bn ? 'ব্যক্তির নাম দিন' : 'Enter a person', 'danger'); return; }
    if (openedDate && !isValidDayKey(openedDate)) { warn(); showSnackbar(bn ? 'তারিখ সঠিক নয়' : 'That date is not valid', 'danger'); return; }
    const problem = moneyDetailsProblem({ walletId, needsSource: !isDebt, fundSource }, bn);
    if (problem) { warn(); showSnackbar(problem, 'danger'); return; }

    savingRef.current = true;
    setSaving(true);
    try {
      // Reuse an existing person when the typed name matches one exactly — the commonest
      // way duplicate people were created was retyping a name that already existed.
      let pid = personId;
      if (!pid && name) {
        const existing = people.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
        pid = existing
          ? existing.id
          : (await createPerson(db, {
              name,
              phone: phone.trim() || null,
              relationship: relationship.trim() || null,
              address: address.trim() || null,
            })).id;
      }
      // Contact details typed here belong to the person, so they are saved on them.
      if (pid && (phone.trim() || relationship.trim() || address.trim())) {
        const target = people.find((p) => p.id === pid);
        await updatePerson(db, pid, {
          phone: phone.trim() || (target?.phone ?? null),
          relationship: relationship.trim() || (target?.relationship ?? null),
          address: address.trim() || (target?.address ?? null),
        }).catch(() => null);
      }

      const rateBps = showRate && ratePct.trim() ? Math.round(parseFloat(ratePct) * 100) : null;
      if (rateBps !== null && !Number.isFinite(rateBps)) throw new Error(bn ? 'সুদের হার সঠিক নয়' : 'That interest rate is not valid');

      const input = {
        personId: pid!,
        title: title.trim() || null,
        principalPaisa: paisa,
        openedDate,
        purpose: joinMulti(purposes),
        priority: (joinMulti(priorities) ?? 'MEDIUM') as never,
        notes: notes.trim() || null,
        finalDueDate: finalDue,
        // Off means off: no type, no rate, no basis stored at all.
        interestType: hasInterest ? interestType : ('NONE' as InterestType),
        interestRateBps: hasInterest ? rateBps : null,
        interestPeriod: hasInterest ? (interestType === 'MONTHLY_FLAT' ? ('MONTH' as RatePeriod) : (showRate ? period : null)) : null,
        compoundPeriod: hasInterest && interestType === 'COMPOUND' ? period : null,
        interestBasis: hasInterest ? basis : ('ORIGINAL' as InterestBasis),
        manualTotalPayablePaisa: hasInterest && interestType === 'FLAT_TOTAL' && flatTotal.trim() ? parseTakaToPaisa(flatTotal) : null,
        // No schedule is built unless instalments were switched on.
        installmentCount: hasInstalments && instCount.trim() ? Math.max(0, parseInt(instCount, 10) || 0) : undefined,
        firstDueDate: hasInstalments ? firstDue : null,
      };
      // One boundary: an account that exists with no money ever having arrived is worse
      // than no account at all, because the balance is then a claim nobody can trace.
      const acc = await atomic(db, async () => {
        // With its opening ledger row, so the wallet side is linked to it — that link is
        // how "entries without a wallet" can tell this one already has one.
        const { account: created, transaction } = isDebt
          ? await createDebtWithTransaction(db, input)
          : await createReceivableWithTransaction(db, input);
        if (walletId) {
          await recordWalletSideOfNewDebt(db, {
            transactionId: transaction.id,
            fundSource: isDebt ? null : fundSource,
            fundAccountId: !isDebt && fundSource === 'LOAN' ? fundAccountId : null,
            fundNote: !isDebt && fundSource === 'OTHER' ? fundNote : null,
            direction: isDebt ? 'DEBT' : 'RECEIVABLE',
            amountPaisa: paisa,
            walletId,
            // Today in Dhaka, not today in UTC: a loan opened after midnight was being
            // filed on the previous day, and on the 1st into the previous month.
            occurredAt: openedDate ?? businessInstant(),
            personId: created.personId ?? null,
          });
        }
        return created;
      });
      success();
      showSnackbar(bn ? 'সংরক্ষিত হয়েছে' : 'Saved', 'success');
      router.replace(`/debt/account/${acc.id}` as never);
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/new', e, bn ? 'সংরক্ষণ হয়নি' : 'Could not save'), 'danger');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <View style={s.container}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        <DebtHeader title={isDebt ? c.addDebt : c.addReceivable} onBack={() => guard.attemptLeave(() => router.dismissTo('/debt' as never))} />

        <Card title={isDebt ? (bn ? 'কার কাছ থেকে নিয়েছেন' : 'Who it is from') : (bn ? 'কাকে দিয়েছেন' : 'Who it went to')}>
          <PersonPicker
            people={people}
            personId={personId}
            onPickExisting={setPersonId}
            typedName={typedName}
            onTypeName={setTypedName}
            onImportContact={() => void importContact()}
            importing={importing}
            label={bn ? 'নাম' : 'Name'}
          />
          {!personId ? (
            <>
              <Field label={c.phone} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder={bn ? '০১৭…' : '01…'} />
              <Field label={c.relationship} value={relationship} onChangeText={setRelationship} placeholder={bn ? 'যেমন: ভাই, প্রতিবেশী' : 'e.g. brother, neighbour'} />
              <Field label={c.address} value={address} onChangeText={setAddress} placeholder={c.address} />
            </>
          ) : null}
        </Card>

        <Card title={bn ? 'টাকা ও তারিখ' : 'Amount and dates'}>
          <Field label={`${c.amount} (৳)`} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder={bn ? '০' : '0'} />
          <AppDateField label={isDebt ? (bn ? 'কবে নিয়েছেন' : 'Date taken') : (bn ? 'কবে দিয়েছেন' : 'Date given')} value={openedDate} onChange={setOpenedDate} />

          {/* Borrowing puts the money somewhere; lending takes it from somewhere. Naming the
              pocket keeps the wallet and the ledger telling one story. */}
          <WalletPicker
            label={isDebt ? (bn ? 'টাকা কোন মানিব্যাগে এলো' : 'Into which wallet') : (bn ? 'টাকা কোন মানিব্যাগ থেকে গেল' : 'Out of which wallet')}
            value={walletId}
            onChange={setWalletId}
            wallets={wallets}
            onWalletsChange={setWallets}
            note={backDatedNote(openedDate, bangladeshDateKey(new Date()), isDebt, bn)}
          />
          {!isDebt ? (
            <FundSourcePicker value={fundSource} onChange={setFundSource} note={fundNote} onNoteChange={setFundNote} loanAccountId={fundAccountId} onLoanAccountChange={setFundAccountId} />
          ) : null}
          <AppDateField
            label={c.dueDate}
            value={finalDue}
            onChange={setFinalDue}
            clearable
            placeholder={bn ? 'ঠিক করা নেই' : 'Not set'}
          />
          <Text style={s.fieldHint}>
            {bn
              ? 'ফেরতের তারিখ দিলে সময় পেরোনো ধরা ও রিমাইন্ডার কাজ করবে। ফাঁকা রাখলে কোনো রিমাইন্ডার আসবে না।'
              : 'A due date is what overdue and reminders work from. Left blank, no reminder is ever scheduled.'}
          </Text>
        </Card>

        <Card title={bn ? 'কী কারণে' : 'What it was for'}>
          <Field label={bn ? 'শিরোনাম' : 'Title'} value={title} onChangeText={setTitle} placeholder={bn ? 'যেমন: ব্যাংক গাড়ি ঋণ' : 'e.g. Bank car loan'} />
          <MultiChipGroup
            label={c.purpose}
            options={DEFAULT_PURPOSES}
            values={purposes}
            onChange={setPurposes}
            labelOf={(k) => purposeLabel(k, language)}
            otherKey="OTHER"
            addPlaceholder={bn ? 'নিজের কারণ লিখুন' : 'Your own reason'}
            hint={bn ? 'একাধিক বেছে নিতে পারেন, নিজেরটাও লিখতে পারেন।' : 'Pick as many as apply, or add your own.'}
          />
          <MultiChipGroup
            label={c.priority}
            options={PRIORITIES}
            values={priorities}
            onChange={setPriorities}
            labelOf={(k) => priorityLabel(k, language)}
            addPlaceholder={bn ? 'নিজের অগ্রাধিকার' : 'Your own priority'}
          />
          <Field label={c.note} value={notes} onChangeText={setNotes} multiline placeholder={c.note} />
        </Card>

        <Card>
          <ToggleRow
            icon="percent-outline"
            label={bn ? 'সুদ প্রযোজ্য' : 'Interest applies'}
            hint={bn ? 'সুদ না থাকলে বন্ধ রাখুন — বেশিরভাগ হাতধারে সুদ থাকে না।' : 'Leave off when there is none — most hand loans have none.'}
            value={hasInterest}
            onChange={setHasInterest}
          />
          {hasInterest ? (
            <View style={{ marginTop: spacing.sm }}>
              <ChipGroup
                label={bn ? 'সুদের ধরন' : 'Interest type'}
                options={INTEREST_TYPES}
                value={interestType}
                onChange={(v) => setInterestType(v ?? 'MONTHLY_FLAT')}
                labelOf={(k) => interestTypeLabel(k, language)}
              />
              {interestType === 'FLAT_TOTAL' ? (
                <Field label={bn ? 'মোট ফেরতযোগ্য (৳)' : 'Total repayable (৳)'} value={flatTotal} onChangeText={setFlatTotal} keyboardType="numeric" placeholder={bn ? '০' : '0'} />
              ) : (
                <>
                  <Field label={bn ? 'হার %' : 'Rate %'} value={ratePct} onChangeText={(t) => setRatePct(bengaliDigitsToAscii(t))} keyboardType="numeric" placeholder={bn ? '০' : '0'} />
                  {interestType !== 'MONTHLY_FLAT' ? (
                    <ChipGroup
                      label={bn ? 'প্রতি' : 'Per'}
                      options={PERIODS}
                      value={period}
                      onChange={(v) => setPeriod(v ?? 'YEAR')}
                      labelOf={(k) => periodLabel(k, bn)}
                    />
                  ) : null}
                  <ChipGroup
                    label={c.interestBasis}
                    options={BASES}
                    value={basis}
                    onChange={(v) => setBasis(v ?? 'ORIGINAL')}
                    labelOf={(k) => interestBasisLabel(k, language)}
                    hint={basis === 'ORIGINAL'
                      ? (bn ? 'যতই শোধ করুন, সুদ মূল টাকার উপরেই বসবে।' : 'Interest stays on the full amount however much is repaid.')
                      : (bn ? 'পরিশোধের সঙ্গে সঙ্গে সুদের ভিত্তি কমবে।' : 'The base falls as you repay.')}
                  />
                </>
              )}
              {preview ? (
                <View style={styles.preview(colors.primary, colors.surfaceMuted)}>
                  <AppIcon name="calculator-variant-outline" size={icon.sm} color={colors.primary} />
                  <View style={s.grow}>
                    <Text style={s.listMeta}>{c.totalWithInterest} · {c.estimated}</Text>
                    <Text style={s.big}>{preview.total}</Text>
                    <Text style={s.listMeta}>{preview.detail}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}
        </Card>

        <Card>
          <ToggleRow
            icon="calendar-month-outline"
            label={bn ? 'কিস্তি প্রযোজ্য' : 'Instalments apply'}
            hint={bn ? 'একবারে শোধ হলে বন্ধ রাখুন। পরে যেকোনো সময় সূচি যোগ করা যাবে।' : 'Leave off for a single repayment. A schedule can be added later.'}
            value={hasInstalments}
            onChange={setHasInstalments}
          />
          {hasInstalments ? (
            <View style={{ marginTop: spacing.sm }}>
              <Field label={bn ? 'কয় কিস্তিতে' : 'How many instalments'} value={instCount} onChangeText={(t) => setInstCount(bengaliDigitsToAscii(t))} keyboardType="numeric" placeholder={bn ? '০' : '0'} />
              <AppDateField label={bn ? 'প্রথম কিস্তির তারিখ' : 'First instalment due'} value={firstDue} onChange={setFirstDue} />
              <Text style={s.fieldHint}>
                {bn
                  ? 'সমান কিস্তিতে ভাগ হবে, প্রতি মাসে একটি। সংরক্ষণের পর “সূচি সম্পাদনা” থেকে যেকোনো কিস্তির অঙ্ক বা তারিখ বদলানো যাবে।'
                  : 'Split evenly, one a month. Any amount or date can be changed afterwards from “Edit plan”.'}
              </Text>
            </View>
          ) : null}
        </Card>

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      <FormBar onCancel={leave} onSave={() => void save()} saving={saving} saveLabel={c.save} cancelLabel={c.cancel} />

      <AppConfirmDialog
        visible={guard.confirming}
        title={c.unsavedAsk}
        description={c.unsavedWarn}
        confirmLabel={c.discard}
        cancelLabel={c.keepEditing}
        danger
        icon="alert"
        onConfirm={() => { guard.setConfirming(false); goBack(); }}
        onCancel={() => guard.setConfirming(false)}
      />
    </View>
  );
}

function safeTaka(v: string): number {
  try { return parseTakaToPaisa(v); } catch { return 0; }
}

function periodLabel(p: string, bn: boolean): string {
  return ({ YEAR: bn ? 'বছর' : 'yr', MONTH: bn ? 'মাস' : 'mo', WEEK: bn ? 'সপ্তাহ' : 'wk', DAY: bn ? 'দিন' : 'day' } as Record<string, string>)[p] ?? p;
}

const styles = {
  preview: (borderColor: string, backgroundColor: string) => ({
    flexDirection: 'row' as const,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor,
    backgroundColor,
  }),
};
