// প্রেসক্রিপশন — what the doctor wrote, and the medicines that came out of it.
//
// A prescription is not a duplicate of the medicine list; it is the reason the list looks
// the way it does. Adding one here and then adding its medicines links them, so "why am I
// taking this" has an answer months later when the paper is long gone.

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
import { AppConfirmDialog, useAppFeedback } from '../../src/ui/AppFeedback';
import { RecordPreview } from '../../src/ui/RecordPreview';
import { useUnsavedGuard } from '../../src/hooks/useUnsavedGuard';
import { asciiDigitsToBengali } from '../../src/services/debt/money';
import { bangladeshDateKey, formatDayKey } from '../../src/i18n/date-time';
import {
  deletePrescription, listMedicines, listPrescriptions, savePrescription, type Prescription,
} from '../../src/services/health-service';
import { canReadImages, captureAndReadText, describeReader } from '../../src/services/ocr-service';
import { AttachmentPermissionError } from '../../src/services/attachment-service';
import { useOcrLinePicker } from '../../src/ui/OcrLinePicker';
import { border, control, icon as iconSize, layout, radius, spacing, type ThemeColors, typography } from '../../src/theme';
import { success, tapLight, warn } from '../../src/ui/haptics';

export default function PrescriptionsScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn } = useKit();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { showSnackbar } = useAppFeedback();
  const ocr = useOcrLinePicker();

  const [items, setItems] = useState<Prescription[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<Prescription | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Prescription | null>(null);
  const [preview, setPreview] = useState<Prescription | null>(null);
  const [open, setOpenRaw] = useState(false);
  const { reduceMotion } = useAppPreferences();
  // UX-01: ease the in-page form open/closed, like other modules' form screens slide in.
  const setOpen = (value: boolean) => { easeNextLayout(reduceMotion); setOpenRaw(value); };
  const [saving, setSaving] = useState(false);
  // `saving` is state, so two taps in one frame both read it false; the ref does not.
  const savingRef = useRef(false);

  const [doctor, setDoctor] = useState('');
  const [issuedOn, setIssuedOn] = useState<string | null>(bangladeshDateKey(new Date()));
  const [diagnosis, setDiagnosis] = useState('');
  const [advice, setAdvice] = useState('');
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const guard = useUnsavedGuard(open && touched && !saving);
  const edited = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setTouched(true); };

  // Reading the paper itself, the same way Home reads one into a task or memory -- same
  // service, same two-step (camera or gallery) choice, same reader disclosure. The text
  // lands in "পরামর্শ" (Advice): the closest single field to what a prescription photo
  // actually is, the doctor's own words on the page.
  const [photoChoice, setPhotoChoice] = useState(false);
  const [reading, setReading] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const ocrAvailable = useMemo(() => canReadImages(), []);
  const readPhoto = async (source: 'camera' | 'gallery') => {
    setPhotoChoice(false);
    if (reading) return;
    setReading(true);
    try {
      const result = await captureAndReadText(db, source, bn, true);
      if (result.cancelled) return;
      if (!result.ok || !result.text) {
        showSnackbar(result.reason ?? (bn ? 'ছবি থেকে লেখা তোলা গেল না।' : 'Could not read the image.'), 'danger');
        return;
      }
      // Same picker as Home: the photo and its lines, keep what is wanted (rc.13 QA G03).
      ocr.offer(result.text, result.note ?? null, result.imageUri, (picked) => setAdvice((base) => { const next = base.trim() ? `${base.trim()}\n${picked}` : picked; setTouched(true); return next; }));
      setPhotoNote((bn
        ? `${describeReader(result.reader!, true)} দিয়ে পড়া হয়েছে — পাঠানোর আগে দেখে নিন।`
        : `Read with ${describeReader(result.reader!, false)} — check it before sending.`) + (result.note ? ` ${result.note}` : ''));
    } catch (e) {
      showSnackbar(e instanceof AttachmentPermissionError
        ? (source === 'camera'
          ? (bn ? 'ক্যামেরার অনুমতি দেওয়া নেই।' : 'Camera permission is not granted.')
          : (bn ? 'ছবি দেখার অনুমতি দেওয়া নেই।' : 'Photo permission is not granted.'))
        : (bn ? 'ছবি থেকে লেখা তোলা গেল না।' : 'Could not read the image.'), 'danger');
    } finally {
      setReading(false);
    }
  };

  const digits = useCallback((v: string | number) => (bn ? asciiDigitsToBengali(String(v)) : String(v)), [bn]);

  const load = useCallback(async () => {
    try {
      const [list, medicines] = await Promise.all([listPrescriptions(db), listMedicines(db, { includeArchived: true })]);
      setItems(list);
      const map: Record<string, number> = {};
      for (const medicine of medicines) {
        if (!medicine.prescriptionId) continue;
        map[medicine.prescriptionId] = (map[medicine.prescriptionId] ?? 0) + 1;
      }
      setCounts(map);
    } finally { setLoaded(true); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const reset = () => {
    setEditing(null); setDoctor(''); setIssuedOn(bangladeshDateKey(new Date()));
    setDiagnosis(''); setAdvice(''); setFollowUp(null); setNote(''); setTouched(false);
    setPhotoChoice(false); setPhotoNote(null);
  };
  const closeForm = () => { setOpen(false); reset(); };

  const startEdit = (rx: Prescription) => {
    tapLight(); setEditing(rx);
    setDoctor(rx.doctor ?? ''); setIssuedOn(rx.issuedOn); setDiagnosis(rx.diagnosis ?? '');
    setAdvice(rx.advice ?? ''); setFollowUp(rx.followUpOn); setNote(rx.note ?? '');
    setOpen(true);
  };

  const save = async () => {
    if (saving || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await savePrescription(db, { doctor, issuedOn, diagnosis, advice, followUpOn: followUp, note }, editing?.id);
      success();
      showSnackbar(bn ? 'সংরক্ষিত হয়েছে' : 'Saved', 'success');
      reset(); setOpen(false); await load();
    } catch {
      warn(); showSnackbar(bn ? 'সংরক্ষণ হয়নি' : 'Could not save', 'danger');
    } finally { savingRef.current = false; setSaving(false); }
  };

  const confirmRemove = async () => {
    const rx = pendingDelete;
    setPendingDelete(null);
    if (!rx) return;
    try {
      await deletePrescription(db, rx.id);
      await load();
    } catch {
      warn();
      showSnackbar(bn ? 'মুছে ফেলা যায়নি' : 'Could not delete that', 'danger');
    }
  };

  return (
    <View style={s.root}>
      {ocr.picker}
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title={bn ? 'প্রেসক্রিপশন' : 'Prescriptions'}
          subtitle={bn ? 'ডাক্তার কী লিখেছেন, আর কেন' : 'What the doctor wrote, and why'}
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
            <Text numberOfLines={1} style={s.addText}>{bn ? 'নতুন প্রেসক্রিপশন' : 'New prescription'}</Text>
          </Pressable>
        ) : (
          <Card title={editing ? (bn ? 'সম্পাদনা' : 'Edit') : (bn ? 'নতুন প্রেসক্রিপশন' : 'New prescription')}>
            <Field label={bn ? 'ডাক্তার' : 'Doctor'} value={doctor} onChangeText={edited(setDoctor)} autoFocus />
            <AppDateField label={bn ? 'তারিখ' : 'Date'} value={issuedOn} onChange={edited(setIssuedOn)} />

            {ocrAvailable ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: photoChoice }}
                  accessibilityLabel={bn ? 'ছবি থেকে লেখা তুলুন' : 'Read text from a photo'}
                  onPress={() => setPhotoChoice((v) => !v)}
                  disabled={saving || reading}
                  style={({ pressed }) => StyleSheet.flatten([s.ocrToggle, photoChoice && s.ocrToggleActive, pressed && s.pressed])}
                >
                  {reading
                    ? <ActivityIndicator size="small" color={photoChoice ? colors.onPrimary : colors.primary} />
                    : <AppIcon name="camera-outline" size={iconSize.sm} color={photoChoice ? colors.onPrimary : colors.primary} />}
                  <Text numberOfLines={1} style={[s.ocrToggleText, photoChoice && s.ocrToggleTextActive]}>
                    {bn ? 'প্রেসক্রিপশনের ছবি থেকে তুলুন' : 'Read from a photo of the prescription'}
                  </Text>
                </Pressable>
                {photoChoice ? (
                  <View style={s.photoRow}>
                    {([['camera', bn ? 'ছবি তুলুন' : 'Take a photo', 'camera-outline'],
                       ['gallery', bn ? 'গ্যালারি থেকে' : 'From gallery', 'image-outline']] as const).map(([source, label, iconName]) => (
                      <Pressable
                        key={source}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        onPress={() => void readPhoto(source)}
                        style={({ pressed }) => StyleSheet.flatten([s.photoBtn, pressed && s.pressed])}
                      >
                        <AppIcon name={iconName} size={iconSize.sm} color={colors.primary} />
                        <Text numberOfLines={1} style={s.photoBtnText}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {photoNote ? (
                  <View style={s.photoNote}>
                    <AppIcon name="information-outline" size={iconSize.xs} color={colors.textMuted} />
                    <Text style={s.photoNoteText}>{photoNote}</Text>
                  </View>
                ) : null}
              </>
            ) : null}

            <Field label={bn ? 'রোগ / কারণ' : 'Diagnosis / reason'} value={diagnosis} onChangeText={edited(setDiagnosis)} multiline />
            <Field label={bn ? 'পরামর্শ' : 'Advice'} value={advice} onChangeText={edited(setAdvice)} multiline />
            <AppDateField label={bn ? 'ফলো-আপ' : 'Follow-up'} value={followUp} onChange={edited(setFollowUp)} />
            <Field label={bn ? 'নোট' : 'Note'} value={note} onChangeText={edited(setNote)} multiline />
          </Card>
        )}

        {!loaded ? (
          <View style={s.loadingRow}><ActivityIndicator color={colors.primary} /></View>
        ) : !items.length ? (
          <EmptyNote
            icon="file-document-outline"
            text={bn
              ? 'কোনো প্রেসক্রিপশন নেই। যোগ করলে ওষুধ, পরীক্ষা ও ফলো-আপ একসাথে বাঁধা থাকবে।'
              : 'No prescriptions yet. Add one and the medicines, tests and follow-up stay tied together.'}
          />
        ) : items.map((rx) => (
          <Pressable
            key={rx.id}
            accessibilityRole="button"
            accessibilityLabel={rx.diagnosis || rx.doctor || (bn ? 'প্রেসক্রিপশন' : 'Prescription')}
            accessibilityHint={bn ? 'বিস্তারিত দেখতে চাপ দিন' : 'Tap to see the details'}
            onPress={() => setPreview(rx)}
            onLongPress={() => setPendingDelete(rx)}
            style={({ pressed }) => StyleSheet.flatten([s.row, pressed && s.pressed])}
          >
            <View style={[s.rowIcon, { backgroundColor: accents.blue.soft }]}>
              <AppIcon name="file-document-outline" size={iconSize.md} color={accents.blue.on} />
            </View>
            <View style={s.rowCopy}>
              <Text numberOfLines={1} style={s.rowTitle}>{rx.diagnosis || rx.doctor || (bn ? 'প্রেসক্রিপশন' : 'Prescription')}</Text>
              <Text numberOfLines={1} style={s.rowSub}>
                {[rx.doctor, rx.issuedOn ? formatDayKey(rx.issuedOn, bn ? 'bn' : 'en') : null,
                  counts[rx.id] ? (bn ? `${digits(counts[rx.id]!)}টি ওষুধ` : `${counts[rx.id]} medicines`) : null]
                  .filter(Boolean).join(' · ')}
              </Text>
            </View>
            {rx.followUpOn ? (
              <View style={s.followChip}>
                <Text numberOfLines={1} style={s.followText}>{bn ? 'ফলো-আপ' : 'Follow-up'}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}

        {items.length ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => { tapLight(); router.push('/health/medicines' as never); }}
            style={({ pressed }) => StyleSheet.flatten([s.link, pressed && s.pressed])}
          >
            <Text style={s.linkText}>{bn ? 'ওষুধ যোগ করুন →' : 'Add the medicines →'}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Pinned while the form is open, because while it is open the form *is* the screen:
          the list it replaces is not on show, and Save at the end of a long card sat below
          the fold with the keyboard up. Closed, it is not rendered — nothing to save. */}
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
        title={bn ? 'প্রেসক্রিপশনটি মুছবেন?' : 'Delete this prescription?'}
        description={bn ? 'ওষুধগুলো থেকে যাবে, শুধু কাগজটি সরবে।' : 'The medicines stay; only the paper goes.'}
        confirmLabel={bn ? 'মুছুন' : 'Delete'}
        cancelLabel={bn ? 'থাক' : 'Cancel'}
        danger
        icon="alert"
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPendingDelete(null)}
      />

      <RecordPreview
        visible={preview !== null}
        icon="file-document-outline"
        title={preview?.diagnosis || preview?.doctor || (bn ? 'প্রেসক্রিপশন' : 'Prescription')}
        subtitle={preview?.issuedOn ? formatDayKey(preview.issuedOn, bn ? 'bn' : 'en') : undefined}
        rows={preview ? [
          { label: bn ? 'ডাক্তার' : 'Doctor', value: preview.doctor, strong: true },
          { label: bn ? 'তারিখ' : 'Issued on', value: preview.issuedOn ? formatDayKey(preview.issuedOn, bn ? 'bn' : 'en') : null },
          { label: bn ? 'কী ধরা পড়ল' : 'Diagnosis', value: preview.diagnosis },
          { label: bn ? 'পরামর্শ' : 'Advice', value: preview.advice },
          { label: bn ? 'পরের বার' : 'Follow-up', value: preview.followUpOn ? formatDayKey(preview.followUpOn, bn ? 'bn' : 'en') : null },
          { label: bn ? 'নোট' : 'Note', value: preview.note },
        ] : []}
        editLabel={bn ? 'সম্পাদনা করুন' : 'Edit this prescription'}
        deleteLabel={bn ? 'মুছুন' : 'Delete this prescription'}
        onEdit={() => { const r = preview; setPreview(null); if (r) startEdit(r); }}
        onDelete={() => { const r = preview; setPreview(null); setPendingDelete(r); }}
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
    ocrToggle: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, marginTop: spacing.sm },
    ocrToggleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    ocrToggleText: { flexShrink: 1, color: colors.primary, ...typography.meta, fontWeight: '800' },
    ocrToggleTextActive: { color: colors.onPrimary },
    photoRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    photoBtn: { flex: 1, minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    photoBtnText: { flexShrink: 1, color: colors.primary, ...typography.meta, fontWeight: '800' },
    photoNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: spacing.sm },
    photoNoteText: { flex: 1, color: colors.textMuted, ...typography.caption },
    row: {
      minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border,
      borderRadius: radius.lg, padding: spacing.md,
    },
    rowIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '800' },
    rowSub: { color: colors.textSecondary, ...typography.meta, marginTop: 2 },
    followChip: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
    followText: { color: colors.textSecondary, ...typography.caption, fontWeight: '800' },
    link: { minHeight: 44, justifyContent: 'center', marginTop: spacing.sm },
    linkText: { color: colors.primary, ...typography.meta, fontWeight: '800' },
    pressed: { opacity: 0.7 },
  });
}
