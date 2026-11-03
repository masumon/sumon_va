// One medicine, in full — the schedule, what is left in the box, and today's doses.
//
// The stock bar is the point of the screen. "How many are left" is arithmetic nobody
// wants to do at a pharmacy counter, and it is only trustworthy because a dose marked
// taken is what moves it — skipping does not consume a tablet, so the date the box runs
// out stays honest even for someone who forgets half their doses.

import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../../../src/ui/AppText';
import { AppIcon } from '../../../src/ui/AppIcon';
import { Bar, Card, Field, FormBar, ScreenHeader, Stat, useKit } from '../../../src/ui/AppKit';
import { formatClock, partOfDay } from '../../../src/i18n/clock';
import { AppConfirmDialog, useAppFeedback } from '../../../src/ui/AppFeedback';
import { useUnsavedGuard } from '../../../src/hooks/useUnsavedGuard';
import { atomic } from '../../../src/database/atomic';
import { asciiDigitsToBengali, bengaliDigitsToAscii, formatPaisa, parseTakaToPaisa } from '../../../src/services/debt/money';
import { bangladeshDateKey, formatBangladeshTime, formatDayKey } from '../../../src/i18n/date-time';
import {
  archiveMedicine, deleteMedicine, ensureDosesForDay, getMedicine, medicineStock,
  updateMedicine, setDoseStatus, type Dose, type Medicine,
} from '../../../src/services/health-service';
import { getEntry, type FinanceEntry, type FundSource } from '../../../src/services/finance-service';
import { listWallets, type Wallet } from '../../../src/services/wallet-service';
import { border, icon as iconSize, radius, spacing, typography, type ThemeColors } from '../../../src/theme';
import { success, tapLight, warn } from '../../../src/ui/haptics';
import { FundSourcePicker, WalletPicker, moneyDetailsProblem } from '../../../src/ui/MoneyPickers';
import { logAppError } from '../../../src/services/error-log';

