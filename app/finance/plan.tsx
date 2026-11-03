// This month's promise.
//
// The one screen where the modules visibly meet: it reads what came in, what went out,
// what is owed, and what is genuinely free — numbers that come from every module that
// reports money — and lets the person say what they mean to do about it.
//
// The promise is never enforced. Money set aside for a loan is still money in your hand,
// and if a child needs medicine it goes on medicine; an app that had already deducted it
// would have been lying all month. What the promise buys is a sentence Home can say:
// how this month is going against what you meant.

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../../src/ui/AppText';
import { AppIcon } from '../../src/ui/AppIcon';
import { Bar, Card, Chip, Field, ScreenHeader, useKit } from '../../src/ui/AppKit';
import { useAppFeedback } from '../../src/ui/AppFeedback';
import { asciiDigitsToBengali, formatPaisa, paisaToTakaString } from '../../src/services/debt/money';
import { collectInsights, type Insight, type MonthPicture } from '../../src/services/insight-service';
import { monthKey, spendingByNeed, type NeedSplit } from '../../src/services/finance-service';
import {
  closeOutMonth, estimateZakat, incomeShape,
  type IncomeShape, type MonthClose, type ZakatEstimate,
} from '../../src/services/money-sense';
import { getGoal, getGoal as readGoal, setGoal, setGoal as writeGoal } from '../../src/services/goal-service';
import { monthName } from '../../src/modules/finance.module';
import { border, icon as iconSize, layout, radius, spacing, typography, type ThemeColors } from '../../src/theme';
import { success, tapLight, warn } from '../../src/ui/haptics';

