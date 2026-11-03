import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../src/ui/AppText';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppFeedback } from '../../src/ui/AppFeedback';
import { getPortfolio, type PortfolioView } from '../../src/services/debt/debt-service';
import { getSetting, getTarget, setSetting, upsertTarget } from '../../src/services/debt/repository';
import { bestNextPayment, orderByStrategy, projectDebtFree, riskLevel, toMonthlyBps, whatIfPayment, type PlanRow } from '../../src/services/debt/strategy';
import { parseTakaToPaisa , asciiDigitsToBengali } from '../../src/services/debt/money';
import type { Strategy } from '../../src/services/debt/types';
import { bangladeshDateKey } from '../../src/i18n/date-time';
import { AppIcon } from '../../src/ui/AppIcon';
import { Bar, Card, Chip, DebtHeader, EmptyNote, Stat, useDebt } from '../../src/ui/DebtKit';
import { success, warn } from '../../src/ui/haptics';
import { icon, spacing } from '../../src/theme';
import { logAppError } from '../../src/services/error-log';

const STRATEGIES: Strategy[] = ['SNOWBALL', 'AVALANCHE', 'CUSTOM'];

/** Safe taka→paisa: an unparseable box means "nothing entered", never a crash. */
function safeParse(text: string): number {
  try { return parseTakaToPaisa(text); } catch { return 0; }
}