export default function MedicineDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { colors, accents, bn, timeFormat } = useKit();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { showSnackbar } = useAppFeedback();

  const [medicine, setMedicine] = useState<Medicine | null>(null);
  // F-081: `!medicine` alone can't tell "hasn't loaded yet" from "genuinely doesn't exist" —
  // every open of this screen showed "That medicine is gone" for one frame before the real
  // data arrived. `loaded` only flips once, after the first load settles either way.
  const [loaded, setLoaded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [entry, setEntry] = useState<FinanceEntry | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [refill, setRefill] = useState(false);
  const [addUnits, setAddUnits] = useState('');
  const [addCost, setAddCost] = useState('');
  const [walletId, setWalletId] = useState<string | null>(null);
  // With a cost, whose money paid it (the user's rule: every expense names its source).
  const [fundSource, setFundSource] = useState<FundSource | null>(null);
  const [fundAccountId, setFundAccountId] = useState<string | null>(null);
  const [fundNote, setFundNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  // `saving` is state, so two taps in one frame both read it false; the ref does not.
  const savingRef = useRef(false);
  const guard = useUnsavedGuard(refill && touched && !saving);
  const edited = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setTouched(true); };

  const money = useCallback((p: number) => formatPaisa(p, { bnDigits: bn }), [bn]);
  const digits = useCallback((v: string | number) => (bn ? asciiDigitsToBengali(String(v)) : String(v)), [bn]);

  const load = useCallback(async () => {
    // No id means nothing to load — show the not-found state instead of spinning forever.
    if (!id) { setLoaded(true); return; }
    try {
      const m = await getMedicine(db, id);
      setMedicine(m);
      if (!m) return;
      const today = bangladeshDateKey(new Date());
      const [all, ws] = await Promise.all([ensureDosesForDay(db, today), listWallets(db)]);
      setDoses(all.filter((d) => d.medicineId === id));
      setWallets(ws);
      setEntry(m.purchaseEntryId ? await getEntry(db, m.purchaseEntryId) : null);
    } finally {
      setLoaded(true);
    }
  }, [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!medicine) {
    if (!loaded) {
      return (
        <View style={[s.root, s.centerFill]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    return (
      <View style={s.root}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={s.content}>
          <ScreenHeader title={bn ? 'ওষুধ' : 'Medicine'} backTo="/health/medicines" backLabel={bn ? 'ওষুধ' : 'Medicines'} />
          <Text style={s.muted}>{bn ? 'ওষুধটি পাওয়া যায়নি।' : 'That medicine is gone.'}</Text>
        </ScrollView>
      </View>
    );
  }

  const stock = medicineStock(medicine);
  const usedPct = medicine.totalUnits ? (medicine.usedUnits / medicine.totalUnits) * 100 : 0;
  const tone = stock.needsRefill ? accents.orange : accents.green;

  const act = async (dose: Dose, status: Dose['status']) => {
    tapLight();
    await setDoseStatus(db, dose.id, status);
    await load();
  };

  const buyMore = async () => {
    if (saving || savingRef.current) return;
    const units = Number(addUnits) || 0;
    if (!units) { warn(); showSnackbar(bn ? 'কতটি কিনেছেন লিখুন' : 'How many did you buy?', 'danger'); return; }
    if (addCost.trim()) {
      const problem = moneyDetailsProblem({ walletId, needsSource: true, fundSource }, bn);
      if (problem) { warn(); showSnackbar(problem, 'danger'); return; }
    }
    savingRef.current = true;
    setSaving(true);
    try {
      // A refill is a new box on top of the old one, and a brand-new expense row — the
      // first purchase's row is left exactly as it was, because that money was spent on
      // a different day and belongs to a different month.
      //
      // The units and the expense are one decision: as two commits, a failed expense after
      // the units landed made the retry add the units a second time.
      const costPaisa = addCost.trim() ? parseTakaToPaisa(addCost) : 0;
      const { syncCostEntry, MEDICINE_CATEGORY } = await import('../../../src/services/health-service');
      await atomic(db, async () => {
        await updateMedicine(db, medicine.id, { totalUnits: medicine.totalUnits + units });
        if (addCost.trim()) {
          await syncCostEntry(db, {
            entryId: null,
            amountPaisa: costPaisa,
            category: MEDICINE_CATEGORY,
            occurredOn: bangladeshDateKey(new Date()),
            walletId,
            fundSource, fundAccountId: fundSource === 'LOAN' ? fundAccountId : null, fundNote: fundSource === 'OTHER' ? fundNote : null,
            note: `${medicine.name}${medicine.pharmacy ? ` · ${medicine.pharmacy}` : ''}`,
          });
        }
      });
      success();
      showSnackbar(bn ? 'যোগ হয়েছে' : 'Added', 'success');
      setRefill(false); setAddUnits(''); setAddCost(''); setWalletId(null); setFundSource(null); setFundAccountId(null); setFundNote(''); setTouched(false);
      await load();
    } catch (e) {
      warn();
      showSnackbar(logAppError('health/medicine/id', e, bn ? 'যোগ হয়নি' : 'Could not add'), 'danger');
    } finally { savingRef.current = false; setSaving(false); }
  };

  const confirmRemove = async () => {
    setConfirmDelete(false);
    try {
      await deleteMedicine(db, medicine.id);
      showSnackbar(bn ? 'মুছে ফেলা হয়েছে' : 'Deleted', 'info');
      router.replace('/health/medicines' as never);
    } catch {
      warn();
      showSnackbar(bn ? 'মুছে ফেলা যায়নি' : 'Could not delete that', 'danger');
    }
  };

  const foodLabel = bn
    ? { BEFORE: 'খাবারের আগে', AFTER: 'খাবারের পরে', WITH: 'খাবারের সঙ্গে', ANY: 'যেকোনো সময়' }[medicine.food]
    : { BEFORE: 'Before food', AFTER: 'After food', WITH: 'With food', ANY: 'Any time' }[medicine.food];

  return (
    <View style={s.root}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title={medicine.name}
          subtitle={[medicine.reason, medicine.doctor].filter(Boolean).join(' · ') || (bn ? 'ওষুধ' : 'Medicine')}
          backTo="/health/medicines"
          backLabel={bn ? 'ওষুধ' : 'Medicines'}
          onBack={() => guard.attemptLeave(() => router.dismissTo('/health/medicines' as never))}
        />

        {/* What is left, and when it runs out. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bn ? 'আরও কিনুন' : 'Buy more'}
          onPress={() => { tapLight(); setRefill((v) => !v); }}
          style={({ pressed }) => StyleSheet.flatten([s.hero, { backgroundColor: tone.soft }, pressed && s.pressed])}
        >
          <Text style={[s.heroLabel, { color: tone.on }]}>
            {medicine.totalUnits ? (bn ? 'বাকি আছে' : 'Left in the box') : (bn ? 'সংখ্যা লেখা নেই' : 'No count kept')}
          </Text>
          <Text numberOfLines={1} style={[s.heroValue, { color: tone.on }]}>
            {medicine.totalUnits ? `${digits(stock.remainingUnits)}${bn ? 'টি' : ''}` : '—'}
          </Text>
          {medicine.totalUnits ? <Bar pct={100 - usedPct} tone={tone} /> : null}
          {stock.daysLeft !== null ? (
            <Text style={s.heroHint}>
              {stock.needsRefill
                ? (bn ? `আর ${digits(stock.daysLeft)} দিন — কিনে রাখুন` : `${stock.daysLeft} days left — buy more`)
                : (bn ? `আর ${digits(stock.daysLeft)} দিন চলবে` : `Enough for ${stock.daysLeft} more days`)}
            </Text>
          ) : null}
        </Pressable>

        {refill ? (
          <Card title={bn ? 'আরও কিনেছেন' : 'Bought more'}>
            <Field label={bn ? 'কতটি' : 'How many'} value={addUnits} onChangeText={(t) => { setAddUnits(bengaliDigitsToAscii(t)); setTouched(true); }} keyboardType="numeric" autoFocus />
            <Field
              label={bn ? 'কত টাকায়' : 'What it cost'} value={addCost} onChangeText={edited(setAddCost)} keyboardType="numeric"
              hint={bn ? 'নতুন একটি খরচ হিসেবে আয়-ব্যয়ে যাবে' : 'Goes to the money book as a new expense'}
            />
            {addCost.trim() ? (
              <>
                <WalletPicker
                  label={bn ? 'কোন মানিব্যাগ থেকে' : 'From which wallet'}
                  value={walletId}
                  onChange={(next) => { setWalletId(next); setTouched(true); }}
                  wallets={wallets}
                  onWalletsChange={setWallets}
                />
                <FundSourcePicker
                  value={fundSource}
                  onChange={(next) => { setFundSource(next); setTouched(true); }}
                  note={fundNote} onNoteChange={setFundNote} loanAccountId={fundAccountId}
                  onLoanAccountChange={setFundAccountId}
                />
              </>
            ) : null}
            <FormBar onCancel={() => guard.attemptLeave(() => { setRefill(false); setTouched(false); })} onSave={() => void buyMore()} saving={saving} />
          </Card>
        ) : null}

        {/* Today's doses — the only thing on this screen that is asking to be tapped. */}
        <Card title={bn ? 'আজকের ডোজ' : "Today's doses"}>
          {!doses.length ? (
            <Text style={s.muted}>{bn ? 'আজ কোনো ডোজ নেই।' : 'Nothing due today.'}</Text>
          ) : doses.map((dose) => (
            <View key={dose.id} style={s.doseRow}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={s.doseTime}>{formatBangladeshTime(dose.dueAt, bn ? 'bn' : 'en')}</Text>
              <View style={s.doseBtns}>
                {([
                  { key: 'TAKEN' as const, icon: 'check', label: bn ? 'খেয়েছি' : 'Taken', tone: accents.green },
                  { key: 'SKIPPED' as const, icon: 'close', label: bn ? 'বাদ' : 'Skip', tone: accents.orange },
                  { key: 'SNOOZED' as const, icon: 'clock-outline', label: bn ? 'পরে' : 'Later', tone: accents.blue },
                ]).map((btn) => (
                  <Pressable
                    key={btn.key}
                    accessibilityRole="button"
                    accessibilityLabel={btn.label}
                    accessibilityState={{ selected: dose.status === btn.key }}
                    onPress={() => void act(dose, btn.key)}
                    style={({ pressed }) => StyleSheet.flatten([
                      s.doseBtn,
                      dose.status === btn.key && { backgroundColor: btn.tone.soft, borderColor: btn.tone.base },
                      pressed && s.pressed,
                    ])}
                  >
                    <AppIcon name={btn.icon as never} size={iconSize.sm} color={dose.status === btn.key ? btn.tone.on : colors.textMuted} />
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[s.doseBtnText, dose.status === btn.key && { color: btn.tone.on }]}>{btn.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </Card>

        {/* The prescription, in words. */}
        <Card title={bn ? 'কীভাবে খাবেন' : 'How to take it'}>
          <Stat label={bn ? 'ডোজ' : 'Dose'} value={medicine.doseText || `${digits(medicine.perDose)}${bn ? 'টি' : ''}`} />
          <Stat label={bn ? 'দিনে কতবার' : 'Times a day'} value={digits(medicine.timesPerDay)} />
          <Stat label={bn ? 'সময়' : 'Times'} value={medicine.times.map((t) => `${partOfDay(t.atTime, bn)} ${formatClock(t.atTime, bn, timeFormat)}`).join(', ') || '—'} />
          <Stat label={bn ? 'খাবারের' : 'Food'} value={foodLabel} />
          {medicine.startDate ? <Stat label={bn ? 'শুরু' : 'Started'} value={formatDayKey(medicine.startDate, bn ? 'bn' : 'en')} /> : null}
          {medicine.endDate ? <Stat label={bn ? 'শেষ' : 'Ends'} value={formatDayKey(medicine.endDate, bn ? 'bn' : 'en')} /> : null}
          {medicine.durationDays ? <Stat label={bn ? 'কতদিন' : 'Duration'} value={`${digits(medicine.durationDays)}${bn ? ' দিন' : ' days'}`} /> : null}
          {medicine.pharmacy ? <Stat label={bn ? 'ফার্মেসি' : 'Pharmacy'} value={medicine.pharmacy} /> : null}
          {medicine.note ? <Text style={s.note}>{medicine.note}</Text> : null}
        </Card>

        {/* The money, shown as a link into the ledger rather than as a number of its own. */}
        {entry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'খরচটি আয়-ব্যয়ে দেখুন' : 'See this cost in the money book'}
            onPress={() => { tapLight(); router.push(`/finance/entry/${entry.id}` as never); }}
            style={({ pressed }) => StyleSheet.flatten([s.costRow, pressed && s.pressed])}
          >
            <AppIcon name="cash" size={iconSize.md} color={colors.primary} />
            <View style={s.rowCopy}>
              <Text numberOfLines={1} style={s.costTitle}>{bn ? 'কেনার খরচ' : 'Purchase cost'}</Text>
              <Text numberOfLines={1} style={s.costMeta}>
                {bn ? 'আয়-ব্যয়ের "ওষুধ" খাতে — এখানে আলাদা করে গোনা হয় না' : 'In the money book under ওষুধ — not counted again here'}
              </Text>
            </View>
            <Text numberOfLines={1} style={s.costValue}>{money(entry.amountPaisa)}</Text>
          </Pressable>
        ) : null}

        <View style={s.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => { tapLight(); router.push({ pathname: '/health/medicines' as never, params: { id: medicine.id } }); }}
            style={({ pressed }) => StyleSheet.flatten([s.secondary, pressed && s.pressed])}
          >
            <Text numberOfLines={1} style={s.secondaryText}>{bn ? 'সম্পাদনা' : 'Edit'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void (async () => {
              tapLight();
              await archiveMedicine(db, medicine.id, !medicine.archivedAt);
              await load();
            })()}
            style={({ pressed }) => StyleSheet.flatten([s.secondary, pressed && s.pressed])}
          >
            <Text numberOfLines={1} style={s.secondaryText}>
              {medicine.archivedAt ? (bn ? 'আবার চালু করুন' : 'Start again') : (bn ? 'কোর্স শেষ' : 'Course finished')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirmDelete(true)}
            style={({ pressed }) => StyleSheet.flatten([s.danger, pressed && s.pressed])}
          >
            <Text numberOfLines={1} style={s.dangerText}>{bn ? 'মুছুন' : 'Delete'}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <AppConfirmDialog
        visible={guard.confirming}
        title={bn ? 'পরিবর্তন বাতিল করবেন?' : 'Discard your changes?'}
        description={bn ? 'যা লিখেছেন তা সংরক্ষণ হয়নি।' : 'What you typed has not been saved.'}
        confirmLabel={bn ? 'বাতিল করুন' : 'Discard'}
        cancelLabel={bn ? 'লিখতে থাকি' : 'Keep editing'}
        danger
        icon="alert"
        onConfirm={() => { guard.setConfirming(false); setRefill(false); setTouched(false); }}
        onCancel={() => guard.setConfirming(false)}
      />

      <AppConfirmDialog
        visible={confirmDelete}
        title={bn ? 'ওষুধটি মুছবেন?' : 'Delete this medicine?'}
        description={bn ? 'কেনার খরচও আয়-ব্যয় থেকে সরে যাবে।' : 'The purchase cost will leave the money book too.'}
        confirmLabel={bn ? 'মুছুন' : 'Delete'}
        cancelLabel={bn ? 'থাক' : 'Cancel'}
        danger
        icon="alert"
        onConfirm={() => void confirmRemove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    centerFill: { alignItems: 'center', justifyContent: 'center' },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
    hero: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
    heroLabel: { ...typography.caption, fontWeight: '800' },
    heroValue: { ...typography.display, fontWeight: '800' },
    heroHint: { color: colors.textSecondary, ...typography.caption, marginTop: spacing.xs },
    label: { color: colors.textMuted, ...typography.section, fontWeight: '800', marginTop: spacing.md, marginBottom: spacing.xs },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    doseRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm,
      borderTopWidth: border.thin, borderTopColor: colors.border, paddingTop: spacing.sm,
    },
    doseTime: { width: 76, color: colors.textPrimary, ...typography.meta, fontWeight: '800' },
    doseBtns: { flex: 1, flexDirection: 'row', gap: spacing.xs },
    doseBtn: {
      flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 4, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    doseBtnText: { color: colors.textMuted, ...typography.caption, fontWeight: '800' },
    note: { color: colors.textSecondary, ...typography.meta, marginTop: spacing.md, lineHeight: 20 },
    costRow: {
      minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border,
      borderRadius: radius.lg, padding: spacing.md,
    },
    rowCopy: { flex: 1, minWidth: 0 },
    costTitle: { color: colors.textPrimary, ...typography.meta, fontWeight: '800' },
    costMeta: { color: colors.textMuted, ...typography.caption, marginTop: 2 },
    costValue: { color: colors.textPrimary, ...typography.body, fontWeight: '800' },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    secondary: {
      flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md,
      borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface,
    },
    secondaryText: { color: colors.textPrimary, ...typography.meta, fontWeight: '800' },
    danger: {
      minWidth: 96, minHeight: 48, alignItems: 'center', justifyContent: 'center',
      borderRadius: radius.md, backgroundColor: colors.danger,
    },
    dangerText: { color: colors.onPrimary, ...typography.meta, fontWeight: '800' },
    muted: { color: colors.textMuted, ...typography.meta },
    pressed: { opacity: 0.7 },
  });
}
