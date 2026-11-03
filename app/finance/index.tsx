// আয়-ব্যয় — the month at a glance, then every entry in it.
//
// The shape mirrors the debt list on purpose: same header, same chips, same cards, same
// tap target. Someone who has learned one screen in this app has learned all of them, and
// that consistency is worth more than any per-module cleverness.
//
// Every card here goes somewhere. A figure you cannot tap is a figure you cannot check.

import { withFabRoom } from '../../src/ui/FloatingApon';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../../src/ui/AppText';
import { ModuleGuide } from '../../src/ui/ModuleGuide';
import { AppIcon } from '../../src/ui/AppIcon';
import { Bar, Card, Chip, EmptyNote, ScreenHeader, useKit } from '../../src/ui/AppKit';
import { asciiDigitsToBengali, formatPaisa } from '../../src/services/debt/money';
import { monthName } from '../../src/modules/finance.module';
import {
  budgetStatus,
  categoryBreakdown,
  fundSourceLabel,
  listEntries,
  monthKey,
  repaymentBySource,
  spendingBySource,
  summariseMonth,
  type SourceTotal,
  type BudgetStatus,
  type CategoryTotal,
  type EntryKind,
  type FinanceEntry,
  type MonthSummary,
} from '../../src/services/finance-service';
import { moneyGapCount } from '../../src/services/money-bridge';
import { border, elevation, icon as iconSize, layout, radius, spacing, typography, type ThemeColors } from '../../src/theme';
import { tapLight } from '../../src/ui/haptics';
import { EntryPreview } from '../../src/ui/EntryPreview';
import { shiftMonthKey as shiftMonth } from '../../src/i18n/date-time';
import { ReportButton } from '../../src/ui/ReportButton';
import { financeReport } from '../../src/services/module-reports';

type Filter = 'ALL' | EntryKind;

