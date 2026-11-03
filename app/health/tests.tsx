// পরীক্ষা — what was tested, where, what it said, and when to repeat it.
//
// The report itself is an attachment, using the same file store as every other document
// in this app rather than a health-only one: photograph the paper, and it is kept beside
// the result the way it would be in a folder. The cost, as everywhere in this module, is
// a single row in the money book under পরীক্ষা.

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
import { deleteTest, listTests, saveTest, type MedicalTest } from '../../src/services/health-service';
import {
  listAttachments, removeAttachment, shareAttachment,
  AttachmentPermissionError, type Attachment,
} from '../../src/services/attachment-service';
import { addFrom, type AttachSource } from '../../src/services/attachment-sources';
import { FileGallery } from '../../src/ui/FileGallery';
import { listWallets, type Wallet } from '../../src/services/wallet-service';
import { border, control, icon as iconSize, radius, spacing, type ThemeColors, typography } from '../../src/theme';
import { success, tapLight, warn } from '../../src/ui/haptics';
import type { FundSource } from '../../src/services/finance-service';
import { FundSourcePicker, WalletPicker, moneyDetailsProblem } from '../../src/ui/MoneyPickers';
import { logAppError } from '../../src/services/error-log';

export default function TestsScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn } = useKit();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { showSnackbar } = useAppFeedback();

  const [items, setItems] = useState<MedicalTest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [reports, setReports] = useState<Record<string, Attachment[]>>({});
  const [editing, setEditing] = useState<MedicalTest | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MedicalTest | null>(null);
  const [preview, setPreview] = useState<MedicalTest | null>(null);
  const [open, setOpenRaw] = useState(false);
  const { reduceMotion } = useAppPreferences();
  // UX-01: ease the in-page form open/closed, like other modules' form screens slide in.
  const setOpen = (value: boolean) => { easeNextLayout(reduceMotion); setOpenRaw(value); };
  const [saving, setSaving] = useState(false);
  // `saving` is state, so two taps in one frame both read it false; the ref does not.
  const savingRef = useRef(false);

  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [testedOn, setTestedOn] = useState<string | null>(bangladeshDateKey(new Date()));
  const [atTime, setAtTime] = useState('');
  const [lab, setLab] = useState('');
  const [cost, setCost] = useState('');
  const [result, setResult] = useState('');
  const [reference, setReference] = useState('');
  const [repeatOn, setRepeatOn] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  // With a cost, whose money paid it (the user's rule: every expense names its source).
  const [fundSource, setFundSource] = useState<FundSource | null>(null);
  const [fundAccountId, setFundAccountId] = useState<string | null>(null);
  const [fundNote, setFundNote] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const guard = useUnsavedGuard(open && touched && !saving);
  const edited = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setTouched(true); };

  const money = useCallback((p: number) => formatPaisa(p, { bnDigits: bn }), [bn]);

  const load = useCallback(async () => {
    try {
      const [list, ws] = await Promise.all([listTests(db), listWallets(db)]);
      setItems(list); setWallets(ws);
      // One query per test rather than N — was a sequential await-in-a-for-loop, so a
      // person with a dozen tests waited a dozen round trips serialized one after another.
      const lists = await Promise.all(list.map((test) => listAttachments(db, 'HL_TEST', test.id)));
      const map: Record<string, Attachment[]> = {};
      list.forEach((test, i) => { map[test.id] = lists[i]!; });
      setReports(map);
    } finally { setLoaded(true); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const reset = () => {
    setEditing(null); setName(''); setReason(''); setTestedOn(bangladeshDateKey(new Date()));
    setAtTime(''); setLab(''); setCost(''); setResult(''); setReference('');
    setRepeatOn(null); setWalletId(null); setFundSource(null); setFundAccountId(null); setFundNote(''); setNote(''); setTouched(false);
  };
  const closeForm = () => { setOpen(false); reset(); };

  const startEdit = (test: MedicalTest) => {
    tapLight(); setEditing(test);
    setName(test.name); setReason(test.reason ?? ''); setTestedOn(test.testedOn);
    setAtTime(test.testedAtTime ?? ''); setLab(test.lab ?? '');
    setCost(test.costPaisa ? String(test.costPaisa / 100) : '');
    setResult(test.result ?? ''); setReference(test.reference ?? '');
    setRepeatOn(test.repeatOn); setNote(test.note ?? '');
    setOpen(true);
  };

  const save = async () => {
    if (saving || savingRef.current) return;
    if (!name.trim()) { warn(); showSnackbar(bn ? 'পরীক্ষার নাম দিন' : 'Name the test', 'danger'); return; }
    if (!testedOn) { warn(); showSnackbar(bn ? 'তারিখ দিন' : 'Pick a date', 'danger'); return; }
    if (cost.trim()) {
      const problem = moneyDetailsProblem({ walletId, needsSource: true, fundSource }, bn);
      if (problem) { warn(); showSnackbar(problem, 'danger'); return; }
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await saveTest(db, {
        name, reason, testedOn, testedAtTime: atTime, lab,
        costPaisa: cost.trim() ? parseTakaToPaisa(cost) : 0,
        result, reference, repeatOn, walletId, fundSource, fundAccountId: fundSource === 'LOAN' ? fundAccountId : null, fundNote: fundSource === 'OTHER' ? fundNote : null, note,
      }, editing?.id);
      success();
      showSnackbar(bn ? 'সংরক্ষিত হয়েছে' : 'Saved', 'success');
      reset(); setOpen(false); await load();
    } catch (e) {
      warn();
      showSnackbar(logAppError('health/tests', e, bn ? 'সংরক্ষণ হয়নি' : 'Could not save'), 'danger');
    } finally { savingRef.current = false; setSaving(false); }
  };

  const attach = async (test: MedicalTest, source: AttachSource) => {
    try {
      // Reports often arrive as a PDF, not a photo — "file" covers that.
      const added = await addFrom(db, 'HL_TEST', test.id, source);
      if (added.length) { success(); showSnackbar(bn ? 'রিপোর্ট যোগ হয়েছে' : 'Report attached', 'success'); await load(); }
    } catch (e) {
      warn();
      if (e instanceof AttachmentPermissionError) {
        showSnackbar(
          e.source === 'camera'
            ? (bn ? 'ক্যামেরার অনুমতি দিন — সেটিংস → অনুমতি' : 'Allow the camera — Settings → Permissions')
            : (bn ? 'ছবির অনুমতি দিন — সেটিংস → অনুমতি' : 'Allow photos — Settings → Permissions'),
          'danger',
        );
        return;
      }
      showSnackbar(bn ? 'রিপোর্ট যোগ হয়নি' : 'Could not attach', 'danger');
    }
  };

  const confirmRemove = async () => {
    const test = pendingDelete;
    setPendingDelete(null);
    if (!test) return;
    try {
      await deleteTest(db, test.id);
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
          title={bn ? 'পরীক্ষা' : 'Medical tests'}
          subtitle={bn ? 'কী করিয়েছেন, কোথায়, ফল কী' : 'What was tested, where, and what it said'}
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
            <Text numberOfLines={1} style={s.addText}>{bn ? 'নতুন পরীক্ষা' : 'New test'}</Text>
          </Pressable>
        ) : (
          <Card title={editing ? (bn ? 'পরীক্ষা সম্পাদনা' : 'Edit test') : (bn ? 'নতুন পরীক্ষা' : 'New test')}>
            <Field label={bn ? 'পরীক্ষার নাম' : 'Test name'} value={name} onChangeText={edited(setName)} autoFocus />
            <Field label={bn ? 'কেন করিয়েছেন' : 'Why'} value={reason} onChangeText={edited(setReason)} />
            <AppDateField label={bn ? 'কবে' : 'Date'} value={testedOn} onChange={edited(setTestedOn)} />
            <AppTimeField label={bn ? 'সময়' : 'Time'} value={atTime || null} onChange={(next) => { setAtTime(next ?? ''); setTouched(true); }} clearable />
            <Field label={bn ? 'ল্যাব / ডায়াগনস্টিক' : 'Lab / diagnostic centre'} value={lab} onChangeText={edited(setLab)} />
            <Field
              label={bn ? 'খরচ' : 'Cost'} value={cost} onChangeText={edited(setCost)} keyboardType="numeric"
              hint={bn ? 'আয়-ব্যয়ে "পরীক্ষা" খাতে একবারই যোগ হবে' : 'Added once to the money book under পরীক্ষা'}
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
            <Field label={bn ? 'ফল / নোট' : 'Result / note'} value={result} onChangeText={edited(setResult)} multiline />
            <Field label={bn ? 'কোন ডাক্তার বলেছেন' : 'Referred by'} value={reference} onChangeText={edited(setReference)} />
            <AppDateField label={bn ? 'আবার কবে করাতে হবে' : 'Repeat on'} value={repeatOn} onChange={edited(setRepeatOn)} />
            <Field label={bn ? 'নোট' : 'Note'} value={note} onChangeText={edited(setNote)} multiline />
          </Card>
        )}

        {!loaded ? (
          <View style={s.loadingRow}><ActivityIndicator color={colors.primary} /></View>
        ) : !items.length ? (
          <EmptyNote
            icon="test-tube"
            text={bn
              ? 'কোনো পরীক্ষা লেখা নেই। যোগ করলে খরচ আয়-ব্যয়ে যাবে আর রিপোর্টের ছবি সঙ্গে রাখা যাবে।'
              : 'No tests yet. Add one and the cost reaches the money book while the report photo stays beside it.'}
          />
        ) : items.map((test) => {
          const files = reports[test.id] ?? [];
          return (
            <View key={test.id} style={s.card}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={test.name}
                accessibilityHint={bn ? 'বিস্তারিত দেখতে চাপ দিন' : 'Tap to see the details'}
                onPress={() => setPreview(test)}
                onLongPress={() => setPendingDelete(test)}
                style={({ pressed }) => StyleSheet.flatten([s.rowInner, pressed && s.pressed])}
              >
                <View style={[s.rowIcon, { backgroundColor: accents.blue.soft }]}>
                  <AppIcon name="test-tube" size={iconSize.md} color={accents.blue.on} />
                </View>
                <View style={s.rowCopy}>
                  <Text numberOfLines={1} style={s.rowTitle}>{test.name}</Text>
                  <Text numberOfLines={1} style={s.rowSub}>
                    {[test.lab, formatDayKey(test.testedOn, bn ? 'bn' : 'en'), test.repeatOn ? (bn ? `আবার ${formatDayKey(test.repeatOn, 'bn')}` : `repeat ${formatDayKey(test.repeatOn, 'en')}`) : null]
                      .filter(Boolean).join(' · ')}
                  </Text>
                  {test.result ? <Text numberOfLines={2} style={s.rowResult}>{test.result}</Text> : null}
                </View>
                {test.costPaisa ? <Text numberOfLines={1} style={s.rowValue}>{money(test.costPaisa)}</Text> : null}
              </Pressable>

              {/* The same tiles as every other screen (RC.5): a "+" to add, tap to open. */}
              <FileGallery
                compact
                items={files}
                onPick={(source) => void attach(test, source)}
                onShare={(g) => { const it = files.find((x) => x.id === g.id); if (it) void shareAttachment(it).catch(() => undefined); }}
                onRemove={(g) => { const it = files.find((x) => x.id === g.id); if (it) void (async () => { await removeAttachment(db, it); await load(); })(); }}
              />
            </View>
          );
        })}

        {items.length ? (
          <Text style={s.footNote}>
            {bn ? 'বিস্তারিত দেখতে চাপ দিন · মুছতে চেপে ধরুন' : 'Tap to see details · long-press to delete'}
          </Text>
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
        title={bn ? 'পরীক্ষাটি মুছবেন?' : 'Delete this test?'}
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
        icon="test-tube"
        title={preview?.name ?? ''}
        subtitle={preview ? [preview.lab, formatDayKey(preview.testedOn, bn ? 'bn' : 'en')].filter(Boolean).join(' · ') : undefined}
        headline={preview?.costPaisa ? money(preview.costPaisa) : undefined}
        headlineLabel={bn ? 'খরচ' : 'Cost'}
        rows={preview ? [
          { label: bn ? 'তারিখ' : 'Date', value: formatDayKey(preview.testedOn, bn ? 'bn' : 'en'), strong: true },
          { label: bn ? 'সময়' : 'Time', value: preview.testedAtTime },
          { label: bn ? 'ল্যাব' : 'Lab', value: preview.lab },
          { label: bn ? 'কেন করা হলো' : 'Reason', value: preview.reason },
          { label: bn ? 'ফলাফল' : 'Result', value: preview.result },
          { label: bn ? 'স্বাভাবিক মাত্রা' : 'Reference', value: preview.reference },
          { label: bn ? 'আবার কবে' : 'Repeat on', value: preview.repeatOn ? formatDayKey(preview.repeatOn, bn ? 'bn' : 'en') : null },
          { label: bn ? 'নোট' : 'Note', value: preview.note },
        ] : []}
        editLabel={bn ? 'সম্পাদনা করুন' : 'Edit this test'}
        deleteLabel={bn ? 'মুছুন' : 'Delete this test'}
        onEdit={() => { const t = preview; setPreview(null); if (t) startEdit(t); }}
        onDelete={() => { const t = preview; setPreview(null); setPendingDelete(t); }}
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
    card: {
      backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border,
      borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm,
    },
    rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    rowIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '800' },
    rowSub: { color: colors.textSecondary, ...typography.meta, marginTop: 2 },
    rowResult: { color: colors.textMuted, ...typography.caption, marginTop: 4 },
    rowValue: { color: colors.textPrimary, ...typography.meta, fontWeight: '800' },
    footNote: { color: colors.textMuted, ...typography.caption, marginTop: spacing.md, lineHeight: 18 },
    pressed: { opacity: 0.7 },
  });
}
