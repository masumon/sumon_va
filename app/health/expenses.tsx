// চিকিৎসার খরচ — the medical part of the money book, read back out of it.
//
// Every figure on this screen is a SUM over `fin_entries`. Nothing is stored here and
// nothing is added up twice: the same rows that make the month's total expense make this
// total too, filtered to the six medical categories. That is the whole design — a
// medical expense is an expense, seen from a different angle, not a second expense.

import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppPreferences } from '../../src/app/AppPreferences';
import { easeNextLayout } from '../../src/ui/motion';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../../src/ui/AppText';
import { AppIcon } from '../../src/ui/AppIcon';
import { Bar, Card, Chip, EmptyNote, Field, FormBar, ScreenHeader, useKit } from '../../src/ui/AppKit';
import { AppDateField } from '../../src/ui/AppDateField';
import { AppConfirmDialog, useAppFeedback } from '../../src/ui/AppFeedback';
import { useUnsavedGuard } from '../../src/hooks/useUnsavedGuard';
import { formatPaisa, parseTakaToPaisa } from '../../src/services/debt/money';
import { bangladeshDateKey, bangladeshMonthKey, formatDayKey } from '../../src/i18n/date-time';
import {
  HEALTH_CATEGORIES, healthCategoryName, listMedicalEntries, medicalSpend,
  medicalSpendPeriods, syncCostEntry, type HealthCategory, type MedicalSpend, type MedicalSpendPeriods,
} from '../../src/services/health-service';
import { listWallets, type Wallet } from '../../src/services/wallet-service';
import { type FinanceEntry, type FundSource } from '../../src/services/finance-service';
import { border, control, icon as iconSize, radius, spacing, type ThemeColors, typography } from '../../src/theme';
import { success, tapLight, warn } from '../../src/ui/haptics';
import { FundSourcePicker, WalletPicker, moneyDetailsProblem } from '../../src/ui/MoneyPickers';
import { EntryPreview } from '../../src/ui/EntryPreview';
import { ReportButton } from '../../src/ui/ReportButton';
import { healthReport } from '../../src/services/module-reports';
import { logAppError } from '../../src/services/error-log';

const CATEGORY_ICON: Record<string, string> = {
  'ওষুধ': 'pill', 'ডাক্তার': 'stethoscope', 'পরীক্ষা': 'test-tube',
  'হাসপাতাল': 'hospital-building', 'চিকিৎসা': 'medical-bag', 'স্বাস্থ্য-অন্যান্য': 'heart-pulse',
};

