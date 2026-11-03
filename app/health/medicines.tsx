// ওষুধ — what to take, when, how many are left, and what the box cost.
//
// List and form on one screen, the way every other "add a thing" screen in this app
// works. The money field is the interesting one: it does not store an amount here. It
// writes a single expense row in the money book under ওষুধ, exactly as if it had been
// typed on the money screen, and this medicine remembers its id. There is only ever one
// number, so the two can never disagree.

import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppPreferences } from '../../src/app/AppPreferences';
import { easeNextLayout } from '../../src/ui/motion';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../../src/ui/AppText';
import { AppIcon } from '../../src/ui/AppIcon';
import { Card, Chip, ChipGroup, EmptyNote, Field, FormBar, ScreenHeader, useKit } from '../../src/ui/AppKit';
import { AppDateField } from '../../src/ui/AppDateField';
import { AppTimeField } from '../../src/ui/AppTimeField';
import { formatClock } from '../../src/i18n/clock';
import { AppConfirmDialog, useAppFeedback } from '../../src/ui/AppFeedback';
import { useUnsavedGuard } from '../../src/hooks/useUnsavedGuard';
import { asciiDigitsToBengali, bengaliDigitsToAscii, paisaToTakaString, parseTakaToPaisa } from '../../src/services/debt/money';
import { bangladeshDateKey } from '../../src/i18n/date-time';
import {
  createMedicine, getMedicine, listMedicines, medicineStock, updateMedicine, type FoodTiming, type Medicine,
} from '../../src/services/health-service';
import { getEntry, type FundSource } from '../../src/services/finance-service';
import { listWallets, type Wallet } from '../../src/services/wallet-service';
import { border, control, icon as iconSize, radius, spacing, type ThemeColors, typography } from '../../src/theme';
import { success, tapLight, warn } from '../../src/ui/haptics';
import { FundSourcePicker, WalletPicker, moneyDetailsProblem } from '../../src/ui/MoneyPickers';
import { logAppError } from '../../src/services/error-log';

/**
 * The four times of day people actually name, and the clock time each *starts* at.
 *
 * The clock time is a default, not the definition: a slot is picked by name and its hour
 * is then the user's to move, because "সকাল" is 6am in one household and 9am in another
 * and a fixed 08:00 reminder is wrong in both. Only the name is stored as a label; the
 * hour travels with the dose row, so a moved time survives editing.
 */
const SLOTS: { key: string; at: string; bn: string; en: string }[] = [
  { key: 'MORNING', at: '08:00', bn: 'সকাল', en: 'Morning' },
  { key: 'NOON', at: '14:00', bn: 'দুপুর', en: 'Noon' },
  { key: 'EVENING', at: '18:00', bn: 'সন্ধ্যা', en: 'Evening' },
  { key: 'NIGHT', at: '21:00', bn: 'রাত', en: 'Night' },
];

const DEFAULT_SLOT_TIMES = Object.fromEntries(SLOTS.map((slot) => [slot.key, slot.at]));

/**
 * Work out which named slot each stored dose time belongs to.
 *
 * Matching used to be exact string equality against the four defaults, which was fine only
 * while the times could not be changed. Now that they can, a dose moved to 07:30 matched
 * nothing and silently reverted to the 08:00 default on the next edit. Each stored time is
 * claimed by the nearest unclaimed slot instead, nearest pair first, so four custom times
 * land on four distinct slots rather than piling onto whichever one they are all closest to.
 */
function slotsForTimes(times: { atTime: string }[]): { keys: string[]; at: Record<string, string> } {
  const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number) as [number, number]; return h * 60 + m; };
  const pairs = times.flatMap((t) => SLOTS.map((slot) => ({ slot: slot.key, at: t.atTime, gap: Math.abs(minutes(t.atTime) - minutes(slot.at)) })))
    .sort((a, b) => a.gap - b.gap);
  const at: Record<string, string> = {};
  const usedTimes = new Set<string>();
  for (const pair of pairs) {
    if (at[pair.slot] !== undefined || usedTimes.has(pair.at)) continue;
    at[pair.slot] = pair.at;
    usedTimes.add(pair.at);
  }
  return { keys: SLOTS.filter((slot) => at[slot.key] !== undefined).map((slot) => slot.key), at };
}

