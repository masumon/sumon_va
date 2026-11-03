// ডাক্তার — who was seen, what they said, what it cost, and when to go back.
//
// Two money fields, not one. The consultation fee is a figure worth comparing with the
// last visit's; everything else paid that day is not, and rolling them together would
// quietly make the doctor look more expensive every time a dressing was bought. Each
// writes its own row in the money book — the fee under ডাক্তার, the rest under চিকিৎসা.

import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppPreferences } from '../../src/app/AppPreferences';
import { easeNextLayout } from '../../src/ui/motion';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../../src/ui/AppText';
import { AppIcon } from '../../src/ui/AppIcon';
import { Card, EmptyNote, Field, FormBar, ScreenHeader, useKit } from '../../src/ui/AppKit';
import { AppDateField } from '../../src/ui/AppDateField';
import { AppTimeField } from '../../src/ui/AppTimeField';
import { AppConfirmDialog, useAppFeedback } from '../../src/ui/AppFeedback';
import { RecordPreview } from '../../src/ui/RecordPreview';
import { useUnsavedGuard } from '../../src/hooks/useUnsavedGuard';
import { formatPaisa, parseTakaToPaisa } from '../../src/services/debt/money';
import { bangladeshDateKey, formatDayKey } from '../../src/i18n/date-time';
import { deleteVisit, listVisits, saveVisit, type Visit } from '../../src/services/health-service';
import { listWallets, type Wallet } from '../../src/services/wallet-service';
import { border, control, icon as iconSize, radius, spacing, type ThemeColors, typography } from '../../src/theme';
import { success, tapLight, warn } from '../../src/ui/haptics';
import type { FundSource } from '../../src/services/finance-service';
import { FundSourcePicker, WalletPicker, moneyDetailsProblem } from '../../src/ui/MoneyPickers';
import { logAppError } from '../../src/services/error-log';

