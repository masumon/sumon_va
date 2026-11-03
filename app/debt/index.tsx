import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../src/ui/AppText';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppPreferences } from '../../src/app/AppPreferences';
import { getDashboardMetrics, type DashboardMetrics, type PortfolioView } from '../../src/services/debt/debt-service';
import { asciiDigitsToBengali, formatPaisa } from '../../src/services/debt/money';
import { debtCopy } from '../../src/i18n/debt';
import { AppIcon, type IconName } from '../../src/ui/AppIcon';
import { AppSkeletonList } from '../../src/ui/AppSurface';
import { tapLight } from '../../src/ui/haptics';
import { border, elevation, icon, layout, radius, spacing, typography, type AccentRole, type ThemeAccents, type ThemeColors } from '../../src/theme';
import { ReportButton } from '../../src/ui/ReportButton';
import { debtReport } from '../../src/services/module-reports';
import { ModuleSettingsLink } from '../../src/ui/ModuleSections';
import { ModuleGuide } from '../../src/ui/ModuleGuide';
import { debtMovesWithoutWallet } from '../../src/services/money-bridge';

export default function DebtDashboard() {
  const db = useSQLiteContext();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const c = useMemo(() => debtCopy(language), [language]);
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const money = (p: number) => formatPaisa(p, { bnDigits: bn });
  const digits = (v: number | string) => (bn ? asciiDigitsToBengali(String(v)) : String(v));

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Loans and repayments no wallet ever felt — entered before the wallet was required.
  const [noWallet, setNoWallet] = useState(0);

  const load = useCallback(() => {
    void debtMovesWithoutWallet(db).then((m) => setNoWallet(m.length)).catch(() => setNoWallet(0));
    return getDashboardMetrics(db)
      .then((m) => setMetrics(m))
      .catch(() => setMetrics(null))
      .finally(() => setReady(true));
  }, [db]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const onRefresh = useCallback(() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }, [load]);

  const t = metrics?.portfolio ?? null;
  const m = metrics;
  const netTone = (t?.netDebtPaisa ?? 0) > 0 ? accents.red : accents.green;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={[styles.eyebrow, { flex: 1 }]}>{bn ? 'ব্যক্তিগত হিসাব' : 'PERSONAL LEDGER'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ModuleGuide id="debt" /><ModuleSettingsLink moduleId="debt" /></View>
        </View>
        <Text accessibilityRole="header" style={styles.title}>{c.module}</Text>
        <Text style={styles.sub}>{c.tagline}</Text>
      </View>

      {/* The door to fixing them: one place for every record missing its wallet or source. */}
      {noWallet > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bn ? 'হিসাব ঠিক করুন' : 'Fix records'}
          onPress={() => { tapLight(); router.push('/finance/fix' as never); }}
          style={({ pressed }) => StyleSheet.flatten([styles.fixDoor, { borderColor: accents.orange.border, backgroundColor: accents.orange.soft }, pressed && { opacity: 0.85 }])}
        >
          <AppIcon name="wallet-outline" size={icon.sm} color={accents.orange.on} />
          <Text style={[styles.fixDoorText, { color: accents.orange.on }]}>
            {bn
              ? `${asciiDigitsToBengali(String(noWallet))}টি লেনদেনে মানিব্যাগ নেই — টাকা কোথায় এল/গেল বসিয়ে দিন`
              : `${noWallet} movement(s) have no wallet — say where the money went`}
          </Text>
          <AppIcon name="chevron-right" size={icon.sm} color={accents.orange.on} />
        </Pressable>
      ) : null}

      {!ready ? (
        <AppSkeletonList rows={4} />
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${c.netDebt}: ${money(Math.abs(t?.netDebtPaisa ?? 0))}`}
            onPress={() => { tapLight(); router.push('/debt/analytics' as never); }}
            style={({ pressed }) => StyleSheet.flatten([styles.netCard, { borderColor: netTone.border, backgroundColor: netTone.soft }, pressed && styles.pressed])}
          >
            <Text style={[styles.netLabel, { color: netTone.on }]}>{c.netDebt}</Text>
            <Text style={[styles.netValue, { color: netTone.on }]}>{money(Math.abs(t?.netDebtPaisa ?? 0))}</Text>
            <View style={styles.netSplit}>
              <Text style={styles.netSplitText}>{c.outstandingDebt}: {money(t?.outstandingDebtPaisa ?? 0)}</Text>
              <Text style={styles.netSplitText}>{c.outstandingReceivable}: {money(t?.outstandingReceivablePaisa ?? 0)}</Text>
              {m && m.debtReductionPct > 0 ? <Text style={styles.netSplitText}>{c.reductionPct}: {m.debtReductionPct}%</Text> : null}
            </View>
          </Pressable>

          {m && (m.dueTodayPaisa > 0 || m.dueNext7Paisa > 0 || m.monthlyTargetPaisa > 0 || m.realDebtReductionThisMonthPaisa !== 0) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={c.plan}
              onPress={() => { tapLight(); router.push('/debt/plan' as never); }}
              style={({ pressed }) => StyleSheet.flatten([styles.strip, pressed && styles.pressed])}
            >
              {m.dueTodayPaisa > 0 ? <StripLine styles={styles} label={c.dueToday} value={money(m.dueTodayPaisa)} /> : null}
              {m.dueNext7Paisa > 0 ? <StripLine styles={styles} label={c.due7} value={money(m.dueNext7Paisa)} /> : null}
              {m.monthlyTargetPaisa > 0 ? <StripLine styles={styles} label={c.monthlyTarget} value={`${money(m.monthlyTargetPaisa)} · ${m.monthlyTargetProgressPct}%`} /> : null}
              <StripLine styles={styles} label={c.realReduction} value={money(m.realDebtReductionThisMonthPaisa)} />
              {m.debtFree ? (
                <StripLine
                  styles={styles}
                  label={bn ? 'এই গতিতে ঋণমুক্ত' : 'Debt-free at this pace'}
                  value={bn
                    ? `${asciiDigitsToBengali(m.debtFree.monthKey)} · ${asciiDigitsToBengali(String(m.debtFree.months))} মাস`
                    : `${m.debtFree.monthKey} · ${m.debtFree.months} mo`}
                />
              ) : null}
            </Pressable>
          ) : null}

          <View style={styles.metricGrid}>
            <Metric styles={styles} label={c.totalPaid} value={money(t?.totalPaidPaisa ?? 0)} tone={accents.green} icon="arrow-up-circle-outline" onPress={() => router.push('/debt/ledger' as never)} />
            <Metric styles={styles} label={c.totalReceived} value={money(t?.totalReceivedPaisa ?? 0)} tone={accents.blue} icon="arrow-down-circle-outline" onPress={() => router.push('/debt/ledger' as never)} />
            <Metric styles={styles} label={c.overdue} value={money(t?.overduePaisa ?? 0)} tone={accents.red} icon="alert-circle-outline" hint={t?.overdueCount ? c.overdueCount(t.overdueCount) : undefined} onPress={() => router.push('/debt/accounts?direction=DEBT' as never)} />
            <Metric styles={styles} label={c.activeDebts} value={digits(t?.activeDebtCount ?? 0)} tone={accents.orange} icon="wallet-outline" hint={`${c.activeReceivables}: ${digits(t?.activeReceivableCount ?? 0)}`} onPress={() => router.push('/debt/accounts?direction=DEBT' as never)} />
          </View>

          <View style={styles.actions}>
            <Action styles={styles} colors={colors} tone={accents.red} icon="plus-circle-outline" label={c.addDebt} onPress={() => router.push('/debt/new?direction=DEBT' as never)} />
            <Action styles={styles} colors={colors} tone={accents.green} icon="plus-circle-outline" label={c.addReceivable} onPress={() => router.push('/debt/new?direction=RECEIVABLE' as never)} />
            <Action styles={styles} colors={colors} tone={accents.blue} icon="format-list-bulleted" label={c.myDebts} onPress={() => router.push('/debt/accounts?direction=DEBT' as never)} />
            <Action styles={styles} colors={colors} tone={accents.purple} icon="account-multiple-outline" label={c.people} onPress={() => router.push('/debt/people' as never)} />
            <Action styles={styles} colors={colors} tone={accents.blue} icon="chart-line" label={c.analytics} onPress={() => router.push('/debt/analytics' as never)} />
            <Action styles={styles} colors={colors} tone={accents.green} icon="target" label={c.plan} onPress={() => router.push('/debt/plan' as never)} />
            <Action styles={styles} colors={colors} tone={accents.orange} icon="calendar-month-outline" label={c.calendar} onPress={() => router.push('/debt/calendar' as never)} />
            <Action styles={styles} colors={colors} tone={accents.purple} icon="book-open-outline" label={c.ledger} onPress={() => router.push('/debt/ledger' as never)} />
            <Action styles={styles} colors={colors} tone={accents.yellow} icon="hand-coin-outline" label={c.promises} onPress={() => router.push('/debt/promises' as never)} />
            <Action styles={styles} colors={colors} tone={accents.green} icon="format-list-bulleted" label={c.myReceivables} onPress={() => router.push('/debt/accounts?direction=RECEIVABLE' as never)} />
            <Action styles={styles} colors={colors} tone={accents.blue} icon="cog-outline" label={c.tools} onPress={() => router.push('/debt/tools' as never)} />
          </View>

          <RecentAccounts view={t} styles={styles} colors={colors} accents={accents} c={c} money={money} />

          {/* The report is a secondary action: the balances first, the PDF at the end (rc.7). */}
          <ReportButton build={(d, l) => debtReport(d, l)} />
        </>
      )}
    </ScrollView>
  );
}

function Metric({ styles, label, value, tone, icon: ic, hint, onPress }: { styles: ReturnType<typeof makeStyles>; label: string; value: string; tone: AccentRole; icon: IconName; hint?: string; onPress?: () => void }) {
  // A figure the reader wants to open is a figure worth making tappable. Without a
  // destination it stays a plain card rather than pretending to be a button.
  const body = (
    <>
      <View style={[styles.metricIcon, { backgroundColor: tone.soft }]}><AppIcon name={ic} size={icon.sm} color={tone.on} /></View>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.metricValue}>{value}</Text>
      <Text numberOfLines={1} style={styles.metricLabel}>{label}</Text>
      {hint ? <Text numberOfLines={1} style={styles.metricHint}>{hint}</Text> : null}
    </>
  );
  if (!onPress) return <View style={[styles.metric, { borderColor: tone.border }]}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={() => { tapLight(); onPress(); }}
      style={({ pressed }) => StyleSheet.flatten([styles.metric, { borderColor: tone.border }, pressed && styles.pressed])}
    >
      {body}
    </Pressable>
  );
}

function StripLine({ styles, label, value }: { styles: ReturnType<typeof makeStyles>; label: string; value: string }) {
  return (
    <View style={styles.stripRow}>
      <Text numberOfLines={1} style={styles.stripLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.stripValue}>{value}</Text>
    </View>
  );
}

function Action({ styles, colors, tone, icon: ic, label, onPress }: { styles: ReturnType<typeof makeStyles>; colors: ThemeColors; tone: AccentRole; icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { tapLight(); onPress(); }} style={({ pressed }) => StyleSheet.flatten([styles.action, pressed && styles.pressed])}>
      <View style={[styles.actionIcon, { backgroundColor: tone.soft, borderColor: tone.border }]}><AppIcon name={ic} size={icon.md} color={tone.on} /></View>
      <Text numberOfLines={2} style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function RecentAccounts({ view, styles, colors, accents, c, money }: {
  view: PortfolioView | null; styles: ReturnType<typeof makeStyles>; colors: ThemeColors; accents: ThemeAccents; c: ReturnType<typeof debtCopy>; money: (p: number) => string;
}) {
  const rows = (view?.accounts ?? []).slice(0, 6);
  const nameById = new Map((view?.people ?? []).map((person) => [person.id, person.name]));
  if (!rows.length) {
    return (
      <View style={styles.emptyBox}>
        <AppIcon name="wallet-outline" size={28} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>{c.noDebts}</Text>
        <Text style={styles.emptyHint}>{c.noDebtsHint}</Text>
      </View>
    );
  }
  const balById = new Map(view!.balances.map((b) => [b.accountId, b]));
  return (
    <View style={styles.recentWrap}>
      <Text style={styles.sectionTitle}>{c.myDebts} · {c.myReceivables}</Text>
      {rows.map((a) => {
        const b = balById.get(a.id);
        const tone = a.direction === 'DEBT' ? accents.red : accents.green;
        return (
          <Pressable key={a.id} accessibilityRole="button" onPress={() => router.push(`/debt/account/${a.id}` as never)} style={({ pressed }) => StyleSheet.flatten([styles.recentRow, pressed && styles.pressed])}>
            <View style={[styles.recentDot, { backgroundColor: tone.base }]} />
            <View style={styles.recentBody}>
              <Text numberOfLines={1} style={styles.recentTitle}>{a.title || nameById.get(a.personId) || (a.direction === 'DEBT' ? c.totalDebt : c.totalReceivable)}</Text>
              <Text numberOfLines={1} style={styles.recentMeta}>{c.status[b?.status ?? a.status]} · {c.remaining} {money(b?.remainingPaisa ?? 0)}</Text>
            </View>
            <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ThemeColors, _accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
    header: { paddingTop: spacing.sm, marginBottom: spacing.md },
    headerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    fixDoor: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg, borderWidth: border.thin, marginBottom: spacing.md },
    fixDoorText: { flex: 1, minWidth: 0, ...typography.bodySmall, fontWeight: '700' },
    eyebrow: { color: colors.primary, ...typography.label, fontWeight: '700', letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700', marginTop: spacing.xs },
    sub: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.xs },
    netCard: { borderWidth: border.thin, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md, ...elevation.soft },
    netLabel: { ...typography.label, fontWeight: '800', letterSpacing: 0.6 },
    netValue: { ...typography.display, fontWeight: '800', marginTop: spacing.xxs, fontFamily: typography.numeric.fontFamily },
    netSplit: { marginTop: spacing.sm, gap: 2 },
    netSplitText: { color: colors.textSecondary, ...typography.caption },
    strip: { borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginBottom: spacing.md, ...elevation.soft },
    stripRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
    stripLabel: { flex: 1, minWidth: 0, color: colors.textSecondary, ...typography.caption },
    stripValue: { color: colors.textPrimary, ...typography.caption, fontWeight: '800', fontFamily: typography.numeric.fontFamily },
    metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
    metric: { width: '47.5%', maxWidth: '47.5%', flexGrow: 1, borderWidth: border.thin, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, ...elevation.soft },
    metricIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
    metricValue: { color: colors.textPrimary, ...typography.cardTitle, fontWeight: '800', fontFamily: typography.numeric.fontFamily },
    metricLabel: { color: colors.textSecondary, ...typography.caption, marginTop: 2 },
    metricHint: { color: colors.textMuted, ...typography.caption, marginTop: 2 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
    action: { width: '47.5%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, minHeight: 60, ...elevation.soft },
    actionIcon: { width: 36, height: 36, borderRadius: radius.md, borderWidth: border.thin, alignItems: 'center', justifyContent: 'center' },
    actionLabel: { flex: 1, minWidth: 0, color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    sectionTitle: { color: colors.textMuted, ...typography.section, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm },
    recentWrap: { gap: spacing.sm },
    recentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, ...elevation.soft },
    recentDot: { width: 8, height: 8, borderRadius: radius.pill },
    recentBody: { flex: 1, minWidth: 0 },
    recentTitle: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    recentMeta: { color: colors.textSecondary, ...typography.caption, marginTop: 2 },
    emptyBox: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
    emptyTitle: { color: colors.textPrimary, ...typography.cardTitle, fontWeight: '700' },
    emptyHint: { color: colors.textSecondary, ...typography.caption },
    pressed: { opacity: 0.78 },
  });
}
