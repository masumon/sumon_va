// "হিসাব ঠিক করুন" — the records that cannot yet say where their money sat or whose it was.
//
// The user's rule for v1.0 is that every money movement names its wallet, and money going
// out names its source. Records made before that rule — a loan entered long ago with no
// wallet, an expense with no source — are listed here, oldest first, and fixed one at a
// time by the person. Nothing is filled in for them: a guessed wallet is a balance that is
// quietly wrong, which is the very thing this page exists to prevent.
//
// Money-book entries open in their own edit form (which now asks for both). Debt-ledger
// movements are fixed right here: pick the wallet (and the source, for money going out)
// and the same writer the debt screens use adds the missing wallet side.

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../../src/ui/AppText';
import { AppIcon } from '../../src/ui/AppIcon';
import { Card, EmptyNote, FormBar, ScreenHeader, useKit } from '../../src/ui/AppKit';
import { useAppFeedback } from '../../src/ui/AppFeedback';
import { FundSourcePicker, WalletPicker, backDatedNote, moneyDetailsProblem } from '../../src/ui/MoneyPickers';
import { success, tapLight, warn } from '../../src/ui/haptics';
import { entriesMissingMoneyDetails, type FinanceEntry, type FundSource } from '../../src/services/finance-service';
import {
  attachWalletToDebtMove, debtMoveIsIncoming, debtMoveNeedsSource, debtMovesWithoutWallet,
  type DebtMoveWithoutWallet,
} from '../../src/services/money-bridge';
import { asciiDigitsToBengali, formatPaisa } from '../../src/services/debt/money';
import { bangladeshDateKey, formatDayKey } from '../../src/i18n/date-time';
import { border, icon, layout, radius, spacing, typography, type ThemeColors } from '../../src/theme';

type Gap = FinanceEntry & { missingWallet: boolean; missingSource: boolean };

const MOVE_LABEL: Record<DebtMoveWithoutWallet['kind'], [string, string]> = {
  NEW_DEBT: ['ধার নেওয়া', 'Borrowed'],
  NEW_RECEIVABLE: ['ধার দেওয়া', 'Lent'],
  PAYMENT: ['ঋণ শোধ', 'Loan repaid'],
  RECEIPT: ['পাওনা আদায়', 'Collected'],
};

