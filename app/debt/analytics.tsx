import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { AppText as Text } from '../../src/ui/AppText';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { borrowedFundedByTxn, getDashboardMetrics, paymentSourcePairs, type DashboardMetrics } from '../../src/services/debt/debt-service';
import { listLedger } from '../../src/services/debt/repository';
import { breakdown, periodFlow, smartInsights, type Insight, type PeriodFlow, type SliceStat } from '../../src/services/debt/analytics';
import { localDayKey } from '../../src/services/debt/derive';
import { formatPaisa } from '../../src/services/debt/money';
import { purposeLabel } from '../../src/i18n/debt';
import { AppIcon } from '../../src/ui/AppIcon';
import { Bar, Card, DebtHeader, EmptyNote, Stat, useDebt } from '../../src/ui/DebtKit';
import { icon, spacing } from '../../src/theme';

interface Data {
  metrics: DashboardMetrics;
  thisMonth: PeriodFlow;
  lastMonth: PeriodFlow;
  thisYear: PeriodFlow;
  insights: Insight[];
  sources: SliceStat[];
  purposes: SliceStat[];
}

/** Previous month key for a `YYYY-MM` string, rolling the year over at January. */
function prevMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function DebtAnalytics() {
  const db = useSQLiteContext();
  const { s, c, bn, language, colors, accents, money } = useDebt();
  const [data, setData] = useState<Data | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const nowIso = new Date().toISOString();
      const [metrics, ledger, borrowed, srcPairs] = await Promise.all([
        getDashboardMetrics(db, nowIso),
        listLedger(db, { limit: 5000 }),
        borrowedFundedByTxn(db),
        paymentSourcePairs(db),
      ]);
      const dayKey = localDayKey(nowIso);
      const mKey = dayKey.slice(0, 7);
      const thisMonth = periodFlow(ledger, borrowed, mKey);
      const lastMonth = periodFlow(ledger, borrowed, prevMonthKey(mKey));
      const thisYear = periodFlow(ledger, borrowed, dayKey.slice(0, 4), 'YEAR');
      const balById = new Map(metrics.portfolio.balances.map((b) => [b.accountId, b]));
      const purposes = breakdown(
        metrics.portfolio.accounts
          .filter((a) => a.direction === 'DEBT')
          .map((a) => ({ key: purposeLabel(a.purpose, language) || (bn ? 'অন্যান্য' : 'Other'), amountPaisa: balById.get(a.id)?.remainingPaisa ?? 0 }))
          .filter((p) => p.amountPaisa > 0),
      );
      setData({
        metrics, thisMonth, lastMonth, thisYear, sources: breakdown(srcPairs), purposes,
        insights: smartInsights({
          balances: metrics.portfolio.balances,
          thisMonth, lastMonth,
          startingDebtPaisa: metrics.startingDebtPaisa,
          currentDebtPaisa: metrics.currentDebtPaisa,
          fmt: (p) => formatPaisa(p, { bnDigits: bn }),
        }),
      });
    } catch { setData(null); }
    finally { setReady(true); }
  }, [db, bn, language]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!ready) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;

  const m = data?.metrics;
  const flow = data?.thisMonth;
  const realTone = (flow?.realDebtReductionPaisa ?? 0) >= 0 ? accents.green : accents.red;
  // A negative reduction is an increase. Say that, rather than making the reader work out
  // a minus sign on the one figure they most need stated plainly.
  const realLabel = (paisa: number) => (paisa < 0 ? c.realIncrease : c.realReduction);
  const realValue = (paisa: number) => money(Math.abs(paisa));

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <DebtHeader title={c.analytics} subtitle={c.analyticsTagline} />

      {!m ? (
        <EmptyNote icon="chart-line" text={c.noData} />
      ) : (
        <>
          <Card title={c.reductionPct}>
            <Text style={s.big}>{m.debtReductionPct}%</Text>
            <Text style={s.bigLabel}>{money(m.startingDebtPaisa)} → {money(m.currentDebtPaisa)}</Text>
            <Bar pct={m.debtReductionPct} tone={accents.green} />
          </Card>

          <Card title={c.thisMonth}>
            <Stat label={c.newDebtThisMonth} value={money(m.newDebtThisMonthPaisa)} tone={accents.red} />
            <Stat label={c.paidThisMonth} value={money(m.debtPaidThisMonthPaisa)} tone={accents.green} />
            <Stat label={c.collectedThisMonth} value={money(m.receivableCollectedThisMonthPaisa)} tone={accents.blue} />
            <Stat label={c.borrowedFunded} value={money(m.borrowedFundedThisMonthPaisa)} hint={c.realReductionHint} tone={accents.orange} />
            <View style={styles.divider(colors.border)} />
            <Stat label={realLabel(m.realDebtReductionThisMonthPaisa)} value={realValue(m.realDebtReductionThisMonthPaisa)} tone={realTone} />
          </Card>

          {m.monthlyTargetPaisa > 0 ? (
            <Card title={c.monthlyTarget}>
              <Stat label={c.monthlyTarget} value={money(m.monthlyTargetPaisa)} />
              <Stat label={c.targetRemaining} value={money(m.monthlyTargetRemainingPaisa)} tone={accents.orange} />
              <Bar pct={m.monthlyTargetProgressPct} tone={accents.blue} />
              <Text style={s.bigLabel}>{m.monthlyTargetProgressPct}%</Text>
            </Card>
          ) : null}

          <Card title={c.dueDates}>
            <Stat label={c.dueToday} value={money(m.dueTodayPaisa)} tone={accents.red} />
            <Stat label={bn ? 'আগামীকাল' : 'Tomorrow'} value={money(m.dueTomorrowPaisa)} />
            <Stat label={bn ? 'আগামী ৩ দিনে' : 'Next 3 days'} value={money(m.dueNext3Paisa)} />
            <Stat label={c.due7} value={money(m.dueNext7Paisa)} />
            <Stat label={c.overdue} value={money(m.overduePaisa)} hint={c.overdueCount(m.overdueCount)} tone={accents.red} />
            <Stat label={bn ? '৭ দিনে আদায় প্রত্যাশিত' : 'Expected in 7 days'} value={money(m.expectedCollectionNext7Paisa)} tone={accents.green} />
          </Card>

          <Card title={c.thisYear}>
            <Stat label={c.totalDebt} value={money(data.thisYear.newDebtPaisa)} />
            <Stat label={c.totalPaid} value={money(data.thisYear.debtPaidPaisa)} />
            <Stat label={c.totalReceived} value={money(data.thisYear.receiptPaisa)} />
            <Stat label={realLabel(data.thisYear.realDebtReductionPaisa)} value={realValue(data.thisYear.realDebtReductionPaisa)} />
          </Card>

          <Card title={c.lastMonth}>
            <Stat label={c.paidThisMonth} value={money(data.lastMonth.debtPaidPaisa)} />
            <Stat label={c.newDebtThisMonth} value={money(data.lastMonth.newDebtPaisa)} />
            <Stat label={realLabel(data.lastMonth.realDebtReductionPaisa)} value={realValue(data.lastMonth.realDebtReductionPaisa)} />
          </Card>

          <Slices title={c.breakdownSource} rows={data.sources} money={money} empty={c.noData} />
          <Slices title={c.breakdownPurpose} rows={data.purposes} money={money} empty={c.noData} />

          <Card title={c.insights}>
            {data.insights.length === 0 ? (
              <Text style={s.statLabel}>{c.noData}</Text>
            ) : data.insights.map((ins, i) => {
              const tone = ins.tone === 'warn' ? accents.red : ins.tone === 'good' ? accents.green : accents.blue;
              return (
                <View key={`${ins.tone}-${i}`} style={[s.row, { alignItems: 'flex-start', paddingVertical: spacing.xs }]}>
                  <AppIcon name={ins.tone === 'warn' ? 'alert-circle-outline' : ins.tone === 'good' ? 'check-circle-outline' : 'information-outline'} size={icon.sm} color={tone.on} />
                  <Text style={[s.statLabel, s.grow]}>{bn ? ins.bn : ins.en}</Text>
                </View>
              );
            })}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function Slices({ title, rows, money, empty }: { title: string; rows: SliceStat[]; money: (p: number) => string; empty: string }) {
  const { s, accents } = useDebt();
  return (
    <Card title={title}>
      {rows.length === 0 ? <Text style={s.statLabel}>{empty}</Text> : rows.map((r) => (
        <View key={r.key} style={{ marginBottom: spacing.sm }}>
          <Stat label={r.key} value={`${money(r.amountPaisa)} · ${r.pct}%`} />
          <Bar pct={r.pct} tone={accents.purple} />
        </View>
      ))}
    </Card>
  );
}

const styles = {
  divider: (color: string) => ({ height: 1, backgroundColor: color, marginVertical: spacing.xs }),
};