export default function FinanceScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn } = useKit();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [month, setMonth] = useState(monthKey());

  const [previewEntry, setPreviewEntry] = useState<FinanceEntry | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [only, setOnly] = useState<string | null>(null);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [breakdown, setBreakdown] = useState<CategoryTotal[]>([]);
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  // Whose money paid this month, and how many old records still lack a wallet or source.
  const [spendSources, setSpendSources] = useState<SourceTotal[]>([]);
  const [repaySources, setRepaySources] = useState<SourceTotal[]>([]);
  const [gaps, setGaps] = useState(0);

  const money = useCallback((paisa: number) => formatPaisa(paisa, { bnDigits: bn }), [bn]);
  const digits = useCallback((value: string | number) => (bn ? asciiDigitsToBengali(String(value)) : String(value)), [bn]);

  const load = useCallback(async () => {
    const [s1, list, cats, buds, spendBy, repayBy, gapCount] = await Promise.all([
      summariseMonth(db, month),
      listEntries(db, { month, kind: filter === 'ALL' ? undefined : filter, category: only ?? undefined }),
      categoryBreakdown(db, 'EXPENSE', month),
      budgetStatus(db, month),
      spendingBySource(db, month).catch(() => [] as SourceTotal[]),
      repaymentBySource(db, month).catch(() => [] as SourceTotal[]),
      moneyGapCount(db).catch(() => 0),
    ]);
    setSummary(s1);
    setEntries(list);
    setBreakdown(cats);
    setBudgets(buds);
    setSpendSources(spendBy);
    setRepaySources(repayBy);
    setGaps(gapCount);
  }, [db, month, filter, only]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const isThisMonth = month === monthKey();
  const overspent = (summary?.netPaisa ?? 0) < 0;

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={withFabRoom(s.content)} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title={bn ? 'আয়-ব্যয়' : 'Income & spending'}
          subtitle={bn ? 'কী এল, কী গেল, হাতে কী থাকল' : 'What came in, what went out, what is left'}
          backTo="/"
          backLabel={bn ? 'হোম' : 'Home'}
          right={<ModuleGuide id="finance" />}
        />


        {/* The month walker. Tapping the name itself returns to this month. */}
        <View style={s.monthRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'আগের মাস' : 'Previous month'}
            onPress={() => { tapLight(); setMonth((m) => shiftMonth(m, -1)); }}
            style={({ pressed }) => StyleSheet.flatten([s.monthArrow, pressed && s.pressed])}
          >
            <AppIcon name="chevron-left" size={iconSize.md} color={colors.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => { tapLight(); setMonth(monthKey()); }}
            style={({ pressed }) => StyleSheet.flatten([s.monthName, pressed && s.pressed])}
          >
            <Text numberOfLines={1} style={s.monthText}>
              {`${monthName(month, bn)} ${digits(month.slice(0, 4))}`}
            </Text>
            {!isThisMonth ? <Text style={s.monthHint}>{bn ? 'এই মাসে ফিরুন' : 'Back to this month'}</Text> : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'পরের মাস' : 'Next month'}
            disabled={isThisMonth}
            onPress={() => { tapLight(); setMonth((m) => shiftMonth(m, 1)); }}
            style={({ pressed }) => StyleSheet.flatten([s.monthArrow, isThisMonth && s.faded, pressed && s.pressed])}
          >
            <AppIcon name="chevron-right" size={iconSize.md} color={colors.primary} />
          </Pressable>
        </View>

        {/* What is left — the one figure that changes what someone does next. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => { tapLight(); setFilter('ALL'); setOnly(null); }}
          style={({ pressed }) => StyleSheet.flatten([
            s.hero,
            { backgroundColor: overspent ? accents.orange.soft : accents.green.soft },
            pressed && s.pressed,
          ])}
        >
          <Text style={[s.heroLabel, { color: overspent ? accents.orange.on : accents.green.on }]}>
            {overspent ? (bn ? 'এই মাসে বেশি খরচ হয়েছে' : 'Spent more than earned') : (bn ? 'এই মাসে আয় থেকে খরচ বাদে' : 'This month: income minus spending')}
          </Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[s.heroValue, { color: overspent ? accents.orange.on : accents.green.on }]}>
            {money(Math.abs(summary?.netPaisa ?? 0))}
          </Text>
          <View style={s.heroSplit}>
            {/* Each figure is also the filter that isolates it — tapping "ব্যয়" is the
                shortest way to ask "what did I spend it on". */}
            {([
              { key: 'in', label: bn ? 'আয়' : 'In', value: money(summary?.incomePaisa ?? 0), tone: accents.green, to: 'INCOME' as const },
              { key: 'out', label: bn ? 'ব্যয়' : 'Out', value: money(summary?.expensePaisa ?? 0), tone: accents.orange, to: 'EXPENSE' as const },
              { key: 'n', label: bn ? 'হিসাব' : 'Entries', value: digits(summary?.entryCount ?? 0), tone: accents.blue, to: 'ALL' as const },
            ]).map((cell) => (
              <Pressable
                key={cell.key}
                accessibilityRole="button"
                accessibilityLabel={`${cell.label}: ${cell.value}`}
                onPress={() => { tapLight(); setFilter(cell.to); setOnly(null); }}
                style={({ pressed }) => StyleSheet.flatten([s.heroCell, pressed && s.pressed])}
              >
                <Text numberOfLines={1} style={s.heroCellLabel}>{cell.label}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[s.heroCellValue, { color: cell.tone.on }]}>{cell.value}</Text>
              </Pressable>
            ))}
          </View>
          {/* Borrowing and repaying move real cash but are neither earning nor spending,
              so they sit on their own line. Without it the month simply would not add up
              for anyone who checks: the wallet moved and neither figure above did. */}
          {(summary?.debtInPaisa || summary?.debtOutPaisa) ? (
            <Text numberOfLines={2} style={s.heroDebtNote}>
              {bn
                ? `ঋণের চলাচল — এসেছে ${money(summary.debtInPaisa)} · গেছে ${money(summary.debtOutPaisa)} (আয়-ব্যয়ে ধরা হয়নি)`
                : `Debt movement — in ${money(summary.debtInPaisa)} · out ${money(summary.debtOutPaisa)} (not counted as income or spending)`}
            </Text>
          ) : null}
        </Pressable>

        {/* Where the money actually is — cash, bKash, bank, each on its own. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => { tapLight(); router.push('/finance/wallets' as never); }}
          style={({ pressed }) => StyleSheet.flatten([s.planCard, pressed && s.pressed])}
        >
          <View style={[s.entryIcon, { backgroundColor: accents.purple.soft }]}>
            <AppIcon name="wallet-outline" size={iconSize.sm} color={accents.purple.on} />
          </View>
          <View style={s.grow}>
            <Text numberOfLines={1} style={s.entryTitle}>{bn ? 'মানিব্যাগ' : 'Wallets'}</Text>
            <Text numberOfLines={2} style={s.entryMeta}>
              {bn ? 'নগদ, বিকাশ, ব্যাংক — কোথায় কত আছে' : 'Cash, bKash, bank — what is where'}
            </Text>
          </View>
          <AppIcon name="chevron-right" size={iconSize.md} color={colors.textMuted} />
        </Pressable>

        {/* The plan: where the month's promise is made and every module's numbers meet. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => { tapLight(); router.push('/finance/plan' as never); }}
          style={({ pressed }) => StyleSheet.flatten([s.planCard, pressed && s.pressed])}
        >
          <View style={[s.entryIcon, { backgroundColor: accents.blue.soft }]}>
            <AppIcon name="target" size={iconSize.sm} color={accents.blue.on} />
          </View>
          <View style={s.grow}>
            <Text numberOfLines={1} style={s.entryTitle}>{bn ? 'এ মাসের পরিকল্পনা' : "This month's plan"}</Text>
            <Text numberOfLines={2} style={s.entryMeta}>
              {bn ? 'কত শোধ করবেন ঠিক করুন — খরচের সাথে মিলিয়ে অ্যাপ জানাবে' : 'Set what to repay; the app weighs it against your spending'}
            </Text>
          </View>
          <AppIcon name="chevron-right" size={iconSize.md} color={colors.textMuted} />
        </Pressable>

        {/* Two big doors, because adding is what people came to do. */}
        <View style={s.addRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => { tapLight(); router.push({ pathname: '/finance/new' as never, params: { kind: 'INCOME' } }); }}
            style={({ pressed }) => StyleSheet.flatten([s.addCard, { borderColor: accents.green.on }, pressed && s.pressed])}
          >
            <AppIcon name="arrow-down-circle-outline" size={iconSize.lg} color={accents.green.on} />
            <Text numberOfLines={1} style={[s.addText, { color: accents.green.on }]}>{bn ? 'আয় যোগ' : 'Add income'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => { tapLight(); router.push({ pathname: '/finance/new' as never, params: { kind: 'EXPENSE' } }); }}
            style={({ pressed }) => StyleSheet.flatten([s.addCard, { borderColor: accents.orange.on }, pressed && s.pressed])}
          >
            <AppIcon name="arrow-up-circle-outline" size={iconSize.lg} color={accents.orange.on} />
            <Text numberOfLines={1} style={[s.addText, { color: accents.orange.on }]}>{bn ? 'ব্যয় যোগ' : 'Add expense'}</Text>
          </Pressable>
        </View>

        {/* Budgets, only once someone has set one. An empty budget card is a nag. */}
        {budgets.length ? (
          <Card title={bn ? 'খরচের সীমা' : 'Spending limits'}>
            {budgets.slice(0, 4).map((b) => (
              <Pressable
                key={b.category}
                accessibilityRole="button"
                onPress={() => { tapLight(); setOnly(only === b.category ? null : b.category); }}
                style={({ pressed }) => StyleSheet.flatten([s.budgetRow, pressed && s.pressed])}
              >
                <View style={s.budgetTop}>
                  <Text numberOfLines={1} style={s.budgetName}>{b.category}</Text>
                  <Text numberOfLines={1} style={[s.budgetFigure, b.ratio > 1 && { color: accents.red.on }]}>
                    {`${money(b.spentPaisa)} / ${money(b.limitPaisa)}`}
                  </Text>
                </View>
                <Bar pct={Math.min(1, b.ratio) * 100} tone={b.ratio > 1 ? accents.red : b.ratio > 0.8 ? accents.orange : accents.green} />
              </Pressable>
            ))}
          </Card>
        ) : null}

        {/* Where the money went. Tapping a slice opens that category's entries. */}
        {breakdown.length ? (
          <Card title={bn ? 'কোথায় গেল' : 'Where it went'}>
            {breakdown.slice(0, 6).map((c) => (
              <Pressable
                key={c.category}
                accessibilityRole="button"
                onPress={() => { tapLight(); setOnly(only === c.category ? null : c.category); }}
                style={({ pressed }) => StyleSheet.flatten([s.budgetRow, pressed && s.pressed])}
              >
                <View style={s.budgetTop}>
                  <Text numberOfLines={1} style={s.budgetName}>{c.category}</Text>
                  <Text numberOfLines={1} style={s.budgetFigure}>
                    {`${money(c.totalPaisa)} · ${digits(Math.round(c.share * 100))}%`}
                  </Text>
                </View>
                <Bar pct={c.share * 100} tone={accents.blue} />
              </Pressable>
            ))}
          </Card>
        ) : null}

        {/* Whose money paid this month — the same rows আপন reads, so the two agree. Shown once
            any of it is known; what is not known is its own line, never guessed. */}
        {spendSources.some((r) => r.source) || repaySources.length ? (
          <Card title={bn ? 'টাকা কোথা থেকে গেল' : 'Whose money paid'}>
            {(() => {
              const total = spendSources.reduce((n, r) => n + r.totalPaisa, 0) || 1;
              const name = (r: SourceTotal) => (r.source ? fundSourceLabel(r.source, bn) : (bn ? 'উৎস জানা নেই' : 'Source not known'));
              const loanToLoan = repaySources.find((r) => r.source === 'LOAN')?.totalPaisa ?? 0;
              return (
                <>
                  {spendSources.map((r) => (
                    <View key={r.source ?? 'unknown'} style={s.budgetRow}>
                      <View style={s.budgetTop}>
                        <Text numberOfLines={1} style={s.budgetName}>{name(r)}</Text>
                        <Text numberOfLines={1} style={s.budgetFigure}>{`${money(r.totalPaisa)} · ${digits(Math.round((r.totalPaisa / total) * 100))}%`}</Text>
                      </View>
                      <Bar pct={(r.totalPaisa / total) * 100} tone={r.source === 'LOAN' ? accents.orange : r.source ? accents.blue : accents.purple} />
                    </View>
                  ))}
                  {loanToLoan > 0 ? (
                    <View style={s.budgetTop}>
                      <Text numberOfLines={1} style={[s.budgetName, { color: accents.orange.on }]}>{bn ? 'ঋণ দিয়ে ঋণ শোধ' : 'Loans repaid with loans'}</Text>
                      <Text numberOfLines={1} style={[s.budgetFigure, { color: accents.orange.on }]}>{money(loanToLoan)}</Text>
                    </View>
                  ) : null}
                </>
              );
            })()}
          </Card>
        ) : null}

        {/* Records from before every movement had to name its wallet and source. */}
        {gaps > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'হিসাব ঠিক করুন' : 'Fix records'}
            onPress={() => { tapLight(); router.push('/finance/fix' as never); }}
            style={({ pressed }) => StyleSheet.flatten([s.entry, { borderColor: accents.orange.border, backgroundColor: accents.orange.soft }, pressed && s.pressed])}
          >
            <View style={[s.entryIcon, { backgroundColor: colors.surface }]}>
              <AppIcon name="wallet-outline" size={iconSize.sm} color={accents.orange.on} />
            </View>
            <View style={s.grow}>
              <Text numberOfLines={1} style={s.entryTitle}>{bn ? `হিসাব ঠিক করুন (${digits(gaps)})` : `Fix records (${gaps})`}</Text>
              <Text numberOfLines={2} style={s.entryMeta}>{bn ? 'কিছু লেনদেনে মানিব্যাগ বা টাকার উৎস নেই — বসিয়ে দিলে হিসাব পুরো মিলবে' : 'Some records have no wallet or source — fill them in and everything adds up'}</Text>
            </View>
            <AppIcon name="chevron-right" size={iconSize.sm} color={accents.orange.on} />
          </Pressable>
        ) : null}

        <View style={s.filters}>
          {(['ALL', 'INCOME', 'EXPENSE'] as Filter[]).map((f) => (
            <Chip
              key={f}
              label={f === 'ALL' ? (bn ? 'সব' : 'All') : f === 'INCOME' ? (bn ? 'আয়' : 'Income') : (bn ? 'ব্যয়' : 'Expense')}
              active={filter === f}
              onPress={() => { tapLight(); setFilter(f); }}
            />
          ))}
        </View>

        {entries.length ? (
          entries.map((entry) => {
            const income = entry.kind === 'INCOME';
            const tone = income ? accents.green : accents.orange;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={`${entry.category} ${money(entry.amountPaisa)}`}
                onPress={() => { tapLight(); setPreviewEntry(entry); }}
                style={({ pressed }) => StyleSheet.flatten([s.entry, pressed && s.pressed])}
              >
                <View style={[s.entryIcon, { backgroundColor: tone.soft }]}>
                  <AppIcon name={income ? 'arrow-down' : 'arrow-up'} size={iconSize.sm} color={tone.on} />
                </View>
                <View style={s.grow}>
                  <Text numberOfLines={1} style={s.entryTitle}>{entry.category}</Text>
                  <Text numberOfLines={1} style={s.entryMeta}>
                    {[
                      digits(entry.occurredAt.slice(8, 10).replace(/^0/u, '')) + (bn ? ' তারিখ' : ''),
                      entry.personName,
                      entry.method,
                      entry.note,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text numberOfLines={1} style={[s.entryAmount, { color: tone.on }]}>
                  {`${income ? '+' : '−'} ${money(entry.amountPaisa)}`}
                </Text>
              </Pressable>
            );
          })
        ) : (
          <EmptyNote
            icon="notebook-outline"
            text={bn
              ? 'এই মাসে এখনো কিছু লেখা হয়নি।'
              : 'Nothing written down for this month yet.'}
            action={bn ? 'প্রথম খরচটা লিখুন' : 'Write the first expense'}
            onAction={() => { tapLight(); router.push({ pathname: '/finance/new' as never, params: { kind: 'EXPENSE' } }); }}
          />
        )}

        {/* The report is a secondary action: the month's money first, the PDF at the end (rc.7). */}
        <ReportButton build={(d, l) => financeReport(d, l, month)} />

        <Text style={s.footnote}>
          {bn
            ? 'সব হিসাব এই ফোনেই থাকে। রশিদের ছবি ও জায়গা প্রতিটি হিসাবের সাথে জুড়ে রাখা যায়।'
            : 'Every figure stays on this phone. A receipt photo and a place can be attached to any entry.'}
        </Text>
      <EntryPreview entry={previewEntry} onClose={() => setPreviewEntry(null)} />
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    grow: { flex: 1, minWidth: 0 },
    monthRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    monthArrow: { width: layout.minTouchTarget, height: layout.minTouchTarget, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border },
    monthName: { flex: 1, minHeight: layout.minTouchTarget, justifyContent: 'center', alignItems: 'center' },
    monthText: { color: colors.textPrimary, ...typography.cardTitle, flexShrink: 1 },
    monthHint: { color: colors.primary, ...typography.caption, fontWeight: '700' },
    hero: { borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md, ...elevation.soft },
    heroLabel: { ...typography.caption, fontWeight: '800', letterSpacing: 0.5 },
    heroValue: { ...typography.display, fontWeight: '700', marginTop: 2, flexShrink: 1 },
    heroDebtNote: { marginTop: spacing.sm, color: colors.textMuted, ...typography.caption, fontWeight: '700' },
  heroSplit: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    heroCell: { flex: 1, minWidth: 0 },
    heroCellLabel: { color: colors.textSecondary, ...typography.caption, fontWeight: '800' },
    heroCellValue: { ...typography.callout, fontWeight: '800', marginTop: 1, flexShrink: 1 },
    planCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget + 12, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, marginTop: spacing.md },
    addRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
    addCard: { flex: 1, minHeight: 72, borderRadius: radius.lg, borderWidth: border.thin, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: spacing.sm, ...elevation.soft },
    addText: { ...typography.callout, fontWeight: '800', flexShrink: 1 },
    budgetRow: { paddingVertical: spacing.sm, minHeight: layout.minTouchTarget, justifyContent: 'center' },
    budgetTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: 4 },
    budgetName: { color: colors.textPrimary, ...typography.body, fontWeight: '700', flexShrink: 1 },
    budgetFigure: { color: colors.textSecondary, ...typography.caption, fontWeight: '700', flexShrink: 1 },
    filters: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.sm },
    entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget + 12, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs },
    entryIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    entryTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    entryMeta: { color: colors.textMuted, ...typography.caption, marginTop: 1 },
    entryAmount: { ...typography.callout, fontWeight: '800', flexShrink: 1 },
    footnote: { color: colors.textMuted, ...typography.caption, textAlign: 'center', marginTop: spacing.lg },
    faded: { opacity: 0.35 },
    pressed: { opacity: 0.78 },
  });
}