export default function HealthExpensesScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn } = useKit();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { showSnackbar } = useAppFeedback();

  const [periods, setPeriods] = useState<MedicalSpendPeriods | null>(null);

  const [previewEntry, setPreviewEntry] = useState<FinanceEntry | null>(null);
  const [month, setMonth] = useState<MedicalSpend | null>(null);
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [open, setOpenRaw] = useState(false);
  const { reduceMotion } = useAppPreferences();
  // UX-01: ease the in-page form open/closed, like other modules' form screens slide in.
  const setOpen = (value: boolean) => { easeNextLayout(reduceMotion); setOpenRaw(value); };
  const [saving, setSaving] = useState(false);
  // `saving` is state, so two taps in one frame both read it false; the ref does not.
  const savingRef = useRef(false);

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<HealthCategory>('হাসপাতাল');
  const [on, setOn] = useState<string | null>(bangladeshDateKey(new Date()));
  const [purpose, setPurpose] = useState('');
  const [walletId, setWalletId] = useState<string | null>(null);
  const [fundSource, setFundSource] = useState<FundSource | null>(null);
  const [fundAccountId, setFundAccountId] = useState<string | null>(null);
  const [fundNote, setFundNote] = useState('');
  const [method, setMethod] = useState('');
  const [touched, setTouched] = useState(false);
  const guard = useUnsavedGuard(open && touched && !saving);
  const edited = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setTouched(true); };

  const money = useCallback((p: number) => formatPaisa(p, { bnDigits: bn }), [bn]);

  const load = useCallback(async () => {
    try {
      const key = bangladeshMonthKey();
      const [p, m, list, ws] = await Promise.all([
        medicalSpendPeriods(db),
        medicalSpend(db, `${key}-01`, `${key}-31`),
        listMedicalEntries(db, 80),
        listWallets(db),
      ]);
      setPeriods(p); setMonth(m); setEntries(list); setWallets(ws);
    } finally { setLoaded(true); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const save = async () => {
    if (saving || savingRef.current) return;
    if (!amount.trim()) { warn(); showSnackbar(bn ? 'টাকার অঙ্ক দিন' : 'Enter an amount', 'danger'); return; }
    const problem = moneyDetailsProblem({ walletId, needsSource: true, fundSource }, bn);
    if (problem) { warn(); showSnackbar(problem, 'danger'); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      await syncCostEntry(db, {
        entryId: null,
        amountPaisa: parseTakaToPaisa(amount),
        category,
        occurredOn: on,
        walletId, method,
        fundSource, fundAccountId: fundSource === 'LOAN' ? fundAccountId : null, fundNote: fundSource === 'OTHER' ? fundNote : null,
        note: purpose,
      });
      success();
      showSnackbar(bn ? 'খরচ যোগ হয়েছে' : 'Expense added', 'success');
      setAmount(''); setPurpose(''); setMethod(''); setFundSource(null); setFundAccountId(null); setFundNote(''); setTouched(false); setOpen(false);
      await load();
    } catch (e) {
      warn();
      showSnackbar(logAppError('health/expenses', e, bn ? 'যোগ হয়নি' : 'Could not add'), 'danger');
    } finally { savingRef.current = false; setSaving(false); }
  };

  const grand = month?.totalPaisa ?? 0;

  return (
    <View style={s.root}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title={bn ? 'চিকিৎসার খরচ' : 'Medical spending'}
          subtitle={bn ? 'আজ, এই মাসে, এই বছরে — কোন খাতে কত' : 'Today, this month, this year — and on what'}
          backTo="/health"
          backLabel={bn ? 'স্বাস্থ্য' : 'Health'}
          onBack={() => guard.attemptLeave(() => router.dismissTo('/health' as never))}
        />

        <ReportButton build={(d, l) => healthReport(d, l)} />

        {/* The three periods. Each opens the money book filtered to the same rows, so a
            figure here can always be checked against the ledger that produced it. */}
        <View style={s.periodRow}>
          {([
            { key: 'today', label: bn ? 'আজ' : 'Today', value: periods?.todayPaisa ?? 0, tone: accents.blue },
            { key: 'month', label: bn ? 'এই মাসে' : 'This month', value: periods?.monthPaisa ?? 0, tone: accents.red },
            { key: 'year', label: bn ? 'এই বছরে' : 'This year', value: periods?.yearPaisa ?? 0, tone: accents.orange },
          ]).map((cell) => (
            <Pressable
              key={cell.key}
              accessibilityRole="button"
              accessibilityLabel={`${cell.label}: ${money(cell.value)}`}
              onPress={() => { tapLight(); router.push('/finance' as never); }}
              style={({ pressed }) => StyleSheet.flatten([s.period, { backgroundColor: cell.tone.soft }, pressed && s.pressed])}
            >
              <Text numberOfLines={1} style={s.periodLabel}>{cell.label}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[s.periodValue, { color: cell.tone.on }]}>
                {money(cell.value)}
              </Text>
            </Pressable>
          ))}
        </View>

        {!open ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => { tapLight(); setOpen(true); }}
            style={({ pressed }) => StyleSheet.flatten([s.addBtn, pressed && s.pressed])}
          >
            <AppIcon name="plus" size={iconSize.md} color={colors.onPrimary} />
            <Text numberOfLines={1} style={s.addText}>{bn ? 'অন্য চিকিৎসা খরচ' : 'Other medical expense'}</Text>
          </Pressable>
        ) : (
          <Card title={bn ? 'চিকিৎসা খরচ' : 'Medical expense'}>
            <Field label={bn ? 'কত টাকা' : 'Amount'} value={amount} onChangeText={edited(setAmount)} keyboardType="numeric" autoFocus />
            <Text style={s.label}>{bn ? 'কোন খাতে' : 'Category'}</Text>
            <View style={s.chipRow}>
              {HEALTH_CATEGORIES.map((c) => (
                <Chip key={c} label={healthCategoryName(c, bn)} active={category === c} onPress={() => { tapLight(); setCategory(c); setTouched(true); }} />
              ))}
            </View>
            <AppDateField label={bn ? 'কবে' : 'Date'} value={on} onChange={edited(setOn)} />
            <Field label={bn ? 'কী জন্য / কাকে' : 'What for / to whom'} value={purpose} onChangeText={edited(setPurpose)} />
            <Field label={bn ? 'কীভাবে দিয়েছেন' : 'How it was paid'} value={method} onChangeText={edited(setMethod)} placeholder={bn ? 'নগদ, বিকাশ…' : 'Cash, bKash…'} />
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
          </Card>
        )}

        {/* Where this month's medical money went. */}
        {month?.byCategory.length ? (
          <Card title={bn ? 'এই মাসে কোন খাতে' : 'This month, by category'}>
            {month.byCategory.map((row) => (
              <View key={row.category} style={s.catRow}>
                <View style={s.catHead}>
                  <AppIcon name={(CATEGORY_ICON[row.category] ?? 'heart-pulse') as never} size={iconSize.sm} color={colors.textSecondary} />
                  <Text numberOfLines={1} style={s.catName}>{healthCategoryName(row.category, bn)}</Text>
                  <Text numberOfLines={1} style={s.catValue}>{money(row.totalPaisa)}</Text>
                </View>
                <Bar pct={grand ? (row.totalPaisa / grand) * 100 : 0} tone={accents.red} />
              </View>
            ))}
            <Text style={s.total}>
              {bn ? `মোট ${money(grand)}` : `Total ${money(grand)}`}
            </Text>
          </Card>
        ) : null}

        {/* Every medical row, so the total can be taken apart. */}
        {!loaded ? (
          <View style={s.loadingRow}><ActivityIndicator color={colors.primary} /></View>
        ) : !entries.length ? (
          <EmptyNote
            icon="medical-bag"
            text={bn
              ? 'চিকিৎসার কোনো খরচ নেই। ওষুধ, ডাক্তার বা পরীক্ষায় টাকার অঙ্ক দিলে সেটি এখানেও আসবে — আয়-ব্যয়ের ভেতরেই, আলাদা করে নয়।'
              : 'No medical spending yet. Put an amount on a medicine, visit or test and it appears here — inside the money book, not beside it.'}
          />
        ) : (
          <Card title={bn ? 'প্রতিটি খরচ' : 'Every medical expense'}>
            {entries.map((entry) => (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={`${entry.category} ${money(entry.amountPaisa)}`}
                onPress={() => { tapLight(); setPreviewEntry(entry); }}
                style={({ pressed }) => StyleSheet.flatten([s.entryRow, pressed && s.pressed])}
              >
                <AppIcon name={(CATEGORY_ICON[entry.category] ?? 'heart-pulse') as never} size={iconSize.sm} color={colors.textMuted} />
                <View style={s.rowCopy}>
                  <Text numberOfLines={1} style={s.entryTitle}>{entry.note || healthCategoryName(entry.category, bn)}</Text>
                  <Text numberOfLines={1} style={s.entryMeta}>
                    {[healthCategoryName(entry.category, bn), formatDayKey(entry.occurredAt, bn ? 'bn' : 'en'), entry.method].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text numberOfLines={1} style={s.entryValue}>{money(entry.amountPaisa)}</Text>
              </Pressable>
            ))}
            <Text style={s.footNote}>
              {bn
                ? 'এই টাকাগুলো মাসের মোট ব্যয়ের ভেতরেই আছে — আলাদা করে আবার যোগ হয় না।'
                : 'This money is already inside the month’s total spending — it is not added again.'}
            </Text>
          </Card>
        )}
      <EntryPreview entry={previewEntry} onClose={() => setPreviewEntry(null)} />
      </ScrollView>

      {/* Pinned while the form is open, because while it is open the form *is* the screen:
          the list it replaces is not on show, and Save at the end of a long card sat below
          the fold with the keyboard up. Closed, it is not rendered — nothing to save. */}
      {open ? (
        <FormBar onCancel={() => guard.attemptLeave(() => { setOpen(false); setTouched(false); })} onSave={() => void save()} saving={saving} />
      ) : null}

      <AppConfirmDialog
        visible={guard.confirming}
        title={bn ? 'পরিবর্তন বাতিল করবেন?' : 'Discard your changes?'}
        description={bn ? 'যা লিখেছেন তা সংরক্ষণ হয়নি।' : 'What you typed has not been saved.'}
        confirmLabel={bn ? 'বাতিল করুন' : 'Discard'}
        cancelLabel={bn ? 'লিখতে থাকি' : 'Keep editing'}
        danger
        icon="alert"
        onConfirm={() => { guard.setConfirming(false); setOpen(false); setTouched(false); }}
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
    periodRow: { flexDirection: 'row', gap: spacing.xs },
    period: { flex: 1, minHeight: 74, borderRadius: radius.lg, padding: spacing.md, justifyContent: 'center', gap: 2 },
    periodLabel: { color: colors.textSecondary, ...typography.caption, fontWeight: '800' },
    periodValue: { ...typography.cardTitle, fontWeight: '800' },
    addBtn: {
      minHeight: control.buttonHeight, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.primary, marginTop: spacing.sm,
    },
    addText: { flexShrink: 1, color: colors.onPrimary, ...typography.body, fontWeight: '800' },
    label: { color: colors.textMuted, ...typography.section, fontWeight: '800', marginTop: spacing.md, marginBottom: spacing.xs },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    catRow: { gap: spacing.xs, marginTop: spacing.sm },
    catHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    catName: { flex: 1, color: colors.textPrimary, ...typography.meta, fontWeight: '700' },
    catValue: { color: colors.textPrimary, ...typography.meta, fontWeight: '800' },
    total: { color: colors.textPrimary, ...typography.body, fontWeight: '800', marginTop: spacing.md, textAlign: 'right' },
    entryRow: {
      minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      borderTopWidth: border.thin, borderTopColor: colors.border, paddingVertical: spacing.sm,
    },
    rowCopy: { flex: 1, minWidth: 0 },
    entryTitle: { color: colors.textPrimary, ...typography.meta, fontWeight: '700' },
    entryMeta: { color: colors.textMuted, ...typography.caption, marginTop: 2 },
    entryValue: { color: colors.textPrimary, ...typography.meta, fontWeight: '800' },
    footNote: { color: colors.textMuted, ...typography.caption, marginTop: spacing.md, lineHeight: 18 },
    pressed: { opacity: 0.7 },
  });
}