export default function FinancePlanScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn, language } = useKit();
  const { showSnackbar } = useAppFeedback();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const month = monthKey();

  const [picture, setPicture] = useState<MonthPicture | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [split, setSplit] = useState<NeedSplit | null>(null);
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const [close, setClose] = useState<MonthClose | null>(null);
  const [income, setIncome] = useState<IncomeShape | null>(null);
  const [zakat, setZakat] = useState<ZakatEstimate | null>(null);
  const [nisab, setNisab] = useState('');
  const [saveGoal, setSaveGoal] = useState('');

  const money = useCallback((paisa: number) => formatPaisa(paisa, { bnDigits: bn }), [bn]);
  const digits = useCallback((v: string | number) => (bn ? asciiDigitsToBengali(String(v)) : String(v)), [bn]);

  const load = useCallback(async () => {
    const [result, needs, goal, closed, shape, nisabGoal] = await Promise.all([
      collectInsights(db, language, month),
      spendingByNeed(db, month),
      getGoal(db, 'debt', 'REPAY', month),
      closeOutMonth(db, month).catch(() => null),
      incomeShape(db).catch(() => null),
      readGoal(db, 'finance', 'NISAB', '*').catch(() => null),
    ]);
    const saving = await readGoal(db, 'finance', 'SAVE', month).catch(() => null);
    setSaveGoal(saving?.targetPaisa ? paisaToTakaString(saving.targetPaisa) : '');
    setPicture(result.picture);
    setInsights(result.insights);
    setSplit(needs);
    setTarget(goal?.targetPaisa ? paisaToTakaString(goal.targetPaisa) : '');
    setClose(closed);
    setIncome(shape);

    // Zakat needs today's nisab, which tracks the silver or gold price and cannot be known
    // offline. The user enters it once; until they do, the card explains rather than
    // guessing — a confident figure built on a made-up threshold would be worse than none.
    const nisabPaisa = nisabGoal?.targetPaisa ?? 0;
    setNisab(nisabPaisa ? paisaToTakaString(nisabPaisa) : '');
    setZakat(nisabPaisa ? await estimateZakat(db, nisabPaisa).catch(() => null) : null);
  }, [db, language, month]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const commit = useCallback(async (value: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await setGoal(db, { module: 'debt', kind: 'REPAY', period: month, target: value || 0 });
      success();
      showSnackbar(
        value ? (bn ? 'লক্ষ্য ঠিক করা হলো' : 'Target set') : (bn ? 'লক্ষ্য সরানো হলো' : 'Target cleared'),
        'success',
      );
      await load();
    } catch {
      warn();
      showSnackbar(bn ? 'অঙ্কটি বোঝা গেল না' : 'That amount could not be read', 'danger');
    } finally { setSaving(false); }
  }, [db, month, saving, bn, showSnackbar, load]);

  const headroom = picture?.headroomPaisa ?? 0;
  const owed = Math.max(0, (picture?.obligationPaisa ?? 0) - (picture?.obligationMetPaisa ?? 0));
  const met = picture?.obligationMetPaisa ?? 0;
  const goalPaisa = picture?.goals.find((g) => g.kind === 'REPAY')?.targetPaisa ?? 0;

  // Round suggestions to something a person would actually say out loud.
  const suggestions = headroom > 0
    ? [0.3, 0.5, 0.75].map((share) => Math.max(50000, Math.round((headroom * share) / 50000) * 50000))
      .filter((value, index, all) => value <= headroom && all.indexOf(value) === index)
    : [];

  return (
    <ScrollView keyboardDismissMode="on-drag" style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader
        title={bn ? 'এ মাসের পরিকল্পনা' : "This month's plan"}
        subtitle={`${monthName(month, bn)} ${digits(month.slice(0, 4))}`}
        backTo="/finance"
        backLabel={bn ? 'আয়-ব্যয়' : 'Income & spending'}
      />

      {/* What is genuinely free — the number every promise has to fit inside. */}
      <View style={[s.hero, { backgroundColor: headroom >= 0 ? accents.green.soft : accents.red.soft }]}>
        <Text style={[s.heroLabel, { color: headroom >= 0 ? accents.green.on : accents.red.on }]}>
          {bn ? 'খরচ ও বাধ্যতামূলক দেনার পর হাতে থাকছে' : 'Free after spending and what is owed'}
        </Text>
        <Text numberOfLines={1} style={[s.heroValue, { color: headroom >= 0 ? accents.green.on : accents.red.on }]}>
          {money(Math.abs(headroom))}
        </Text>
        <Text style={s.heroHint}>
          {bn
            ? `আয় ${money(picture?.inPaisa ?? 0)} · খরচ ${money(picture?.outPaisa ?? 0)} · বাকি দেনা ${money(owed)}`
            : `In ${money(picture?.inPaisa ?? 0)} · out ${money(picture?.outPaisa ?? 0)} · still owed ${money(owed)}`}
        </Text>
      </View>

      {/* The promise. */}
      <Card title={bn ? 'এ মাসে ঋণ শোধ করবেন' : 'Repay this month'}>
        <Field
          label={bn ? 'কত টাকা' : 'How much'}
          value={target}
          onChangeText={setTarget}
          keyboardType="numeric"
          placeholder={bn ? 'যেমন ৩০০০' : 'e.g. 3000'}
          hint={bn
            ? 'টাকাটা সরিয়ে রাখা হয় না — শুধু হিসাব রাখা হয় কতটা হলো।'
            : 'Nothing is set aside; the app only keeps track of how it is going.'}
        />
        {suggestions.length ? (
          <View style={s.chips}>
            {suggestions.map((value) => (
              <Chip
                key={value}
                label={money(value)}
                active={paisaToTakaString(value) === target.trim()}
                onPress={() => { tapLight(); setTarget(paisaToTakaString(value)); }}
              />
            ))}
          </View>
        ) : null}

        <View style={s.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void commit(target)}
            style={({ pressed }) => StyleSheet.flatten([s.primary, saving && s.faded, pressed && s.pressed])}
          >
            <Text numberOfLines={1} style={s.primaryText}>{bn ? 'ঠিক করুন' : 'Set it'}</Text>
          </Pressable>
          {goalPaisa ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => { setTarget(''); void commit(''); }}
              style={({ pressed }) => StyleSheet.flatten([s.ghost, pressed && s.pressed])}
            >
              <Text numberOfLines={1} style={s.ghostText}>{bn ? 'সরিয়ে দিন' : 'Clear'}</Text>
            </Pressable>
          ) : null}
        </View>

        {goalPaisa ? (
          <View style={s.progress}>
            <Text numberOfLines={1} style={s.progressText}>
              {bn
                ? `${money(goalPaisa)}-এর মধ্যে দেওয়া হয়েছে ${money(met)}`
                : `${money(met)} of ${money(goalPaisa)} paid`}
            </Text>
            <Bar pct={Math.min(1, met / goalPaisa) * 100} tone={met >= goalPaisa ? accents.green : accents.blue} />
          </View>
        ) : null}
      </Card>

      {/* Where the money goes, split the way the user classified it themselves. */}
      {split ? (
        <Card title={bn ? 'খরচটা কেমন ছিল' : 'What the spending was for'}>
          {([
            { key: 'ESSENTIAL', label: bn ? 'অপরিহার্য' : 'Essential', value: split.essentialPaisa, tone: accents.blue },
            { key: 'NEEDED', label: bn ? 'দরকারি' : 'Needed', value: split.neededPaisa, tone: accents.purple },
            { key: 'WANT', label: bn ? 'শখ' : 'Wants', value: split.wantPaisa, tone: accents.orange },
          ]).map((row) => {
            const total = split.essentialPaisa + split.neededPaisa + split.wantPaisa || 1;
            return (
              <Pressable
                key={row.key}
                accessibilityRole="button"
                onPress={() => { tapLight(); router.push('/finance' as never); }}
                style={({ pressed }) => StyleSheet.flatten([s.splitRow, pressed && s.pressed])}
              >
                <View style={s.splitTop}>
                  <Text numberOfLines={1} style={s.splitLabel}>{row.label}</Text>
                  <Text numberOfLines={1} style={[s.splitValue, { color: row.tone.on }]}>{money(row.value)}</Text>
                </View>
                <Bar pct={(row.value / total) * 100} tone={row.tone} />
              </Pressable>
            );
          })}
          <Text style={s.footnote}>
            {bn
              ? 'কোন খাত কেমন — সেটা আপনিই ঠিক করেন, হিসাব যোগ করার সময়। অ্যাপ নিজে কিছু ধরে নেয় না।'
              : 'You decide what each category counts as, when you add an entry. The app assumes nothing.'}
          </Text>
        </Card>
      ) : null}

      {/* How the month went against the one before — a figure alone is data; a figure
          against last month is a story, and a story is what gets acted on. */}
      {close && close.entryCount ? (
        <Card title={bn ? 'গত মাসের তুলনায়' : 'Against last month'}>
          <View style={s.compareRow}>
            <View style={s.grow}>
              <Text style={s.splitLabel}>{bn ? 'হাতে থাকল' : 'Kept'}</Text>
              <Text numberOfLines={1} style={[s.splitValue, { color: close.netChangePaisa >= 0 ? accents.green.on : accents.red.on }]}>
                {`${close.netChangePaisa >= 0 ? '+' : '−'} ${money(Math.abs(close.netChangePaisa))}`}
              </Text>
            </View>
            <View style={s.grow}>
              <Text style={s.splitLabel}>{bn ? 'খরচ' : 'Spent'}</Text>
              <Text numberOfLines={1} style={[s.splitValue, { color: close.spendChangePaisa <= 0 ? accents.green.on : accents.orange.on }]}>
                {`${close.spendChangePaisa >= 0 ? '+' : '−'} ${money(Math.abs(close.spendChangePaisa))}`}
              </Text>
            </View>
          </View>
          {close.biggestMover ? (
            <Text style={s.footnote}>
              {bn
                ? `সবচেয়ে বেশি বদলেছে ${close.biggestMover.category} — ${close.biggestMover.changePaisa > 0 ? 'বেড়েছে' : 'কমেছে'} ${money(Math.abs(close.biggestMover.changePaisa))}।`
                : `${close.biggestMover.category} moved most — ${close.biggestMover.changePaisa > 0 ? 'up' : 'down'} ${money(Math.abs(close.biggestMover.changePaisa))}.`}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* For anyone whose income is not a salary, last month alone is a bad plan. */}
      {income?.irregular ? (
        <Card title={bn ? 'আয় সব মাসে সমান নয়' : 'Your income varies'}>
          <Text style={s.footnote}>
            {bn
              ? `গত ${digits(income.monthsSeen)} মাসে সবচেয়ে কম ${money(income.lowestPaisa)}, সবচেয়ে বেশি ${money(income.highestPaisa)}। পরিকল্পনা করলে ${money(income.typicalPaisa)} ধরে করুন — গত মাসের সংখ্যা ধরে নয়।`
              : `Over ${income.monthsSeen} months the lowest was ${money(income.lowestPaisa)} and the highest ${money(income.highestPaisa)}. Plan against ${money(income.typicalPaisa)}, not against last month.`}
          </Text>
        </Card>
      ) : null}

      {/* Saving is the other half of a plan. A month spent only avoiding debt still ends
          with nothing put by, and the same headroom answers both questions. */}
      <Card title={bn ? 'এ মাসে জমাবেন' : 'Save this month'}>
        <Field
          label={bn ? 'কত টাকা' : 'How much'}
          value={saveGoal}
          onChangeText={setSaveGoal}
          keyboardType="numeric"
          placeholder={bn ? 'যেমন ২০০০' : 'e.g. 2000'}
          hint={bn
            ? 'ঋণ শোধের পরেও কিছু জমলে পরের মাসে ধার করতে হয় না — সেটাই আসল হিসাব।'
            : 'Something put by is what stops next month needing a loan.'}
        />
        <Pressable
          accessibilityRole="button"
          onPress={async () => {
            tapLight();
            await writeGoal(db, { module: 'finance', kind: 'SAVE', period: month, target: saveGoal || 0 });
            await load();
          }}
          style={({ pressed }) => StyleSheet.flatten([s.primary, { marginTop: spacing.sm }, pressed && s.pressed])}
        >
          <Text numberOfLines={1} style={s.primaryText}>{bn ? 'ঠিক করুন' : 'Set it'}</Text>
        </Pressable>
        {headroom > 0 && saveGoal.trim() ? (
          <Text style={s.footnote}>
            {bn
              ? `খরচের পর হাতে আছে ${money(headroom)} — এর মধ্যে থেকেই জমাতে হবে।`
              : `${money(headroom)} is free after spending; this comes out of that.`}
          </Text>
        ) : null}
      </Card>

      {/* Zakat: arithmetic offered, never a ruling. */}
      <Card title={bn ? 'যাকাতের হিসাব' : 'Zakat'}>
        <Field
          label={bn ? 'আজকের নিসাব কত' : "Today's nisab"}
          value={nisab}
          onChangeText={setNisab}
          keyboardType="numeric"
          placeholder={bn ? 'রুপা বা স্বর্ণের দর অনুযায়ী' : 'By the silver or gold rate'}
          hint={bn
            ? 'নিসাব প্রতিদিন বদলায় আর অ্যাপ অফলাইন — তাই দরটা আপনাকেই একবার বসিয়ে দিতে হবে।'
            : 'Nisab moves with the metal price and the app is offline, so this one number has to come from you.'}
        />
        <Pressable
          accessibilityRole="button"
          onPress={async () => {
            tapLight();
            await writeGoal(db, { module: 'finance', kind: 'NISAB', period: '*', target: nisab || 0 });
            await load();
          }}
          style={({ pressed }) => StyleSheet.flatten([s.primary, { marginTop: spacing.sm }, pressed && s.pressed])}
        >
          <Text numberOfLines={1} style={s.primaryText}>{bn ? 'হিসাব করুন' : 'Work it out'}</Text>
        </Pressable>

        {zakat ? (
          <>
            <View style={[s.compareRow, { marginTop: spacing.md }]}>
              <View style={s.grow}>
                <Text style={s.splitLabel}>{bn ? 'সম্পদ' : 'Assets'}</Text>
                <Text numberOfLines={1} style={s.splitValue}>{money(zakat.assetsPaisa)}</Text>
              </View>
              <View style={s.grow}>
                <Text style={s.splitLabel}>{bn ? 'দেনা' : 'Debts'}</Text>
                <Text numberOfLines={1} style={s.splitValue}>{money(zakat.liabilitiesPaisa)}</Text>
              </View>
            </View>
            <Text numberOfLines={1} style={[s.zakatDue, { color: zakat.eligible ? accents.green.on : colors.textMuted }]}>
              {zakat.eligible
                ? (bn ? `যাকাত আসে ${money(zakat.duePaisa)}` : `Zakat comes to ${money(zakat.duePaisa)}`)
                : (bn ? 'নিসাবের নিচে — যাকাত ফরজ হয়নি' : 'Below nisab — none is due')}
            </Text>
            <Text style={s.footnote}>
              {bn
                ? 'এটি শুধু অ্যাপে লেখা টাকার হিসাব। স্বর্ণ, রুপা, জমি, ব্যবসার মাল আর চান্দ্র বছরের হিসাব এতে নেই — সেগুলো নিজে যোগ করে নিন, আর সন্দেহ হলে আলেমের পরামর্শ নিন।'
                : 'This counts only the money written in the app. Gold, silver, land, business stock and the lunar year are not included — add those yourself, and ask a scholar where it matters.'}
            </Text>
          </>
        ) : null}
      </Card>

      {/* Everything the modules worked out together. */}
      {insights.length ? (
        <Card title={bn ? 'অ্যাপ যা দেখছে' : 'What the app can see'}>
          {insights.map((insight) => {
            const tone = insight.severity === 'RISK' ? accents.red
              : insight.severity === 'WATCH' ? accents.orange
              : insight.severity === 'GOOD' ? accents.green
              : accents.blue;
            return (
              <Pressable
                key={insight.id}
                accessibilityRole="button"
                onPress={() => { tapLight(); if (insight.route) router.push(insight.route as never); }}
                style={({ pressed }) => StyleSheet.flatten([s.insight, { borderColor: tone.border }, pressed && s.pressed])}
              >
                <View style={s.insightTop}>
                  <AppIcon
                    name={insight.severity === 'RISK' ? 'alert-circle-outline' : insight.severity === 'GOOD' ? 'check-circle-outline' : 'lightbulb-on-outline'}
                    size={iconSize.sm}
                    color={tone.on}
                  />
                  <Text numberOfLines={2} style={[s.insightTitle, { color: tone.on }]}>{insight.title}</Text>
                </View>
                <Text style={s.insightDetail}>{insight.detail}</Text>
                <Text style={s.insightFrom}>
                  {bn ? `হিসাব মিলিয়ে: ${insight.from.join(' + ')}` : `From: ${insight.from.join(' + ')}`}
                </Text>
              </Pressable>
            );
          })}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
    hero: { borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
    heroLabel: { ...typography.caption, fontWeight: '800' },
    heroValue: { ...typography.display, fontWeight: '700', marginTop: 2, flexShrink: 1 },
    heroHint: { color: colors.textSecondary, ...typography.caption, marginTop: spacing.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    primary: { flex: 1, minHeight: layout.minTouchTarget, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    primaryText: { color: colors.onPrimary, ...typography.callout, fontWeight: '800', flexShrink: 1 },
    ghost: { minHeight: layout.minTouchTarget, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    ghostText: { color: colors.textSecondary, ...typography.callout, fontWeight: '800', flexShrink: 1 },
    progress: { marginTop: spacing.md },
    progressText: { color: colors.textSecondary, ...typography.caption, fontWeight: '700', marginBottom: 4 },
    splitRow: { paddingVertical: spacing.sm, minHeight: layout.minTouchTarget, justifyContent: 'center' },
    splitTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: 4 },
    splitLabel: { color: colors.textPrimary, ...typography.body, fontWeight: '700', flexShrink: 1 },
    splitValue: { ...typography.caption, fontWeight: '800', flexShrink: 1 },
    insight: { borderWidth: border.thin, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs },
    insightTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    insightTitle: { flex: 1, minWidth: 0, ...typography.body, fontWeight: '800' },
    insightDetail: { color: colors.textSecondary, ...typography.bodySmall, marginTop: 4, lineHeight: 19 },
    insightFrom: { color: colors.textMuted, ...typography.caption, marginTop: 4 },
    footnote: { color: colors.textMuted, ...typography.caption, marginTop: spacing.sm, lineHeight: 17 },
    compareRow: { flexDirection: 'row', gap: spacing.md },
    grow: { flex: 1, minWidth: 0 },
    zakatDue: { ...typography.cardTitle, fontWeight: '800', marginTop: spacing.sm, flexShrink: 1 },
    faded: { opacity: 0.5 },
    pressed: { opacity: 0.78 },
  });
}
