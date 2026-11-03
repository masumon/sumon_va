// স্বাস্থ্য — what is getting better, and what is not.
//
// The whole screen is one idea: a number on its own means nothing, but a number against
// where it started, and against where you meant it to be, means something you can act on.
// Weight going down and steps going up are the same arithmetic with the direction flipped,
// which is why there is no separate "improvement" and "decline" code anywhere.

import { withFabRoom } from '../src/ui/FloatingApon';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../src/ui/AppText';
import { AppIcon } from '../src/ui/AppIcon';
import { Bar, Card, Chip, EmptyNote, Field, FormBar, ScreenHeader, useKit } from '../src/ui/AppKit';
import { ModuleSettingsLink } from '../src/ui/ModuleSections';
import { ModuleGuide } from '../src/ui/ModuleGuide';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { useUnsavedGuard } from '../src/hooks/useUnsavedGuard';
import {
  listMeasurements, listMetrics, progress, recordMeasurement, setTarget, SELF,
  type Progress,
} from '../src/services/measurement-service';
import { METRICS, metricShape } from '../src/modules/health.module';
import { asciiDigitsToBengali, bengaliDigitsToAscii, formatPaisa } from '../src/services/debt/money';
import { bangladeshDateKey, formatBangladeshTime, formatDayKey } from '../src/i18n/date-time';
import {
  ensureDosesForDay, medicalSpendPeriods, missedDoses, setDoseStatus, upcomingHealth,
  type Dose, type MedicalSpendPeriods, type UpcomingHealth,
} from '../src/services/health-service';
import { border, icon as iconSize, layout, radius, spacing, typography, type ThemeColors } from '../src/theme';
import { success, tapLight, warn } from '../src/ui/haptics';

/** Bengali numerals inside Bengali text. Android mis-measures a line that mixes ASCII
 *  digits with Bengali and cuts it short, so every number in a Bengali sentence goes
 *  through here. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

/**
 * What a person types → the integer that gets stored.
 *
 * Everything is kept as a whole number in the smallest unit, so no reading is ever a
 * fraction that rounds differently on two devices. 72.5 kg becomes 72500 grams.
 */
