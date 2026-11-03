import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../../src/ui/AppText';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppPreferences } from '../../../src/app/AppPreferences';
import { AppConfirmDialog, useAppFeedback } from '../../../src/ui/AppFeedback';
import { useUnsavedGuard } from '../../../src/hooks/useUnsavedGuard';
import { getAccountView, recordPayment, recordReceipt, type AccountView } from '../../../src/services/debt/debt-service';
import { listWallets, type Wallet } from '../../../src/services/wallet-service';
import { fundSourceFromDebtKey } from '../../../src/services/finance-service';
import { recordWalletSideOfDebtMovement } from '../../../src/services/money-bridge';
import { atomic } from '../../../src/database/atomic';
import { createPerson, listPeople } from '../../../src/services/debt/repository';
import { formatPaisa, parseTakaToPaisa } from '../../../src/services/debt/money';
import { DEFAULT_PAYMENT_METHODS, DEFAULT_PAYMENT_SOURCES, type Person, type SourceLineInput } from '../../../src/services/debt/types';
import { debtCopy, methodLabel, sourceLabel } from '../../../src/i18n/debt';
import { bangladeshDateKey } from '../../../src/i18n/date-time';
import { AppDateField, isValidDayKey } from '../../../src/ui/AppDateField';
import { AppIcon } from '../../../src/ui/AppIcon';
import { success, warn } from '../../../src/ui/haptics';
import { WalletPicker, backDatedNote, moneyDetailsProblem } from '../../../src/ui/MoneyPickers';
import { withOwnWords } from '../../../src/services/money-rules';
import { border, control, elevation, icon, layout, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../../../src/theme';
import { logAppError } from '../../../src/services/error-log';

type SourceLine = { key: string; amount: string; borrowFrom: string | null; newName: string; note: string };

/**
 * Funding that is credit, not cash you held.
 *
 * Money from these did not sit in a wallet before the payment and must not be taken out
 * of one afterwards — it went straight from the lender to the person being repaid.
 */
const CREDIT_SOURCE_KEYS: string[] = ['BORROWED', 'BANK_LOAN', 'CREDIT'];

export default function PaymentScreen() {
  const db = useSQLiteContext();
  const { id, installment } = useLocalSearchParams<{ id?: string; installment?: string }>();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const c = useMemo(() => debtCopy(language), [language]);
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const money = (p: number) => formatPaisa(p, { bnDigits: bn });
  const { showSnackbar } = useAppFeedback();

  const [view, setView] = useState<AccountView | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(bangladeshDateKey(new Date()));
  const [method, setMethod] = useState<string | null>(null);
  // Picking "অন্যান্য" opens a box for the user's own words (the standing rule for every "Other").
  const [methodOther, setMethodOther] = useState('');
  const [reference, setReference] = useState('');
  // Arriving from a tapped instalment on the account screen pre-selects that slice.
  const [instId, setInstId] = useState<string | null>(installment ?? null);
  const [sources, setSources] = useState<SourceLine[]>([]);
  // Which pocket the money actually moves through. Without it the loan went down and no
  // wallet went with it, so the money had come from nowhere.
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // `busy` is state, so two taps in one frame both read it false; the ref does not.
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [v, ppl, ws] = await Promise.all([getAccountView(db, id), listPeople(db), listWallets(db)]);
      setView(v); setPeople(ppl); setWallets(ws);
      // No pocket is picked for the person: a guessed wallet is a balance that is quietly
      // wrong (the v1.0 rule — every money move names a wallet the user chose). The check
      // in submit() asks for one instead.
    } catch { setView(null); }
    finally { setLoaded(true); }
  }, [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const dirty = !!(amount.trim() || reference.trim() || method || instId || sources.length);
  const guard = useUnsavedGuard(dirty && !busy);
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/debt/account/${id}` as never));
  const leave = () => guard.attemptLeave(back);

  if (!loaded) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!view || !id) return <View style={styles.center}><Text style={styles.dim}>{bn ? 'পাওয়া যায়নি' : 'Not found'}</Text></View>;

  const isDebt = view.account.direction === 'DEBT';
  const paisa = safeParse(amount);
  const srcTotal = sources.reduce((s, l) => s + safeParse(l.amount), 0);
  const sourcesUsed = sources.some((l) => l.amount.trim());
  const srcOk = !sourcesUsed || srcTotal === paisa;
  // Money borrowed straight to the lender never sat in a wallet (see CREDIT_SOURCE_KEYS);
  // only the rest has to name the wallet it left. A collection always arrives in one.
  const creditPart = isDebt
    ? sources.filter((l) => l.amount.trim() && CREDIT_SOURCE_KEYS.includes(l.key)).reduce((sum, l) => sum + safeParse(l.amount), 0)
    : 0;
  const walletNeeded = !isDebt || paisa - creditPart > 0;
  // Repaying is money out, so the wallet side names whose money it was — read from the
  // source lines the user already picked (the largest pocket line), not asked twice.
  const pocketLine = isDebt
    ? sources.filter((l) => l.amount.trim() && l.key && !CREDIT_SOURCE_KEYS.includes(l.key))
      .reduce<SourceLine | null>((best, l) => (!best || safeParse(l.amount) > safeParse(best.amount) ? l : best), null)
    : null;
  const pocketFund = pocketLine ? fundSourceFromDebtKey(pocketLine.key) : null;
  const pocketFundNote = pocketFund === 'OTHER' ? (pocketLine?.note.trim() || null) : null;
  const overpayPaisa = Math.max(0, paisa - view.balance.remainingPaisa);

  const addSource = () => setSources((s) => [...s, { key: '', amount: s.length === 0 && amount.trim() ? amount : '', borrowFrom: null, newName: '', note: '' }]);
  const setSrc = (i: number, patch: Partial<SourceLine>) => setSources((s) => s.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const delSrc = (i: number) => setSources((s) => s.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (busy || busyRef.current) return;
    if (paisa <= 0) { warn(); showSnackbar(bn ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount', 'danger'); return; }
    if (!isValidDayKey(date)) { warn(); showSnackbar(bn ? 'তারিখ সঠিক নয়' : 'That date is not valid', 'danger'); return; }
    // The user's rule for v1.0: a repayment names whose money paid it, and money that left
    // a pocket names the pocket.
    if (isDebt && !sourcesUsed) { warn(); showSnackbar(bn ? 'টাকার উৎস যোগ করুন — কোন টাকা দিয়ে শোধ করলেন (বেতন, সঞ্চয়, ধার…)।' : 'Add the source — whose money paid this (salary, savings, a loan…).', 'danger'); return; }
    if (isDebt && sources.some((l) => l.amount.trim() && !l.key)) { warn(); showSnackbar(bn ? 'প্রতিটি উৎসের ধরন বাছুন।' : 'Pick a kind for every source.', 'danger'); return; }
    if (walletNeeded) {
      const problem = moneyDetailsProblem({ walletId, needsSource: isDebt, fundSource: isDebt ? pocketFund : null }, bn);
      if (problem) { warn(); showSnackbar(problem, 'danger'); return; }
    }
    if (isDebt && sourcesUsed && !srcOk) { warn(); showSnackbar(bn ? 'উৎসের যোগফল মিলছে না' : 'Sources must sum to the amount', 'danger'); return; }
    const finalMethod = withOwnWords(method, methodOther);
    busyRef.current = true;
    setBusy(true);
    try {
      // The chosen instalment is where allocation STARTS; anything above what that
      // instalment still owes carries on to the next ones (and then to advance).
      //
      // The whole submission is one boundary. The ledger row, the wallet side and — when
      // the money was itself borrowed — the new loan that funded it are one decision:
      // they used to be separate commits, so a failure partway through could leave a debt
      // marked paid out of a pocket that still had the money in it.
      await atomic(db, async () => {
        if (isDebt) {
          let srcInput: SourceLineInput[] | undefined;
          if (sourcesUsed) {
            srcInput = [];
            for (const l of sources.filter((x) => x.amount.trim())) {
              const line: SourceLineInput = {
                sourceKey: l.key, amountPaisa: safeParse(l.amount),
                note: l.key === 'OTHER' ? (l.note.trim() || null) : null,
              };
              if (l.key === 'BORROWED') {
                if (l.borrowFrom) line.linkedAccountId = l.borrowFrom;
                else if (l.newName.trim()) {
                  const lender = await createPerson(db, { name: l.newName.trim() });
                  line.newBorrowAccount = { personId: lender.id, title: bn ? 'ঋণ পরিশোধে ধার' : 'borrowed to repay' };
                }
              }
              srcInput.push(line);
            }
          }
          const txn = await recordPayment(db, { accountId: id, amountPaisa: paisa, txnDate: date, method: finalMethod, reference: reference.trim() || null, startInstallmentId: instId, sources: srcInput });
          // Money that left a pocket has to leave that pocket in the money book too — but
          // only the part that was ever in it. Paying ৳5,000 of which ৳2,000 was borrowed
          // from someone else moves ৳3,000 out of the wallet; the other ৳2,000 never
          // arrived there, and taking it out anyway left the wallet short by that much.
          const fromPocket = paisa - (srcInput ?? []).reduce(
            (sum, s) => sum + (CREDIT_SOURCE_KEYS.includes(s.sourceKey) ? s.amountPaisa : 0), 0,
          );
          if (walletId && fromPocket > 0) {
            await recordWalletSideOfDebtMovement(db, {
              transactionId: txn.id, direction: 'DEBT', amountPaisa: fromPocket, walletId,
              occurredAt: date, method: finalMethod, personId: view?.account.personId ?? null,
              fundSource: pocketFund, fundNote: pocketFundNote,
            });
          }
        } else {
          const txn = await recordReceipt(db, { accountId: id, amountPaisa: paisa, txnDate: date, method: finalMethod, reference: reference.trim() || null, startInstallmentId: instId });
          if (walletId) {
            await recordWalletSideOfDebtMovement(db, {
              transactionId: txn.id, direction: 'RECEIVABLE', amountPaisa: paisa, walletId,
              occurredAt: date, method: finalMethod, personId: view?.account.personId ?? null,
            });
          }
        }
      });
      success();
      showSnackbar(bn ? 'যোগ হয়েছে' : 'Recorded', 'success');
      router.replace(`/debt/account/${id}` as never);
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/pay/id', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <View style={styles.screen}>
      <ScrollView keyboardDismissMode="on-drag" style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityLabel={c.back} onPress={leave} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}>
          <AppIcon name="arrow-left" size={icon.md} color={colors.primary} /><Text style={styles.backText}>{c.back}</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>{isDebt ? c.makePayment : c.recordReceipt}</Text>
        <Text style={styles.sub}>{view.person?.name ?? ''} · {c.remaining} {money(view.balance.remainingPaisa)}</Text>

        <Text style={styles.label}>{c.amount} (৳)</Text>
        <TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder={bn ? '০' : '0'} placeholderTextColor={colors.textMuted} style={styles.input} accessibilityLabel={c.amount} />

        {overpayPaisa > 0 ? (
          <View style={styles.notice}>
            <AppIcon name="information-outline" size={icon.sm} color={colors.warning} />
            <Text style={styles.noticeText}>{c.overpayWarn(money(overpayPaisa))}</Text>
          </View>
        ) : null}

        <AppDateField label={c.date} value={date} onChange={(v) => setDate(v ?? date)} />

        <Text style={styles.label}>{bn ? 'মাধ্যম' : 'Method'}</Text>
        <View style={styles.chipRow}>
          {DEFAULT_PAYMENT_METHODS.map((m) => (
            <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: method === m }} onPress={() => setMethod(method === m ? null : m)} style={({ pressed }) => StyleSheet.flatten([styles.chipHit, pressed && styles.pressed])}>
              <View style={[styles.chip, method === m && styles.chipOn]}>
                <Text style={[styles.chipText, method === m && styles.chipTextOn]}>{methodLabel(m, language)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
        {method === 'OTHER' ? (
          <TextInput value={methodOther} onChangeText={setMethodOther} placeholder={bn ? 'কোন মাধ্যমে? নিজে লিখুন' : 'Which method? Type it'} placeholderTextColor={colors.textMuted} style={[styles.input, styles.otherInput]} accessibilityLabel={bn ? 'অন্য মাধ্যম' : 'Other method'} />
        ) : null}

        {/* The pocket the money moves through. Choose one and the money book records the same
            movement, so the wallet and the ledger cannot drift apart. */}
        {walletNeeded ? (
          <WalletPicker
            label={isDebt ? (bn ? 'কোন মানিব্যাগ থেকে' : 'Out of which wallet') : (bn ? 'কোন মানিব্যাগে জমা' : 'Into which wallet')}
            value={walletId}
            onChange={setWalletId}
            wallets={wallets}
            onWalletsChange={setWallets}
            note={backDatedNote(date, bangladeshDateKey(new Date()), !isDebt, bn)}
          />
        ) : (
          <Text style={styles.borrowHint}>{bn ? 'পুরো টাকা ধার করে সরাসরি দেওয়া — কোনো মানিব্যাগ থেকে যায়নি, তাই মানিব্যাগ লাগবে না।' : 'All of it was borrowed and paid straight over — no wallet was involved.'}</Text>
        )}

        <Text style={styles.label}>{bn ? 'রেফারেন্স (ঐচ্ছিক)' : 'Reference (optional)'}</Text>
        <TextInput value={reference} onChangeText={setReference} placeholder={bn ? 'ট্রানজেকশন আইডি ইত্যাদি' : 'Transaction id etc.'} placeholderTextColor={colors.textMuted} style={styles.input} accessibilityLabel={bn ? 'রেফারেন্স নম্বর' : 'Reference number'} />

        {view.installments.length ? (
          <>
            <Text style={styles.label}>{bn ? 'কিস্তিতে বণ্টন (ঐচ্ছিক)' : 'Apply to installment (optional)'}</Text>
            <View style={styles.chipRow}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: instId === null }} onPress={() => setInstId(null)} style={({ pressed }) => StyleSheet.flatten([styles.chip, instId === null && styles.chipOn, pressed && styles.pressed])}>
                <Text style={[styles.chipText, instId === null && styles.chipTextOn]}>{bn ? 'স্বয়ংক্রিয়' : 'Auto'}</Text>
              </Pressable>
              {view.installments.map((it) => (
                <Pressable key={it.id} accessibilityRole="button" accessibilityState={{ selected: instId === it.id }} onPress={() => setInstId(instId === it.id ? null : it.id)} style={({ pressed }) => StyleSheet.flatten([styles.chip, instId === it.id && styles.chipOn, pressed && styles.pressed])}>
                  <Text style={[styles.chipText, instId === it.id && styles.chipTextOn]}>#{it.seq} · {money(it.amountPaisa)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {isDebt ? (
          <>
            <View style={styles.srcHead}>
              <Text numberOfLines={1} style={[styles.label, styles.srcHeadLabel]}>{bn ? 'টাকার উৎস' : 'Payment source'}<Text style={{ color: colors.danger }}>{' *'}</Text></Text>
              <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'উৎস যোগ' : 'Add source'} onPress={addSource} style={({ pressed }) => StyleSheet.flatten([styles.addSrc, pressed && styles.pressed])}>
                <AppIcon name="plus" size={icon.sm} color={colors.primary} /><Text style={styles.addSrcText}>{bn ? 'যোগ' : 'Add'}</Text>
              </Pressable>
            </View>
            {!sources.length ? (
              <Text style={styles.borrowHint}>{bn ? 'কোন টাকা দিয়ে শোধ করলেন — "যোগ" চেপে বাছুন।' : 'Whose money paid this — tap "Add" to choose.'}</Text>
            ) : null}
            {sources.map((l, i) => (
              <View key={i} style={styles.srcRow}>
                <View style={styles.srcTop}>
                  <View style={styles.srcChips}>
                    {DEFAULT_PAYMENT_SOURCES.map((k) => (
                      <Pressable key={k} accessibilityRole="button" accessibilityLabel={sourceLabel(k, language)} accessibilityState={{ selected: l.key === k }} onPress={() => setSrc(i, { key: k })} style={({ pressed }) => StyleSheet.flatten([styles.miniChipHit, pressed && styles.pressed])}>
                        <View style={[styles.miniChip, l.key === k && styles.chipOn]}>
                          <Text style={[styles.miniChipText, l.key === k && styles.chipTextOn]}>{sourceLabel(k, language)}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'উৎস সরান' : 'Remove source'} onPress={() => delSrc(i)} hitSlop={8}><AppIcon name="close" size={icon.sm} color={colors.danger} /></Pressable>
                </View>
                <TextInput value={l.amount} onChangeText={(v) => setSrc(i, { amount: v })} keyboardType="numeric" placeholder={`${c.amount} (৳)`} placeholderTextColor={colors.textMuted} style={[styles.input, styles.srcInput]} accessibilityLabel={`source ${i} amount`} />
                {l.key === 'OTHER' ? (
                  <TextInput value={l.note} onChangeText={(v) => setSrc(i, { note: v })} placeholder={bn ? 'কোথা থেকে এল? নিজে লিখুন' : 'Where did it come from? Type it'} placeholderTextColor={colors.textMuted} style={[styles.input, styles.srcInput]} accessibilityLabel={bn ? 'অন্য উৎস' : 'Other source'} />
                ) : null}
                {l.key === 'BORROWED' ? (
                  <View style={styles.borrowRow}>
                    <Text style={styles.borrowHint}>{bn ? 'কার কাছ থেকে ধার:' : 'Borrowed from:'}</Text>
                    <View style={styles.chipRow}>
                      {people.map((p) => (
                        <Pressable key={p.id} accessibilityRole="button" accessibilityState={{ selected: l.borrowFrom === p.id }} onPress={() => setSrc(i, { borrowFrom: p.id, newName: '' })} style={({ pressed }) => StyleSheet.flatten([styles.miniChip, l.borrowFrom === p.id && styles.chipOn, pressed && styles.pressed])}>
                          <Text style={[styles.miniChipText, l.borrowFrom === p.id && styles.chipTextOn]}>{p.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <TextInput value={l.newName} onChangeText={(v) => setSrc(i, { newName: v, borrowFrom: null })} placeholder={c.newPerson} placeholderTextColor={colors.textMuted} style={[styles.input, styles.srcInput]} accessibilityLabel={bn ? 'নতুন পাওনাদারের নাম' : 'New lender'} />
                  </View>
                ) : null}
              </View>
            ))}
            {sourcesUsed ? (
              <Text style={[styles.srcSum, { color: srcOk ? colors.success : colors.danger }]}>
                {bn ? 'উৎস মোট' : 'Sources total'}: {money(srcTotal)} / {money(paisa)}
                {sources.some((l) => l.key === 'BORROWED' && l.amount.trim()) ? (bn ? '  · ধার করা টাকায় আসল দেনা কমবে না' : '  · borrowed slice does not reduce net debt') : ''}
              </Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <View style={styles.bar}>
        <Pressable accessibilityRole="button" onPress={leave} style={({ pressed }) => StyleSheet.flatten([styles.secondary, pressed && styles.pressed])}>
          <Text style={styles.secondaryText}>{c.cancel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ busy }} disabled={busy} onPress={() => void submit()} style={({ pressed }) => StyleSheet.flatten([styles.primary, busy && styles.disabled, pressed && styles.pressed])}>
          {busy ? <ActivityIndicator color={colors.onPrimary} /> : <><AppIcon name="check" size={icon.sm} color={colors.onPrimary} /><Text style={styles.primaryText}>{c.save}</Text></>}
        </Pressable>
      </View>

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

function safeParse(s: string): number { try { return parseTakaToPaisa(s); } catch { return 0; } }

function makeStyles(colors: ThemeColors, _accents: ThemeAccents) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    container: { flex: 1 },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl + spacing.xl },
    center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
    dim: { color: colors.textMuted },
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    title: { color: colors.textPrimary, ...typography.display, fontWeight: '700' },
    sub: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.xxs, marginBottom: spacing.sm },
    label: { color: colors.textSecondary, ...typography.label, fontWeight: '800', marginTop: spacing.md, marginBottom: spacing.xs },
    input: { minHeight: control.inputHeight, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.textPrimary, paddingHorizontal: spacing.md, ...typography.input },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, padding: spacing.smd, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.warning, backgroundColor: colors.surfaceMuted },
    noticeText: { flex: 1, color: colors.textSecondary, ...typography.caption },
    chipHit: { minHeight: layout.minTouchTarget, justifyContent: 'center' },
    chip: { minHeight: 44, paddingHorizontal: spacing.smd, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.textSecondary, ...typography.meta, fontWeight: '700' },
    chipTextOn: { color: colors.onPrimary },
    srcHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    srcHeadLabel: { flexShrink: 1 },
    addSrc: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, minHeight: layout.minTouchTarget, paddingHorizontal: spacing.xs },
    addSrcText: { color: colors.primary, ...typography.meta, fontWeight: '800' },
    srcRow: { borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.sm, gap: spacing.xs, marginBottom: spacing.xs },
    srcTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
    srcChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    miniChipHit: { minHeight: layout.minTouchTarget, justifyContent: 'center' },
    miniChip: { minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
    miniChipText: { color: colors.textSecondary, ...typography.caption, fontWeight: '700' },
    otherInput: { marginTop: spacing.xs },
    srcInput: { backgroundColor: colors.surfaceMuted, minHeight: 44 },
    borrowRow: { gap: spacing.xxs, marginTop: spacing.xxs },
    borrowHint: { color: colors.textMuted, ...typography.caption },
    srcSum: { ...typography.caption, fontWeight: '700', marginTop: spacing.xs },
    bar: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderTopWidth: border.thin, borderTopColor: colors.border, backgroundColor: colors.surface },
    secondary: { minHeight: control.buttonHeight, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: colors.textSecondary, ...typography.callout, fontWeight: '800' },
    primary: { flex: 1, minHeight: control.buttonHeight, borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, ...elevation.raised },
    primaryText: { color: colors.onPrimary, ...typography.callout, fontWeight: '800' },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.78 },
  });
}