export default function DebtPlan() {
  const db = useSQLiteContext();
  const { s, c, bn, colors, accents, money } = useDebt();
  const { showSnackbar } = useAppFeedback();

  const [view, setView] = useState<PortfolioView | null>(null);
  const [strategy, setStrategy] = useState<Strategy>('AVALANCHE');
  const [ready, setReady] = useState(false);
  const [targetText, setTargetText] = useState('');
  const [payText, setPayText] = useState('');
  const [incomeText, setIncomeText] = useState('');
  const [essentialText, setEssentialText] = useState('');
  const [busy, setBusy] = useState(false);

  const monthKey = bangladeshDateKey(new Date()).slice(0, 7);

  const load = useCallback(async () => {
    try {
      const [v, storedStrategy, target, income, essentials] = await Promise.all([
        getPortfolio(db, { direction: 'DEBT' }),
        getSetting(db, 'strategy'),
        getTarget(db, 'MONTH', monthKey, 'REPAYMENT'),
        getSetting(db, 'monthlyIncomePaisa'),
        getSetting(db, 'essentialExpensePaisa'),
      ]);
      setView(v);
      if (storedStrategy && STRATEGIES.includes(storedStrategy as Strategy)) setStrategy(storedStrategy as Strategy);
      if (target) setTargetText(String(Math.round(target.targetValue / 100)));
      if (income) setIncomeText(String(Math.round(Number(income) / 100)));
      if (essentials) setEssentialText(String(Math.round(Number(essentials) / 100)));
    } catch { setView(null); }
    finally { setReady(true); }
  }, [db, monthKey]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // PlanRows are the strategy engine's only input — derived here so snowball/avalanche
  // ordering, the "best next payment" pick and the projection all read the same numbers.
  const rows = useMemo<PlanRow[]>(() => {
    if (!view) return [];
    const accById = new Map(view.accounts.map((a) => [a.id, a]));
    return view.balances
      .filter((b) => b.direction === 'DEBT' && b.remainingPaisa > 0)
      .map((b) => {
        const a = accById.get(b.accountId);
        return {
          accountId: b.accountId,
          remainingPaisa: b.remainingPaisa,
          interestRateBps: a?.interestRateBps ?? 0,
          overdueDays: b.overdueDays,
          minPaymentPaisa: b.nextDuePaisa,
          priorityRank: a?.priorityRank ?? null,
        };
      });
  }, [view]);

  const ordered = useMemo(() => orderByStrategy(rows, strategy), [rows, strategy]);
  const best = useMemo(() => bestNextPayment(rows, strategy), [rows, strategy]);

  const currentDebt = view?.outstandingDebtPaisa ?? 0;
  const payPaisa = safeParse(payText);
  const whatIf = useMemo(() => whatIfPayment(currentDebt, payPaisa), [currentDebt, payPaisa]);

  const incomePaisa = safeParse(incomeText);
  const essentialPaisa = safeParse(essentialText);
  const availablePaisa = Math.max(0, incomePaisa - essentialPaisa);
  const monthlyPaymentPaisa = payPaisa > 0 ? payPaisa : availablePaisa;

  const projection = useMemo(() => {
    if (!view || monthlyPaymentPaisa <= 0) return null;
    const accById = new Map(view.accounts.map((a) => [a.id, a]));
    return projectDebtFree({
      balances: view.balances
        .filter((b) => b.direction === 'DEBT' && b.remainingPaisa > 0)
        .map((b) => {
          const a = accById.get(b.accountId);
          return { remainingPaisa: b.remainingPaisa, monthlyInterestBps: toMonthlyBps(a?.interestRateBps ?? 0, a?.interestPeriod ?? 'YEAR') };
        }),
      monthlyPaymentPaisa,
      maxMonths: 360,
    });
  }, [view, monthlyPaymentPaisa]);

  const accById = useMemo(() => new Map((view?.accounts ?? []).map((a) => [a.id, a])), [view]);
  const bestAccount = best.accountId ? accById.get(best.accountId) : null;

  const chooseStrategy = (next: Strategy) => {
    setStrategy(next);
    void setSetting(db, 'strategy', next);
  };

  const saveMonthlySettings = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const targetPaisa = safeParse(targetText);
      await upsertTarget(db, { periodType: 'MONTH', periodKey: monthKey, kind: 'REPAYMENT', targetValue: targetPaisa });
      await setSetting(db, 'monthlyIncomePaisa', String(incomePaisa));
      await setSetting(db, 'essentialExpensePaisa', String(essentialPaisa));
      success();
      showSnackbar(bn ? 'সংরক্ষিত' : 'Saved', 'success');
      await load();
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/plan', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  if (!ready) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <ScrollView keyboardDismissMode="on-drag" style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <DebtHeader title={c.plan} subtitle={bn ? 'কোন দেনা আগে শোধ করবেন, কবে দেনামুক্ত হবেন।' : 'What to pay first, and when you go debt-free.'} />

      {rows.length === 0 ? (
        <EmptyNote icon="party-popper" text={bn ? 'বকেয়া দেনা নেই — চমৎকার!' : 'No outstanding debt — well done!'} />
      ) : (
        <>
          <Card title={c.strategy}>
            <View style={s.chipRow}>
              {STRATEGIES.map((st) => <Chip key={st} label={c[st]} active={strategy === st} onPress={() => chooseStrategy(st)} />)}
            </View>
          </Card>

          <Card title={c.bestNext}>
            {best.accountId ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/debt/account/${best.accountId}` as never)}
                style={({ pressed }) => StyleSheet.flatten([s.row, pressed && s.pressed])}
              >
                <View style={s.grow}>
                  <Text numberOfLines={2} style={s.listTitle}>{bestAccount?.title || c.untitledDebt}</Text>
                  <Text style={s.listMeta}>{bn ? best.reasonBn : best.reasonEn}</Text>
                </View>
                <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
              </Pressable>
            ) : (
              <Text style={s.statLabel}>{bn ? best.reasonBn : best.reasonEn}</Text>
            )}
          </Card>

          <Card title={bn ? 'পরিশোধের ক্রম' : 'Payment order'}>
            {ordered.map((r, i) => {
              const a = accById.get(r.accountId);
              const risk = riskLevel({ overdueDays: r.overdueDays, overduePaisa: r.overdueDays > 0 ? r.minPaymentPaisa : 0, remainingPaisa: r.remainingPaisa, interestRateBps: r.interestRateBps });
              const tone = risk === 'CRITICAL' || risk === 'HIGH' ? accents.red : risk === 'MEDIUM' ? accents.orange : accents.green;
              return (
                <Pressable
                  key={r.accountId}
                  accessibilityRole="button"
                  onPress={() => router.push(`/debt/account/${r.accountId}` as never)}
                  style={({ pressed }) => StyleSheet.flatten([s.listRow, pressed && s.pressed])}
                >
                  <Text style={[s.listAmt, { width: 22, textAlign: 'center' }]}>{i + 1}</Text>
                  <View style={s.grow}>
                    <Text numberOfLines={1} style={s.listTitle}>{a?.title || c.untitledDebt}</Text>
                    <Text numberOfLines={1} style={s.listMeta}>
                      {money(r.remainingPaisa)}
                      {r.interestRateBps ? ` · ${r.interestRateBps / 100}%` : ''}
                      {r.overdueDays > 0 ? ` · ${bn ? asciiDigitsToBengali(String(r.overdueDays)) : r.overdueDays}${bn ? ' দিন দেরি' : 'd late'}` : ''}
                    </Text>
                  </View>
                  <View style={[s.badge, { backgroundColor: tone.soft, borderColor: tone.border }]}>
                    <Text style={[s.badgeText, { color: tone.on }]}>{risk}</Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>

          <Card title={c.whatIf}>
            <Text style={s.label}>{c.amount}</Text>
            <TextInput
              style={s.input}
              value={payText}
              onChangeText={setPayText}
              keyboardType="numeric"
              placeholder={bn ? '০' : '0'}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={c.whatIf}
            />
            <View style={{ marginTop: spacing.sm }}>
              <Stat label={c.netDebt} value={money(whatIf.currentDebtPaisa)} />
              <Stat label={bn ? 'পরে বাকি থাকবে' : 'Debt after'} value={money(whatIf.newDebtPaisa)} tone={accents.green} />
              <Stat label={c.reductionPct} value={`${whatIf.reductionPct}%`} />
              <Bar pct={whatIf.reductionPct} tone={accents.green} />
            </View>
          </Card>

          <Card title={c.projection}>
            <Text style={s.label}>{c.income}</Text>
            <TextInput style={s.input} value={incomeText} onChangeText={setIncomeText} keyboardType="numeric" placeholder={bn ? '০' : '0'} placeholderTextColor={colors.textMuted} accessibilityLabel={c.income} />
            <Text style={s.label}>{c.essentials}</Text>
            <TextInput style={s.input} value={essentialText} onChangeText={setEssentialText} keyboardType="numeric" placeholder={bn ? '০' : '0'} placeholderTextColor={colors.textMuted} accessibilityLabel={c.essentials} />
            <Text style={s.label}>{c.monthlyTarget}</Text>
            <TextInput style={s.input} value={targetText} onChangeText={setTargetText} keyboardType="numeric" placeholder={bn ? '০' : '0'} placeholderTextColor={colors.textMuted} accessibilityLabel={c.monthlyTarget} />

            <View style={{ marginTop: spacing.sm }}>
              <Stat label={c.available} value={money(availablePaisa)} tone={accents.blue} />
              <Stat label={c.monthlyPayment} value={money(monthlyPaymentPaisa)} />
              {projection ? (
                projection.clears ? (
                  <>
                    <Stat label={c.projection} value={c.debtFreeIn(projection.months)} tone={accents.green} />
                    <Stat label={c.totalPaid} value={money(projection.totalPaidPaisa)} />
                    <Stat label={c.totalInterest} value={money(projection.totalInterestPaisa)} tone={accents.orange} />
                  </>
                ) : (
                  <Text style={[s.statLabel, { color: accents.red.on }]}>{c.neverClears}</Text>
                )
              ) : (
                <Text style={s.statLabel}>{c.noData}</Text>
              )}
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void saveMonthlySettings()}
              style={({ pressed }) => StyleSheet.flatten([s.primary, { marginTop: spacing.md }, busy && s.disabled, pressed && s.pressed])}
            >
              <AppIcon name="content-save-outline" size={icon.sm} color={colors.onPrimary} />
              <Text style={s.primaryText}>{c.save}</Text>
            </Pressable>
          </Card>
        </>
      )}
    </ScrollView>
  );
}