function toSmallestUnit(metric: string, typed: string): number | null {
  // The hint under this field shows its example in Bengali digits ("যেমন ৭২.৫"), so a
  // Bengali keyboard typing them in is the expected case, not an edge case — stripping
  // everything outside [0-9.] before converting them silently deleted every digit typed.
  const value = Number(bengaliDigitsToAscii(typed).replace(/[^\d.]/gu, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  switch (metric) {
    case 'WEIGHT': return Math.round(value * 1000);
    case 'BLOOD_SUGAR': return Math.round(value * 100);
    case 'SLEEP': return Math.round(value * 60);
    default: return Math.round(value);
  }
}

/** What the input asks for, in the units a person actually says out loud. */
function inputHint(metric: string, bn: boolean): string {
  switch (metric) {
    case 'WEIGHT': return bn ? 'কেজিতে, যেমন ৭২.৫' : 'in kg, e.g. 72.5';
    case 'BLOOD_SUGAR': return bn ? 'মিলিমোলে, যেমন ৫.৬' : 'in mmol/L, e.g. 5.6';
    case 'SLEEP': return bn ? 'ঘণ্টায়, যেমন ৭.৫' : 'in hours, e.g. 7.5';
    case 'STEPS': return bn ? 'কদমের সংখ্যা' : 'number of steps';
    default: return bn ? 'যেমন ১২০' : 'e.g. 120';
  }
}

export default function HealthScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [tracked, setTracked] = useState<{ metric: string; count: number }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [states, setStates] = useState<Record<string, Progress | null>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ at: string; value: number }[]>([]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [missed, setMissed] = useState<Dose[]>([]);
  const [ahead, setAhead] = useState<UpcomingHealth[]>([]);
  const [spend, setSpend] = useState<MedicalSpendPeriods | null>(null);
  const [touched, setTouched] = useState(false);
  const guard = useUnsavedGuard(adding !== null && touched && !busy);
  const edited = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setTouched(true); };

  const digits = useCallback((v: string | number) => (bn ? asciiDigitsToBengali(String(v)) : String(v)), [bn]);

  const load = useCallback(async () => {
    try {
      try {
        const metrics = await listMetrics(db, SELF);
        setTracked(metrics.map((m) => ({ metric: m.metric, count: m.count })));
        const next: Record<string, Progress | null> = {};
        for (const { metric } of metrics) {
          next[metric] = await progress(db, metric, SELF, undefined, metricShape(metric)?.better).catch(() => null);
        }
        setStates(next);
      } catch {
        setTracked([]);
        setStates({});
      }
      // The medicine half loads independently: a broken reading must not blank the doses,
      // and an empty medicine list must not hide a weight that is climbing.
      try {
        const today = bangladeshDateKey(new Date());
        const [due, late, next30, periods] = await Promise.all([
          ensureDosesForDay(db, today),
          missedDoses(db, 2),
          upcomingHealth(db, bn ? 'bn' : 'en', 30),
          medicalSpendPeriods(db),
        ]);
        setDoses(due); setMissed(late); setAhead(next30); setSpend(periods);
      } catch {
        setDoses([]); setMissed([]); setAhead([]); setSpend(null);
      }
    } finally { setLoaded(true); }
  }, [db, bn]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openAdd = useCallback(async (metric: string) => {
    tapLight();
    setAdding(metric);
    setValue('');
    setGoal('');
    setTouched(false);
    try {
      const rows = await listMeasurements(db, { metric, subject: SELF, limit: 8 });
      setHistory(rows.map((row) => ({ at: row.at, value: row.value })));
    } catch { setHistory([]); }
  }, [db]);

  const save = useCallback(async () => {
    if (!adding || busy) return;
    const shape = metricShape(adding);
    const stored = toSmallestUnit(adding, value);
    if (!stored || !shape) {
      warn();
      showSnackbar(bn ? 'সংখ্যাটি বোঝা গেল না' : 'That number could not be read', 'danger');
      return;
    }
    setBusy(true);
    try {
      await recordMeasurement(db, { metric: adding, value: stored, unit: shape.unit, subject: SELF });
      // A goal is optional; setting one is what turns a list of readings into progress.
      const target = goal.trim() ? toSmallestUnit(adding, goal) : null;
      if (target) {
        await setTarget(db, {
          metric: adding, subject: SELF, target,
          direction: shape.better, unit: shape.unit,
        });
      }
      success();
      setAdding(null);
      await load();
    } catch {
      warn();
      showSnackbar(bn ? 'লেখা গেল না' : 'Could not save it', 'danger');
    } finally { setBusy(false); }
  }, [adding, busy, value, goal, db, bn, showSnackbar, load]);

  const untracked = METRICS.filter((shape) => !tracked.some((t) => t.metric === shape.metric));

  return (
    <>
    <ScrollView keyboardDismissMode="on-drag" style={s.root} contentContainerStyle={withFabRoom(s.content)} keyboardShouldPersistTaps="handled">
      <ScreenHeader
        title={bn ? 'স্বাস্থ্য' : 'Health'}
        subtitle={bn ? 'ওষুধ, ডাক্তার, পরীক্ষা আর শরীরের মাপ' : 'Medicines, doctors, tests and body readings'}
        backTo="/"
        backLabel={bn ? 'হোম' : 'Home'}
        onBack={() => guard.attemptLeave(() => router.dismissTo('/' as never))}
        right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ModuleGuide id="health" /><ModuleSettingsLink moduleId="health" /></View>}
      />

      {!loaded ? <View style={s.loadingRow}><ActivityIndicator color={colors.primary} /></View> : null}

      {/* ── আজকের ওষুধ ────────────────────────────────────────────────────────
          The first thing on the screen, because it is the only thing here with a
          deadline. Three taps answer it — খেয়েছি, বাদ, পরে — and each one is 44pt,
          because this gets tapped in a hurry with one hand. */}
      {doses.length || missed.length ? (
        <Card title={bn ? 'আজকের ওষুধ' : "Today's medicine"}>
          {missed.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={bn ? 'বাদ পড়া ডোজ' : 'Missed doses'}
              onPress={() => { tapLight(); router.push('/health/medicines' as never); }}
              style={({ pressed }) => StyleSheet.flatten([s.missedNote, { backgroundColor: accents.red.soft }, pressed && s.pressed])}
            >
              <AppIcon name="alert-circle-outline" size={iconSize.sm} color={accents.red.on} />
              <Text numberOfLines={1} style={[s.missedText, { color: accents.red.on }]}>
                {bn ? `${bnNum(missed.length)}টি ডোজ বাদ পড়েছে` : `${missed.length} doses were missed`}
              </Text>
            </Pressable>
          ) : null}
          {!doses.length ? (
            <Text style={s.hubMuted}>{bn ? 'আজ কোনো ডোজ নেই।' : 'Nothing due today.'}</Text>
          ) : doses.map((dose) => (
            <View key={dose.id} style={s.doseRow}>
              <View style={s.doseCopy}>
                <Text numberOfLines={1} style={s.doseName}>{dose.medicineName}</Text>
                <Text numberOfLines={1} style={s.doseTime}>{formatBangladeshTime(dose.dueAt, bn ? 'bn' : 'en')}</Text>
              </View>
              <View style={s.doseBtns}>
                {([
                  { key: 'TAKEN' as const, icon: 'check', label: bn ? 'খেয়েছি' : 'Taken', tone: accents.green },
                  { key: 'SKIPPED' as const, icon: 'close', label: bn ? 'বাদ' : 'Skip', tone: accents.orange },
                  { key: 'SNOOZED' as const, icon: 'clock-outline', label: bn ? 'পরে' : 'Later', tone: accents.blue },
                ]).map((btn) => (
                  <Pressable
                    key={btn.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${dose.medicineName}: ${btn.label}`}
                    accessibilityState={{ selected: dose.status === btn.key }}
                    onPress={() => void (async () => { tapLight(); await setDoseStatus(db, dose.id, btn.key); await load(); })()}
                    style={({ pressed }) => StyleSheet.flatten([
                      s.doseBtn,
                      dose.status === btn.key && { backgroundColor: btn.tone.soft, borderColor: btn.tone.base },
                      pressed && s.pressed,
                    ])}
                  >
                    <AppIcon name={btn.icon as never} size={iconSize.sm} color={dose.status === btn.key ? btn.tone.on : colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {/* ── সামনে যা আছে ──────────────────────────────────────────────────── */}
      {ahead.length ? (
        <Card title={bn ? 'সামনে যা আছে' : 'What is coming'}>
          {ahead.slice(0, 6).map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              onPress={() => { tapLight(); router.push(item.route as never); }}
              style={({ pressed }) => StyleSheet.flatten([s.aheadRow, pressed && s.pressed])}
            >
              <AppIcon
                name={(item.kind === 'REFILL' ? 'pill' : item.kind === 'FOLLOW_UP' ? 'stethoscope' : item.kind === 'REPEAT_TEST' ? 'test-tube' : 'calendar-check') as never}
                size={iconSize.sm}
                color={item.kind === 'REFILL' ? accents.orange.on : colors.textSecondary}
              />
              <Text numberOfLines={1} style={s.aheadTitle}>{item.title}</Text>
              {/* "২৮ সেপ্টেম্বর", not the raw "০৯-২৮" (rc.7 screenshots). The year is dropped: it is always within a month. */}
              <Text numberOfLines={1} style={s.aheadDay}>{formatDayKey(item.dayKey, bn ? 'bn' : 'en').replace(/,?\s*[\d০-৯]{4}$/u, '')}</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {/* ── চিকিৎসার খরচ ──────────────────────────────────────────────────────
          Read from the money book, never stored here — which is why tapping it opens
          the medical view of the same ledger rather than a second set of numbers. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bn ? 'চিকিৎসার খরচ' : 'Medical spending'}
        onPress={() => { tapLight(); router.push('/health/expenses' as never); }}
        style={({ pressed }) => StyleSheet.flatten([s.spendCard, { backgroundColor: accents.red.soft }, pressed && s.pressed])}
      >
        <View style={s.spendCopy}>
          <Text style={[s.spendLabel, { color: accents.red.on }]}>{bn ? 'এই মাসে চিকিৎসায়' : 'Medical this month'}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[s.spendValue, { color: accents.red.on }]}>
            {formatPaisa(spend?.monthPaisa ?? 0, { bnDigits: bn })}
          </Text>
          <Text numberOfLines={1} style={s.spendHint}>
            {bn ? 'আয়-ব্যয়ের ভেতরেই — আলাদা করে গোনা হয় না' : 'Inside the money book, not counted twice'}
          </Text>
        </View>
        <AppIcon name="chevron-right" size={iconSize.md} color={accents.red.on} />
      </Pressable>

      {/* ── এই মডিউলের বাকি অংশ ───────────────────────────────────────────── */}
      <View style={s.tiles}>
        {([
          { to: '/health/medicines', icon: 'pill', bnL: 'ওষুধ', enL: 'Medicines' },
          { to: '/health/visits', icon: 'stethoscope', bnL: 'ডাক্তার', enL: 'Doctors' },
          { to: '/health/tests', icon: 'test-tube', bnL: 'পরীক্ষা', enL: 'Tests' },
          { to: '/health/prescriptions', icon: 'file-document-outline', bnL: 'প্রেসক্রিপশন', enL: 'Prescriptions' },
          { to: '/health/expenses', icon: 'medical-bag', bnL: 'খরচ', enL: 'Spending' },
          { to: '/health/history', icon: 'history', bnL: 'ইতিহাস', enL: 'History' },
        ]).map((tile) => (
          <Pressable
            key={tile.to}
            accessibilityRole="button"
            accessibilityLabel={bn ? tile.bnL : tile.enL}
            onPress={() => { tapLight(); router.push(tile.to as never); }}
            style={({ pressed }) => StyleSheet.flatten([s.tile, pressed && s.pressed])}
          >
            <AppIcon name={tile.icon as never} size={iconSize.md} color={colors.primary} />
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={s.tileText}>
              {bn ? tile.bnL : tile.enL}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={s.sectionHeading}>{bn ? 'শরীরের মাপ' : 'Body readings'}</Text>

      {tracked.map(({ metric, count }) => {
        const shape = metricShape(metric);
        const state = states[metric] ?? null;
        const tone = state?.trend === 'IMPROVING' ? accents.green
          : state?.trend === 'DECLINING' ? accents.orange
          : accents.blue;
        return (
          <Pressable
            key={metric}
            accessibilityRole="button"
            accessibilityLabel={shape ? (bn ? shape.bn : shape.en) : metric}
            onPress={() => void openAdd(metric)}
            style={({ pressed }) => StyleSheet.flatten([s.card, pressed && s.pressed])}
          >
            <View style={s.cardTop}>
              <View style={[s.cardIcon, { backgroundColor: tone.soft }]}>
                <AppIcon name="heart-pulse" size={iconSize.sm} color={tone.on} />
              </View>
              <View style={s.grow}>
                <Text numberOfLines={1} style={s.cardTitle}>{shape ? (bn ? shape.bn : shape.en) : metric}</Text>
                <Text numberOfLines={1} style={s.cardMeta}>
                  {bn ? `${digits(count)}টি রেকর্ড` : `${bnNum(count)} readings`}
                </Text>
              </View>
              <Text numberOfLines={1} style={[s.cardValue, { color: tone.on }]}>
                {state && shape ? shape.say(state.currentValue, bn) : '—'}
              </Text>
            </View>

            {state ? (
              <>
                {state.pct !== null ? (
                  <View style={s.barRow}>
                    <Bar pct={Math.min(100, Math.max(0, state.pct))} tone={tone} />
                  </View>
                ) : null}
                <Text numberOfLines={2} style={s.cardNote}>
                  {state.trend === 'IMPROVING'
                    ? (bn ? 'ভালোর দিকে যাচ্ছে' : 'moving the right way')
                    : state.trend === 'DECLINING'
                      ? (bn ? 'খারাপের দিকে যাচ্ছে — একটু নজর দিন' : 'moving the wrong way — worth a look')
                      : (bn ? 'একই জায়গায় আছে' : 'holding steady')}
                  {state.targetValue && shape
                    ? (bn ? ` · লক্ষ্য ${shape.say(state.targetValue, true)}` : ` · target ${shape.say(state.targetValue, false)}`)
                    : ''}
                </Text>
              </>
            ) : null}
          </Pressable>
        );
      })}

      {untracked.length ? (
        <Card title={tracked.length ? (bn ? 'আরও কিছু রাখুন' : 'Track something else') : (bn ? 'কী রাখতে চান' : 'What would you like to track')}>
          <View style={s.chips}>
            {untracked.map((shape) => (
              <Chip
                key={shape.metric}
                label={bn ? shape.bn : shape.en}
                active={adding === shape.metric}
                onPress={() => void openAdd(shape.metric)}
              />
            ))}
          </View>
        </Card>
      ) : null}

      {!tracked.length && !adding ? (
        <EmptyNote
          icon="heart-pulse"
          text={bn
            ? 'এখনো কিছু রাখা হয়নি। উপর থেকে একটা বেছে নিন — একটা সংখ্যা লিখলেই শুরু।'
            : 'Nothing tracked yet. Pick one above; a single reading is enough to begin.'}
        />
      ) : null}

      {adding ? (
        <Card title={bn ? `${metricShape(adding)?.bn ?? adding} লিখুন` : `Record ${metricShape(adding)?.en ?? adding}`}>
          <Field
            label={bn ? 'এখনকার মাপ' : 'The reading now'}
            value={value}
            onChangeText={edited(setValue)}
            keyboardType="numeric"
            autoFocus
            hint={inputHint(adding, bn)}
          />
          <Field
            label={bn ? 'লক্ষ্য — ঐচ্ছিক' : 'Target — optional'}
            value={goal}
            onChangeText={edited(setGoal)}
            keyboardType="numeric"
            hint={bn
              ? 'লক্ষ্য দিলে অ্যাপ বলতে পারবে কতটা এগোলেন। না দিলেও রেকর্ড থাকবে।'
              : 'With a target the app can say how far along you are. Without one the reading is still kept.'}
          />
          {history.length ? (
            <Text style={s.history}>
              {bn ? 'আগের মাপ: ' : 'Earlier: '}
              {history.slice(0, 4).map((row) => {
                const shape = metricShape(adding);
                return shape ? shape.say(row.value, bn) : String(row.value);
              }).join(' · ')}
            </Text>
          ) : null}
          <FormBar
            onCancel={() => guard.attemptLeave(() => setAdding(null))}
            onSave={() => void save()}
            saving={busy}
            saveLabel={bn ? 'লিখুন' : 'Record'}
          />
        </Card>
      ) : null}

      {tracked.length ? (
        <Text style={s.footnote}>
          {bn
            ? 'সব মাপ এই ফোনেই থাকে, আর কোথাও যায় না। এগুলো চিকিৎসকের পরামর্শের বিকল্প নয় — শুধু আপনার নিজের হিসাব।'
            : 'Every reading stays on this phone. This is a record, not medical advice.'}
        </Text>
      ) : null}
    </ScrollView>
    <AppConfirmDialog
      visible={guard.confirming}
      title={bn ? 'পরিবর্তন বাতিল করবেন?' : 'Discard your changes?'}
      description={bn ? 'যা লিখেছেন তা সংরক্ষণ হয়নি।' : 'What you typed has not been saved.'}
      confirmLabel={bn ? 'বাতিল করুন' : 'Discard'}
      cancelLabel={bn ? 'লিখতে থাকি' : 'Keep editing'}
      danger
      icon="alert"
      onConfirm={() => { guard.setConfirming(false); setAdding(null); }}
      onCancel={() => guard.setConfirming(false)}
    />
    </>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs },
    loadingRow: { paddingVertical: spacing.xl, alignItems: 'center' },
    grow: { flex: 1, minWidth: 0 },
    card: { borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.xs },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    cardTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    cardMeta: { color: colors.textMuted, ...typography.caption, marginTop: 1 },
    cardValue: { ...typography.callout, fontWeight: '800', flexShrink: 1 },
    barRow: { marginTop: spacing.sm },
    cardNote: { color: colors.textSecondary, ...typography.caption, marginTop: spacing.xs, lineHeight: 17 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    history: { color: colors.textMuted, ...typography.caption, marginTop: spacing.xs },
    footnote: { color: colors.textMuted, ...typography.caption, marginTop: spacing.md, lineHeight: 17, textAlign: 'center' },
    // The hub's own furniture. Same tokens as every other module — spacing, radius and
    // typography come from the shared scale, so a health card and a debt card are the
    // same object wearing a different colour.
    missedNote: {
      minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      paddingHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm,
    },
    missedText: { ...typography.meta, fontWeight: '800' },
    hubMuted: { color: colors.textMuted, ...typography.meta },
    doseRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm,
      borderTopWidth: border.thin, borderTopColor: colors.border, paddingTop: spacing.sm,
    },
    doseCopy: { flex: 1, minWidth: 0 },
    doseName: { color: colors.textPrimary, ...typography.meta, fontWeight: '800' },
    doseTime: { color: colors.textMuted, ...typography.caption, marginTop: 2 },
    doseBtns: { flexDirection: 'row', gap: spacing.xs },
    doseBtn: {
      width: 46, minHeight: 44, alignItems: 'center', justifyContent: 'center',
      borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    aheadRow: {
      minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      borderTopWidth: border.thin, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm,
    },
    aheadTitle: { flex: 1, color: colors.textPrimary, ...typography.meta, fontWeight: '700' },
    aheadDay: { color: colors.textMuted, ...typography.caption, fontWeight: '800' },
    spendCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.sm,
    },
    spendCopy: { flex: 1, minWidth: 0, gap: 2 },
    spendLabel: { ...typography.caption, fontWeight: '800' },
    spendValue: { ...typography.display, fontWeight: '800' },
    spendHint: { color: colors.textSecondary, ...typography.caption },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.sm, rowGap: spacing.sm, marginTop: spacing.sm },
    tile: {
      flexBasis: '31.5%', maxWidth: '31.5%', minHeight: 92, alignItems: 'center', justifyContent: 'center',
      gap: spacing.xs, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border,
      backgroundColor: colors.surface, paddingHorizontal: spacing.xs,
    },
    tileText: { color: colors.textPrimary, ...typography.caption, fontWeight: '800', textAlign: 'center' },
    sectionHeading: {
      color: colors.textMuted, ...typography.section, fontWeight: '800',
      letterSpacing: 1.2, marginTop: spacing.lg, marginBottom: spacing.xs,
    },
    pressed: { opacity: 0.78 },
  });
}