export default function FixMoneyScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn, language } = useKit();
  const st = useMemo(() => makeStyles(colors), [colors]);
  const { showSnackbar } = useAppFeedback();
  const money = (p: number) => formatPaisa(p, { bnDigits: bn });

  const [entries, setEntries] = useState<Gap[] | null>(null);
  const [moves, setMoves] = useState<DebtMoveWithoutWallet[] | null>(null);
  const [openMove, setOpenMove] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [fundSource, setFundSource] = useState<FundSource | null>(null);
  const [fundAccountId, setFundAccountId] = useState<string | null>(null);
  const [fundNote, setFundNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [e, m] = await Promise.all([
      entriesMissingMoneyDetails(db).catch(() => [] as Gap[]),
      debtMovesWithoutWallet(db).catch(() => [] as DebtMoveWithoutWallet[]),
    ]);
    setEntries(e);
    setMoves(m);
  }, [db]);
  // Back from an entry's edit form, the list re-reads: a fixed entry drops off by itself.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const startFix = (move: DebtMoveWithoutWallet) => {
    tapLight();
    setOpenMove(openMove === move.transactionId ? null : move.transactionId);
    setWalletId(null);
    setFundSource(null);
    setFundAccountId(null);
    setFundNote('');
  };

  const saveFix = async (move: DebtMoveWithoutWallet) => {
    if (saving) return;
    const problem = moneyDetailsProblem({ walletId, needsSource: debtMoveNeedsSource(move), fundSource }, bn);
    if (problem) { warn(); showSnackbar(problem, 'danger'); return; }
    setSaving(true);
    try {
      await attachWalletToDebtMove(db, move, walletId!, { fundSource, fundAccountId, fundNote });
      success();
      showSnackbar(bn ? 'ঠিক করা হয়েছে' : 'Fixed', 'success');
      setOpenMove(null);
      await load();
    } catch {
      warn();
      showSnackbar(bn ? 'রাখা গেল না — আবার চেষ্টা করুন' : 'Could not save — try again', 'danger');
    } finally { setSaving(false); }
  };

  const loaded = entries !== null && moves !== null;
  const nothing = loaded && !entries.length && !moves.length;
  const today = bangladeshDateKey(new Date());

  return (
    <View style={st.root}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={st.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title={bn ? 'হিসাব ঠিক করুন' : 'Fix records'}
          subtitle={bn ? 'যেসব লেনদেনে মানিব্যাগ বা টাকার উৎস নেই — একটা একটা করে বসিয়ে দিন' : 'Records missing a wallet or a source — fill them in one at a time'}
          backTo="/finance"
          backLabel={bn ? 'আয়-ব্যয়' : 'Money'}
        />

        {nothing ? (
          <EmptyNote icon="check-circle-outline" text={bn ? 'সব হিসাবে মানিব্যাগ ও উৎস আছে — ঠিক করার কিছু নেই।' : 'Every record has its wallet and source — nothing to fix.'} />
        ) : null}

        {moves?.length ? (
          <Card title={bn ? `দেনা-পাওনার লেনদেন — মানিব্যাগ নেই (${asciiDigitsToBengali(String(moves.length))})` : `Debt movements without a wallet (${moves.length})`}>
            {moves.map((move) => {
              const incoming = debtMoveIsIncoming(move);
              const tone = incoming ? accents.green : accents.orange;
              const open = openMove === move.transactionId;
              return (
                <View key={move.transactionId}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    accessibilityLabel={`${MOVE_LABEL[move.kind][bn ? 0 : 1]} ${move.personName} ${money(move.amountPaisa)}`}
                    onPress={() => startFix(move)}
                    style={({ pressed }) => StyleSheet.flatten([st.row, pressed && st.pressed])}
                  >
                    <View style={[st.rowIcon, { backgroundColor: tone.soft }]}>
                      <AppIcon name={incoming ? 'arrow-down' : 'arrow-up'} size={icon.sm} color={tone.on} />
                    </View>
                    <View style={st.grow}>
                      <Text numberOfLines={1} style={st.rowTitle}>{`${MOVE_LABEL[move.kind][bn ? 0 : 1]} · ${move.personName}`}</Text>
                      <Text numberOfLines={1} style={st.rowMeta}>{`${formatDayKey(move.date, language)} · ${bn ? 'মানিব্যাগ নেই' : 'no wallet'}`}</Text>
                    </View>
                    <Text numberOfLines={1} style={[st.amount, { color: tone.on }]}>{money(move.amountPaisa)}</Text>
                    <AppIcon name={open ? 'chevron-up' : 'chevron-down'} size={icon.sm} color={colors.textMuted} />
                  </Pressable>
                  {open ? (
                    <View style={st.panel}>
                      <WalletPicker
                        label={incoming ? (bn ? 'টাকা কোন মানিব্যাগে এসেছিল' : 'Into which wallet') : (bn ? 'টাকা কোন মানিব্যাগ থেকে গিয়েছিল' : 'Out of which wallet')}
                        value={walletId}
                        onChange={setWalletId}
                        note={backDatedNote(move.date, today, incoming, bn)}
                      />
                      {debtMoveNeedsSource(move) ? (
                        <FundSourcePicker value={fundSource} onChange={setFundSource} note={fundNote} onNoteChange={setFundNote} loanAccountId={fundAccountId} onLoanAccountChange={setFundAccountId} excludeAccountId={move.accountId} />
                      ) : null}
                      <FormBar onCancel={() => setOpenMove(null)} onSave={() => void saveFix(move)} saving={saving} saveLabel={bn ? 'রাখুন' : 'Save'} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Card>
        ) : null}

        {entries?.length ? (
          <Card title={bn ? `আয়-ব্যয়ের এন্ট্রি (${asciiDigitsToBengali(String(entries.length))})` : `Money entries (${entries.length})`}>
            {entries.map((entry) => {
              const income = entry.kind === 'INCOME';
              const tone = income ? accents.green : accents.orange;
              const missing = [
                entry.missingWallet ? (bn ? 'মানিব্যাগ নেই' : 'no wallet') : null,
                entry.missingSource ? (bn ? 'উৎস নেই' : 'no source') : null,
              ].filter(Boolean).join(' · ');
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.category} ${money(entry.amountPaisa)} — ${missing}`}
                  onPress={() => { tapLight(); router.push({ pathname: '/finance/new', params: { id: entry.id } } as never); }}
                  style={({ pressed }) => StyleSheet.flatten([st.row, pressed && st.pressed])}
                >
                  <View style={[st.rowIcon, { backgroundColor: tone.soft }]}>
                    <AppIcon name={income ? 'arrow-down' : 'arrow-up'} size={icon.sm} color={tone.on} />
                  </View>
                  <View style={st.grow}>
                    <Text numberOfLines={1} style={st.rowTitle}>{entry.category}</Text>
                    <Text numberOfLines={1} style={st.rowMeta}>{`${formatDayKey(entry.occurredAt.slice(0, 10), language)} · `}<Text style={{ color: colors.warning }}>{missing}</Text></Text>
                  </View>
                  <Text numberOfLines={1} style={[st.amount, { color: tone.on }]}>{money(entry.amountPaisa)}</Text>
                  <AppIcon name="chevron-right" size={icon.sm} color={colors.textMuted} />
                </Pressable>
              );
            })}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

// The money page's own row, so a record looks the same here as it does in the list.
function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget + 12, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs },
    rowIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    grow: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    rowMeta: { color: colors.textMuted, ...typography.caption, marginTop: 1 },
    amount: { ...typography.callout, fontWeight: '800', flexShrink: 1 },
    panel: { paddingHorizontal: spacing.xs, paddingBottom: spacing.md, gap: spacing.xs },
    pressed: { opacity: 0.78 },
  });
}