export default function VisitsScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn } = useKit();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { showSnackbar } = useAppFeedback();

  const [items, setItems] = useState<Visit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [editing, setEditing] = useState<Visit | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Visit | null>(null);
  const [preview, setPreview] = useState<Visit | null>(null);
  const [open, setOpenRaw] = useState(false);
  const { reduceMotion } = useAppPreferences();
  // UX-01: ease the in-page form open/closed, like other modules' form screens slide in.
  const setOpen = (value: boolean) => { easeNextLayout(reduceMotion); setOpenRaw(value); };
  const [saving, setSaving] = useState(false);
  // `saving` is state, so two taps in one frame both read it false; the ref does not.
  const savingRef = useRef(false);

  const [doctor, setDoctor] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [visitedOn, setVisitedOn] = useState<string | null>(bangladeshDateKey(new Date()));
  const [atTime, setAtTime] = useState('');
  const [reason, setReason] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [fee, setFee] = useState('');
  const [extra, setExtra] = useState('');
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  // With a cost, whose money paid it (the user's rule: every expense names its source).
  const [fundSource, setFundSource] = useState<FundSource | null>(null);
  const [fundAccountId, setFundAccountId] = useState<string | null>(null);
  const [fundNote, setFundNote] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  // A half-filled visit is real, typed-out work — a doctor's name, what they said, a
  // follow-up date. Leaving through the back gesture used to drop it with no warning,
  // same as every other form on this screen before this fix.
  const guard = useUnsavedGuard(open && touched && !saving);
  const edited = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setTouched(true); };

  const money = useCallback((p: number) => formatPaisa(p, { bnDigits: bn }), [bn]);

  const load = useCallback(async () => {
    try {
      const [list, ws] = await Promise.all([listVisits(db), listWallets(db)]);
      setItems(list); setWallets(ws);
    } finally { setLoaded(true); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const reset = () => {
    setEditing(null); setDoctor(''); setSpecialty(''); setVisitedOn(bangladeshDateKey(new Date()));
    setAtTime(''); setReason(''); setDiagnosis(''); setFee(''); setExtra('');
    setFollowUp(null); setWalletId(null); setFundSource(null); setFundAccountId(null); setFundNote(''); setNote(''); setTouched(false);
  };
  const closeForm = () => { setOpen(false); reset(); };

  const startEdit = (visit: Visit) => {
    tapLight();
    setEditing(visit);
    setDoctor(visit.doctor); setSpecialty(visit.specialty ?? '');
    setVisitedOn(visit.visitedOn); setAtTime(visit.visitedAtTime ?? '');
    setReason(visit.reason ?? ''); setDiagnosis(visit.diagnosis ?? '');
    setFee(visit.feePaisa ? String(visit.feePaisa / 100) : '');
    setExtra(visit.extraPaisa ? String(visit.extraPaisa / 100) : '');
    setFollowUp(visit.followUpOn); setNote(visit.note ?? '');
    setOpen(true);
  };

  const save = async () => {
    if (saving || savingRef.current) return;
    if (!doctor.trim()) { warn(); showSnackbar(bn ? 'ডাক্তারের নাম দিন' : 'Name the doctor', 'danger'); return; }
    if (!visitedOn) { warn(); showSnackbar(bn ? 'তারিখ দিন' : 'Pick a date', 'danger'); return; }
    if ((fee.trim() || extra.trim())) {
      const problem = moneyDetailsProblem({ walletId, needsSource: true, fundSource }, bn);
      if (problem) { warn(); showSnackbar(problem, 'danger'); return; }
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await saveVisit(db, {
        doctor, specialty, visitedOn, visitedAtTime: atTime, reason, diagnosis,
        feePaisa: fee.trim() ? parseTakaToPaisa(fee) : 0,
        extraPaisa: extra.trim() ? parseTakaToPaisa(extra) : 0,
        followUpOn: followUp, walletId, fundSource, fundAccountId: fundSource === 'LOAN' ? fundAccountId : null, fundNote: fundSource === 'OTHER' ? fundNote : null, note,
      }, editing?.id);
      success();
      showSnackbar(bn ? 'সংরক্ষিত হয়েছে' : 'Saved', 'success');
      reset(); setOpen(false); await load();
    } catch (e) {
      warn();
      showSnackbar(logAppError('health/visits', e, bn ? 'সংরক্ষণ হয়নি' : 'Could not save'), 'danger');
    } finally { savingRef.current = false; setSaving(false); }
  };

  const confirmRemove = async () => {
    const visit = pendingDelete;
    setPendingDelete(null);
    if (!visit) return;
    try {
      await deleteVisit(db, visit.id);
      showSnackbar(bn ? 'মুছে ফেলা হয়েছে' : 'Deleted', 'info');
      await load();
    } catch {
      warn();
      showSnackbar(bn ? 'মুছে ফেলা যায়নি' : 'Could not delete that', 'danger');
    }
  };

  return (
    <View style={s.root}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title={bn ? 'ডাক্তার' : 'Doctor visits'}
          subtitle={bn ? 'কাকে দেখিয়েছেন, কী বলেছেন, কত লেগেছে' : 'Who you saw, what they said, what it cost'}
          backTo="/health"
          backLabel={bn ? 'স্বাস্থ্য' : 'Health'}
          onBack={() => guard.attemptLeave(() => router.dismissTo('/health' as never))}
        />

        {!open ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => { tapLight(); reset(); setOpen(true); }}
            style={({ pressed }) => StyleSheet.flatten([s.addBtn, pressed && s.pressed])}
          >
            <AppIcon name="plus" size={iconSize.md} color={colors.onPrimary} />
            <Text numberOfLines={1} style={s.addText}>{bn ? 'নতুন ভিজিট' : 'New visit'}</Text>
          </Pressable>
        ) : (
          <Card title={editing ? (bn ? 'ভিজিট সম্পাদনা' : 'Edit visit') : (bn ? 'নতুন ভিজিট' : 'New visit')}>
            <Field label={bn ? 'ডাক্তারের নাম' : 'Doctor'} value={doctor} onChangeText={edited(setDoctor)} autoFocus />
            <Field label={bn ? 'বিশেষজ্ঞ / বিভাগ' : 'Specialist / department'} value={specialty} onChangeText={edited(setSpecialty)} />
            <AppDateField label={bn ? 'কবে দেখিয়েছেন' : 'Visit date'} value={visitedOn} onChange={edited(setVisitedOn)} />
            <AppTimeField label={bn ? 'সময়' : 'Time'} value={atTime || null} onChange={(next) => { setAtTime(next ?? ''); setTouched(true); }} clearable />
            <Field label={bn ? 'কেন গিয়েছেন' : 'Reason'} value={reason} onChangeText={edited(setReason)} />
            <Field label={bn ? 'ডাক্তার কী বলেছেন' : 'Diagnosis / note'} value={diagnosis} onChangeText={edited(setDiagnosis)} multiline />
            <Field
              label={bn ? 'ভিজিট ফি' : 'Consultation fee'} value={fee} onChangeText={edited(setFee)} keyboardType="numeric"
              hint={bn ? 'আয়-ব্যয়ে "ডাক্তার" খাতে যাবে' : 'Goes to the money book under ডাক্তার'}
            />
            <Field
              label={bn ? 'অন্যান্য খরচ' : 'Other cost that day'} value={extra} onChangeText={edited(setExtra)} keyboardType="numeric"
              hint={bn ? 'আয়-ব্যয়ে "চিকিৎসা" খাতে যাবে' : 'Goes to the money book under চিকিৎসা'}
            />
            {(fee.trim() || extra.trim()) ? (
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
            <AppDateField label={bn ? 'পরের ফলো-আপ' : 'Follow-up date'} value={followUp} onChange={edited(setFollowUp)} />
            <Field label={bn ? 'নোট' : 'Note'} value={note} onChangeText={edited(setNote)} multiline />
          </Card>
        )}

        {!loaded ? (
          <View style={s.loadingRow}><ActivityIndicator color={colors.primary} /></View>
        ) : !items.length ? (
          <EmptyNote
            icon="stethoscope"
            text={bn
              ? 'কোনো ভিজিট লেখা নেই। যোগ করলে ফি আয়-ব্যয়ে চলে যাবে আর ফলো-আপের দিন মনে করিয়ে দেবে।'
              : 'No visits yet. Add one and the fee reaches the money book while the follow-up date reminds you.'}
          />
        ) : items.map((visit) => (
          <Pressable
            key={visit.id}
            accessibilityRole="button"
            accessibilityLabel={visit.doctor}
            accessibilityHint={bn ? 'বিস্তারিত দেখতে চাপ দিন' : 'Tap to see the details'}
            onPress={() => setPreview(visit)}
            onLongPress={() => setPendingDelete(visit)}
            style={({ pressed }) => StyleSheet.flatten([s.row, pressed && s.pressed])}
          >
            <View style={[s.rowIcon, { backgroundColor: accents.red.soft }]}>
              <AppIcon name="stethoscope" size={iconSize.md} color={accents.red.on} />
            </View>
            <View style={s.rowCopy}>
              <Text numberOfLines={1} style={s.rowTitle}>{visit.doctor}</Text>
              <Text numberOfLines={1} style={s.rowSub}>
                {[visit.specialty, formatDayKey(visit.visitedOn, bn ? 'bn' : 'en'), visit.followUpOn ? (bn ? `ফলো-আপ ${formatDayKey(visit.followUpOn, 'bn')}` : `follow-up ${formatDayKey(visit.followUpOn, 'en')}`) : null]
                  .filter(Boolean).join(' · ')}
              </Text>
            </View>
            {visit.feePaisa + visit.extraPaisa > 0 ? (
              <Text numberOfLines={1} style={s.rowValue}>{money(visit.feePaisa + visit.extraPaisa)}</Text>
            ) : null}
          </Pressable>
        ))}

        {items.length ? (
          <Text style={s.footNote}>
            {bn ? 'বিস্তারিত দেখতে চাপ দিন · মুছতে চেপে ধরুন' : 'Tap to edit · long-press to delete'}
          </Text>
        ) : null}
      </ScrollView>

      {/* Pinned while the form is open, because while it is open the form *is* the screen:
          the list it replaces is not on show, and Save sitting at the end of a card this
          long put it below the fold with the keyboard up. Closed, it is not rendered at
          all — there is nothing to save. */}
      {open ? (
        <FormBar onCancel={() => guard.attemptLeave(closeForm)} onSave={() => void save()} saving={saving} />
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

      <AppConfirmDialog
        visible={pendingDelete !== null}
        title={bn ? 'দেখা করাটি মুছবেন?' : 'Delete this visit?'}
        description={bn ? 'এর খরচও আয়-ব্যয় থেকে সরে যাবে।' : 'Its cost will leave the money book too.'}
        confirmLabel={bn ? 'মুছুন' : 'Delete'}
        cancelLabel={bn ? 'থাক' : 'Cancel'}
        danger
        icon="alert"
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPendingDelete(null)}
      />

      <RecordPreview
        visible={preview !== null}
        icon="stethoscope"
        title={preview?.doctor ?? ''}
        subtitle={preview ? [preview.specialty, formatDayKey(preview.visitedOn, bn ? 'bn' : 'en')].filter(Boolean).join(' · ') : undefined}
        headline={preview ? money(preview.feePaisa + preview.extraPaisa) : undefined}
        headlineLabel={bn ? 'মোট খরচ' : 'Total cost'}
        rows={preview ? [
          { label: bn ? 'তারিখ' : 'Date', value: formatDayKey(preview.visitedOn, bn ? 'bn' : 'en'), strong: true },
          { label: bn ? 'সময়' : 'Time', value: preview.visitedAtTime },
          { label: bn ? 'বিভাগ' : 'Specialty', value: preview.specialty },
          { label: bn ? 'কেন গিয়েছিলেন' : 'Reason', value: preview.reason },
          { label: bn ? 'কী ধরা পড়ল' : 'Diagnosis', value: preview.diagnosis },
          { label: bn ? 'ডাক্তারের ফি' : 'Doctor fee', value: preview.feePaisa ? money(preview.feePaisa) : null },
          { label: bn ? 'অন্যান্য খরচ' : 'Other cost', value: preview.extraPaisa ? money(preview.extraPaisa) : null },
          { label: bn ? 'পরের বার' : 'Follow-up', value: preview.followUpOn ? formatDayKey(preview.followUpOn, bn ? 'bn' : 'en') : null },
          { label: bn ? 'নোট' : 'Note', value: preview.note },
        ] : []}
        editLabel={bn ? 'সম্পাদনা করুন' : 'Edit this visit'}
        deleteLabel={bn ? 'মুছুন' : 'Delete this visit'}
        onEdit={() => { const v = preview; setPreview(null); if (v) startEdit(v); }}
        onDelete={() => { const v = preview; setPreview(null); setPendingDelete(v); }}
        onClose={() => setPreview(null)}
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
    rowValue: { color: colors.textPrimary, ...typography.meta, fontWeight: '800' },
    footNote: { color: colors.textMuted, ...typography.caption, marginTop: spacing.md },
    pressed: { opacity: 0.7 },
  });
}