const FOODS: FoodTiming[] = ['BEFORE', 'AFTER', 'WITH', 'ANY'];

export default function MedicinesScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn, timeFormat } = useKit();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { showSnackbar } = useAppFeedback();
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = typeof params.id === 'string' ? params.id : null;

  const [items, setItems] = useState<Medicine[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [open, setOpenRaw] = useState(false);
  const { reduceMotion } = useAppPreferences();
  // UX-01: ease the in-page form open/closed, like other modules' form screens slide in.
  const setOpen = (value: boolean) => { easeNextLayout(reduceMotion); setOpenRaw(value); };
  const [saving, setSaving] = useState(false);
  // `saving` is state, so two taps in one frame both read it false; the ref does not.
  const savingRef = useRef(false);
  const [loadingEdit, setLoadingEdit] = useState(false);

  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [doctor, setDoctor] = useState('');
  const [doseText, setDoseText] = useState('');
  const [perDose, setPerDose] = useState('1');
  const [slots, setSlots] = useState<string[]>(['MORNING']);
  const [slotTimes, setSlotTimes] = useState<Record<string, string>>(DEFAULT_SLOT_TIMES);
  const [food, setFood] = useState<FoodTiming | null>('AFTER');
  const [startDate, setStartDate] = useState<string | null>(bangladeshDateKey(new Date()));
  const [days, setDays] = useState('');
  const [totalUnits, setTotalUnits] = useState('');
  const [pharmacy, setPharmacy] = useState('');
  const [cost, setCost] = useState('');
  const [walletId, setWalletId] = useState<string | null>(null);
  // With a cost, whose money paid it (the user's rule: every expense names its source).
  const [fundSource, setFundSource] = useState<FundSource | null>(null);
  const [fundAccountId, setFundAccountId] = useState<string | null>(null);
  const [fundNote, setFundNote] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const guard = useUnsavedGuard(open && touched && !saving);
  const edited = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setTouched(true); };

  const digits = useCallback((v: string | number) => (bn ? asciiDigitsToBengali(String(v)) : String(v)), [bn]);

  const load = useCallback(async () => {
    const [list, ws] = await Promise.all([listMedicines(db, { includeArchived: true }), listWallets(db)]);
    setItems(list);
    setWallets(ws);
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Opened from a medicine's own screen with its id: the dose, the schedule, and
  // everything else about it used to be fixed the moment it was created — the only way to
  // change a mistyped dose or a schedule that turned out wrong was to delete the medicine
  // (losing its whole dose history) and add it again from scratch.
  useFocusEffect(useCallback(() => {
    if (!editingId) return;
    let cancelled = false;
    setLoadingEdit(true);
    (async () => {
      const medicine = await getMedicine(db, editingId);
      if (cancelled || !medicine) return;
      setName(medicine.name);
      setReason(medicine.reason ?? '');
      setDoctor(medicine.doctor ?? '');
      setDoseText(medicine.doseText ?? '');
      setPerDose(String(medicine.perDose));
      const matched = slotsForTimes(medicine.times);
      setSlots(matched.keys.length ? matched.keys : ['MORNING']);
      setSlotTimes({ ...DEFAULT_SLOT_TIMES, ...matched.at });
      setFood(medicine.food);
      setStartDate(medicine.startDate);
      setDays(medicine.durationDays ? String(medicine.durationDays) : '');
      setTotalUnits(medicine.totalUnits ? String(medicine.totalUnits) : '');
      setPharmacy(medicine.pharmacy ?? '');
      setNote(medicine.note ?? '');
      if (medicine.purchaseEntryId) {
        const entry = await getEntry(db, medicine.purchaseEntryId).catch(() => null);
        if (!cancelled && entry) {
          setCost(paisaToTakaString(entry.amountPaisa));
          setWalletId(entry.walletId);
          setFundSource(entry.fundSource);
          setFundAccountId(entry.fundAccountId);
          setFundNote(entry.fundNote ?? '');
        }
      }
      if (!cancelled) { setOpenRaw(true); setLoadingEdit(false); }
    })();
    return () => { cancelled = true; };
  }, [db, editingId]));

  const reset = () => {
    setName(''); setReason(''); setDoctor(''); setDoseText(''); setPerDose('1');
    setSlots(['MORNING']); setSlotTimes(DEFAULT_SLOT_TIMES); setFood('AFTER'); setStartDate(bangladeshDateKey(new Date()));
    setDays(''); setTotalUnits(''); setPharmacy(''); setCost(''); setWalletId(null); setFundSource(null); setFundAccountId(null); setFundNote(''); setNote(''); setTouched(false);
  };
  const closeForm = () => { if (editingId) router.back(); else { setOpen(false); reset(); } };

  const toggleSlot = (key: string) => {
    tapLight(); setTouched(true);
    setSlots((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
  };

  const save = async () => {
    if (saving || savingRef.current) return;
    if (!name.trim()) { warn(); showSnackbar(bn ? 'ওষুধের নাম দিন' : 'Give the medicine a name', 'danger'); return; }
    if (!slots.length) { warn(); showSnackbar(bn ? 'কখন খাবেন বেছে নিন' : 'Pick when to take it', 'danger'); return; }
    if (cost.trim()) {
      const problem = moneyDetailsProblem({ walletId, needsSource: true, fundSource }, bn);
      if (problem) { warn(); showSnackbar(problem, 'danger'); return; }
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const chosen = SLOTS.filter((slot) => slots.includes(slot.key));
      const durationDays = days.trim() ? Number(days.trim()) : null;
      const endDate = durationDays && startDate
        ? (() => { const d = new Date(`${startDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + durationDays - 1); return d.toISOString().slice(0, 10); })()
        : null;
      const payload = {
        name, reason, doctor, doseText,
        perDose: Number(perDose) || 1,
        food: food ?? 'ANY',
        startDate, endDate, durationDays,
        totalUnits: Number(totalUnits) || 0,
        pharmacy,
        purchasedOn: startDate,
        costPaisa: cost.trim() ? parseTakaToPaisa(cost) : 0,
        walletId, fundSource, fundAccountId: fundSource === 'LOAN' ? fundAccountId : null, fundNote: fundSource === 'OTHER' ? fundNote : null, note,
        times: chosen.map((slot) => ({ atTime: slotTimes[slot.key] ?? slot.at, label: bn ? slot.bn : slot.en })),
      };
      if (editingId) {
        await updateMedicine(db, editingId, payload);
      } else {
        await createMedicine(db, payload);
      }
      success();
      showSnackbar(editingId ? (bn ? 'ওষুধ আপডেট হয়েছে' : 'Medicine updated') : (bn ? 'ওষুধ যোগ হয়েছে' : 'Medicine added'), 'success');
      if (editingId) {
        router.back();
      } else {
        reset(); setOpen(false);
      }
      await load();
    } catch (e) {
      warn();
      showSnackbar(logAppError('health/medicines', e, bn ? 'যোগ করা যায়নি' : 'Could not add'), 'danger');
    } finally { savingRef.current = false; setSaving(false); }
  };

  return (
    <View style={s.root}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title={bn ? 'ওষুধ' : 'Medicines'}
          subtitle={bn ? 'কী খাচ্ছেন, কখন, আর কতটা বাকি' : 'What you take, when, and how much is left'}
          backTo="/health"
          backLabel={bn ? 'স্বাস্থ্য' : 'Health'}
          onBack={() => guard.attemptLeave(() => router.dismissTo('/health' as never))}
        />

        {editingId && loadingEdit ? (
          <View style={s.loadingRow}><ActivityIndicator color={colors.primary} /></View>
        ) : !open && !editingId ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => { tapLight(); setOpen(true); }}
            style={({ pressed }) => StyleSheet.flatten([s.addBtn, pressed && s.pressed])}
          >
            <AppIcon name="plus" size={iconSize.md} color={colors.onPrimary} />
            <Text numberOfLines={1} style={s.addText}>{bn ? 'নতুন ওষুধ' : 'New medicine'}</Text>
          </Pressable>
        ) : open ? (
          <Card title={editingId ? (bn ? 'ওষুধ সম্পাদনা' : 'Edit medicine') : (bn ? 'নতুন ওষুধ' : 'New medicine')}>
            <Field label={bn ? 'নাম' : 'Name'} value={name} onChangeText={edited(setName)} placeholder={bn ? 'যেমন নাপা' : 'e.g. Napa'} autoFocus />
            <Field label={bn ? 'কেন খাচ্ছেন' : 'What it is for'} value={reason} onChangeText={edited(setReason)} placeholder={bn ? 'জ্বর, ব্যথা…' : 'Fever, pain…'} />
            <Field label={bn ? 'কোন ডাক্তার' : 'Doctor'} value={doctor} onChangeText={edited(setDoctor)} />
            <Field label={bn ? 'ডোজ' : 'Dose'} value={doseText} onChangeText={edited(setDoseText)} placeholder={bn ? '১টি ট্যাবলেট' : '1 tablet'} />
            <Field
              label={bn ? 'প্রতিবার কতটি' : 'How many each time'}
              value={perDose} onChangeText={(t) => { setPerDose(bengaliDigitsToAscii(t)); setTouched(true); }} keyboardType="numeric"
              hint={bn ? 'অর্ধেক হলে ০.৫ লিখুন' : 'Write 0.5 for half'}
            />

            <Text style={s.label}>{bn ? 'কখন খাবেন' : 'When to take it'}</Text>
            <View style={s.chipRow}>
              {SLOTS.map((slot) => (
                <Chip
                  key={slot.key}
                  label={`${bn ? slot.bn : slot.en} · ${formatClock(slotTimes[slot.key] ?? slot.at, bn, timeFormat)}`}
                  active={slots.includes(slot.key)}
                  onPress={() => toggleSlot(slot.key)}
                />
              ))}
            </View>
            {/* Only the picked slots get a time row: showing four pickers for a once-a-day
                medicine buries the one that matters under three that do nothing. */}
            {SLOTS.filter((slot) => slots.includes(slot.key)).map((slot) => (
              <AppTimeField
                key={slot.key}
                label={bn ? `${slot.bn} — কয়টায়` : `${slot.en} — at what time`}
                value={slotTimes[slot.key] ?? slot.at}
                onChange={(next) => { setSlotTimes((current) => ({ ...current, [slot.key]: next ?? slot.at })); setTouched(true); }}
              />
            ))}

            <ChipGroup
              label={bn ? 'খাবারের' : 'Food'}
              options={FOODS}
              value={food}
              onChange={edited(setFood)}
              labelOf={(f) => (bn
                ? { BEFORE: 'আগে', AFTER: 'পরে', WITH: 'সঙ্গে', ANY: 'যেকোনো সময়' }[f]
                : { BEFORE: 'Before', AFTER: 'After', WITH: 'With', ANY: 'Any time' }[f])}
            />

            <AppDateField label={bn ? 'শুরুর তারিখ' : 'Start date'} value={startDate} onChange={edited(setStartDate)} />
            <Field label={bn ? 'কতদিন চলবে' : 'For how many days'} value={days} onChangeText={(t) => { setDays(bengaliDigitsToAscii(t)); setTouched(true); }} keyboardType="numeric" />
            <Field label={bn ? 'মোট কতটি আছে' : 'How many in the box'} value={totalUnits} onChangeText={(t) => { setTotalUnits(bengaliDigitsToAscii(t)); setTouched(true); }} keyboardType="numeric" />
            <Field label={bn ? 'কোন ফার্মেসি' : 'Pharmacy'} value={pharmacy} onChangeText={edited(setPharmacy)} />
            <Field
              label={bn ? 'কত টাকায় কিনেছেন' : 'What it cost'}
              value={cost} onChangeText={edited(setCost)} keyboardType="numeric"
              hint={bn ? 'আয়-ব্যয়ে "ওষুধ" খাতে একবারই যোগ হবে' : 'Added once to the money book under ওষুধ'}
            />
            {cost.trim() ? (
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
            <Field label={bn ? 'নোট' : 'Note'} value={note} onChangeText={edited(setNote)} multiline />

          </Card>
        ) : null}

        {!items.length ? (
          <EmptyNote
            icon="pill"
            text={bn
              ? 'কোনো ওষুধ নেই। যোগ করলে সময়মতো মনে করিয়ে দেবে, আর কতটা বাকি আছে হিসাব রাখবে।'
              : 'No medicines yet. Add one and it will remind you on time and keep count of what is left.'}
          />
        ) : items.map((medicine) => {
          const stock = medicineStock(medicine);
          const tone = medicine.archivedAt ? accents.blue : stock.needsRefill ? accents.orange : accents.green;
          return (
            <Pressable
              key={medicine.id}
              accessibilityRole="button"
              accessibilityLabel={medicine.name}
              onPress={() => { tapLight(); router.push(`/health/medicine/${medicine.id}` as never); }}
              style={({ pressed }) => StyleSheet.flatten([s.row, pressed && s.pressed])}
            >
              <View style={[s.rowIcon, { backgroundColor: tone.soft }]}>
                <AppIcon name="pill" size={iconSize.md} color={tone.on} />
              </View>
              <View style={s.rowCopy}>
                <Text numberOfLines={1} style={s.rowTitle}>{medicine.name}</Text>
                <Text numberOfLines={1} style={s.rowSub}>
                  {[
                    medicine.reason,
                    medicine.times.length ? `${digits(medicine.times.length)}${bn ? ' বার/দিন' : '×/day'}` : null,
                    medicine.archivedAt ? (bn ? 'বন্ধ' : 'stopped') : null,
                  ].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <View style={s.rowEnd}>
                {medicine.totalUnits ? (
                  <Text numberOfLines={1} style={[s.rowValue, { color: tone.on }]}>
                    {digits(stock.remainingUnits)}{bn ? 'টি' : ' left'}
                  </Text>
                ) : null}
                {stock.daysLeft !== null ? (
                  <Text numberOfLines={1} style={s.rowMeta}>{digits(stock.daysLeft)}{bn ? ' দিন' : 'd'}</Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}

        {items.length ? (
          <Text style={s.footNote}>
            {bn
              ? 'ওষুধের খরচ আয়-ব্যয়ের "ওষুধ" খাতে আছে — এখানে আলাদা করে আবার গোনা হয় না।'
              : 'Medicine costs live in the money book under ওষুধ — they are not counted again here.'}
          </Text>
        ) : null}
      </ScrollView>

      {/* Pinned while the form is open, because while it is open the form *is* the screen:
          the list it replaces is not on show, and Save at the end of a long card sat below
          the fold with the keyboard up. Closed, it is not rendered — nothing to save. */}
      {open ? (
        <FormBar
          onCancel={() => guard.attemptLeave(closeForm)}
          onSave={() => void save()}
          saving={saving}
        />
      ) : null}

      <AppConfirmDialog
        visible={guard.confirming}
        title={bn ? 'পরিবর্তন বাতিল করবেন?' : 'Discard your changes?'}
        description={bn ? 'যা লিখেছেন তা সংরক্ষণ হয়নি।' : 'What you typed has not been saved.'}
        confirmLabel={bn ? 'বাতিল করুন' : 'Discard'}
        cancelLabel={bn ? 'লিখতে থাকি' : 'Keep editing'}
        danger
        icon="alert"
        onConfirm={() => { guard.setConfirming(false); closeForm(); }}
        onCancel={() => guard.setConfirming(false)}
      />
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
    loadingRow: { paddingVertical: spacing.xl, alignItems: 'center' },
    addBtn: {
      minHeight: control.buttonHeight, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.primary, marginBottom: spacing.sm,
    },
    addText: { flexShrink: 1, color: colors.onPrimary, ...typography.body, fontWeight: '800' },
    label: { color: colors.textMuted, ...typography.section, fontWeight: '800', marginTop: spacing.md, marginBottom: spacing.xs },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    row: {
      minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border,
      borderRadius: radius.lg, padding: spacing.md,
    },
    rowIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '800' },
    rowSub: { color: colors.textSecondary, ...typography.meta, marginTop: 2 },
    rowEnd: { alignItems: 'flex-end' },
    rowValue: { ...typography.meta, fontWeight: '800' },
    rowMeta: { color: colors.textMuted, ...typography.caption, marginTop: 2 },
    footNote: { color: colors.textMuted, ...typography.caption, marginTop: spacing.md, lineHeight: 18 },
    pressed: { opacity: 0.7 },
  });
}
