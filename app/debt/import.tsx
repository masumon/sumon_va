import { useCallback, useMemo, useState } from 'react';
import { asciiDigitsToBengali } from '../../src/services/debt/money';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { AppText as Text } from '../../src/ui/AppText';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import { AppConfirmDialog, useAppFeedback } from '../../src/ui/AppFeedback';
import { IMPORT_MIME_TYPES, accountSignature, buildImportPreview, readSheetFile, type ImportPreview, type ParsedImportRow } from '../../src/services/debt/port';
import { analyseSheet, toRawRows, FIELD_KEYS, type FieldKey, type SheetAnalysis } from '../../src/services/debt/sheet-map';
import { applyImport } from '../../src/services/debt/import-runner';
import { listAccounts, listPeople } from '../../src/services/debt/repository';
import type { SheetGrid } from '../../src/services/debt/xlsx';
import type { Direction } from '../../src/services/debt/types';
import { AppIcon } from '../../src/ui/AppIcon';
import { Card, Chip, DebtHeader, EmptyNote, Stat, useDebt } from '../../src/ui/DebtKit';
import { success, tapLight, warn } from '../../src/ui/haptics';
import { icon, spacing } from '../../src/theme';
import { logAppError } from '../../src/services/error-log';

/** Cycle order for the per-column picker: every field, then "ignore this column". */
const CYCLE: (FieldKey | null)[] = [...FIELD_KEYS, null];

export default function DebtImport() {
  const db = useSQLiteContext();
  const { s, c, bn, colors, accents, money } = useDebt();
  const { showSnackbar } = useAppFeedback();

  const [fileName, setFileName] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetGrid[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [analysis, setAnalysis] = useState<SheetAnalysis | null>(null);
  const [mapping, setMapping] = useState<(FieldKey | null)[]>([]);
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set());
  const [existingAccounts, setExistingAccounts] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultDirection, setDefaultDirection] = useState<Direction>('DEBT');
  const [allowZeroAmount, setAllowZeroAmount] = useState(false);

  const fieldLabel = useCallback((f: FieldKey | null): string => {
    if (!f) return c.ignoreColumn;
    const map: Record<FieldKey, [string, string]> = {
      personName: ['নাম', 'Name'], phone: ['ফোন', 'Phone'], direction: ['ধরন', 'Type'],
      amount: ['পরিমাণ', 'Amount'], takenOrGivenDate: ['তারিখ', 'Date'], dueDate: ['ফেরতের তারিখ', 'Due date'],
      paidAmount: ['পরিশোধিত', 'Paid'], purpose: ['কারণ', 'Purpose'], notes: ['নোট', 'Note'],
      installment: ['কিস্তি', 'Instalment'],
    };
    return bn ? map[f][0] : map[f][1];
  }, [bn, c.ignoreColumn]);

  /** The engine reports error codes; the screen is where they become readable. */
  const errorLabel = useCallback((code: string): string => {
    const map: Record<string, [string, string]> = {
      'missing person name': ['নাম নেই', 'No name'],
      'missing amount': ['টাকার অঙ্ক নেই', 'No amount'],
      'bad amount': ['টাকার অঙ্ক পড়া যায়নি', 'Amount unreadable'],
    };
    const entry = map[code];
    return entry ? (bn ? entry[0] : entry[1]) : code;
  }, [bn]);

  const openSheet = useCallback((grids: SheetGrid[], index: number) => {
    const grid = grids[index];
    if (!grid) return;
    const a = analyseSheet(grid);
    setSheetIdx(index);
    setAnalysis(a);
    setMapping(a.mapping);
  }, []);

  /** Shared tail of both sources: analyse the sheets and prime the duplicate check. */
  const adopt = useCallback(async (grids: SheetGrid[], name: string) => {
    const [people, accounts] = await Promise.all([listPeople(db), listAccounts(db, {})]);
    setExistingNames(new Set(people.map((p) => p.name.trim().toLowerCase())));
    // Fingerprint what is already stored so re-running a file adds nothing twice.
    const nameById = new Map(people.map((p) => [p.id, p.name]));
    setExistingAccounts(new Set(accounts.map((a) =>
      accountSignature(nameById.get(a.personId) ?? '', a.principalPaisa, a.openedDate))));
    setFileName(name);
    setSheets(grids);
    openSheet(grids, 0);
    tapLight();
  }, [db, openSheet]);

  const pick = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: IMPORT_MIME_TYPES, copyToCacheDirectory: true, multiple: false });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset) return;
      await adopt(await readSheetFile(asset.uri, asset.name), asset.name);
    } catch (e) {
      warn();
      const message = logAppError('debt-import', e, bn ? 'ফাইলটি পড়া গেল না' : 'Could not read that file');
      setError(message);
      setSheets([]);
      setAnalysis(null);
    } finally { setBusy(false); }
  };

  // Re-parsed on every mapping tweak, so the preview always describes what will
  // actually be written — not what the auto-detection first guessed.
  const parsed = useMemo<{ rows: ParsedImportRow[]; preview: ImportPreview } | null>(() => {
    if (!analysis) return null;
    return buildImportPreview(toRawRows(analysis.dataRows, mapping), existingNames, { defaultDirection, allowZeroAmount }, existingAccounts);
  }, [analysis, mapping, existingNames, existingAccounts, defaultDirection, allowZeroAmount]);

  // Only meaningful when the sheet itself never says which way the money went.
  const needsDirection = analysis !== null && !mapping.includes('direction');

  const cycleColumn = (col: number) => {
    tapLight();
    setMapping((prev) => {
      const next = [...prev];
      const at = CYCLE.indexOf(prev[col] ?? null);
      next[col] = CYCLE[(at + 1) % CYCLE.length] ?? null;
      return next;
    });
  };

  const runImport = async () => {
    setConfirmOpen(false);
    if (!parsed || busy) return;
    setBusy(true);
    try {
      // Rows whose account is already stored are skipped, so importing the same file a
      // second time is a no-op rather than a silent doubling of every loan in it.
      const result = await applyImport(db, parsed.rows, {
        sourceLabel: fileName ? `Excel: ${fileName}` : 'Excel import',
        skipIndexes: new Set(parsed.preview.duplicateAccountIndexes),
      });
      success();
      showSnackbar(c.importDone(result.accountsCreated), result.failures.length ? 'danger' : 'success');
      router.replace('/debt');
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/import', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  const p = parsed?.preview;
  const totalsMatch = !!p && p.excelTotalPaisa === p.parsedTotalPaisa;
  const canImport = !!p && p.validRows > 0 && !busy;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <DebtHeader title={c.importExcel} subtitle={c.pickFileHint} />

      <Card>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void pick()}
          style={({ pressed }) => StyleSheet.flatten([s.primary, busy && s.disabled, pressed && s.pressed])}
        >
          <AppIcon name="file-excel-outline" size={icon.sm} color={colors.onPrimary} />
          <Text style={s.primaryText}>{fileName ? c.pickFile : c.pickFile}</Text>
        </Pressable>
        {fileName ? <Text style={[s.listMeta, { marginTop: spacing.sm }]}>{fileName}</Text> : null}
        {busy && !analysis ? <ActivityIndicator style={{ marginTop: spacing.sm }} color={colors.primary} /> : null}
        {error ? <Text style={[s.statLabel, { color: accents.red.on, marginTop: spacing.sm }]}>{error}</Text> : null}
      </Card>

      {sheets.length > 1 ? (
        <Card title={c.sheet}>
          <View style={s.chipRow}>
            {sheets.map((sh, i) => (
              <Chip key={`${sh.name}-${i}`} label={sh.name} active={i === sheetIdx} onPress={() => openSheet(sheets, i)} />
            ))}
          </View>
        </Card>
      ) : null}

      {analysis ? (
        <>
          <Card title={c.columnMapping}>
            <Text style={s.listMeta}>
              {analysis.headerRowIndex >= 0 ? `${c.autoDetected} · ${bn ? 'সারি' : 'row'} ${bn ? asciiDigitsToBengali(String(analysis.headerRowIndex + 1)) : analysis.headerRowIndex + 1}` : c.noHeaderFound}
            </Text>
            <Text style={[s.listMeta, { marginBottom: spacing.sm }]}>{c.mappingHint}</Text>
            {analysis.headers.map((h, col) => (
              <Pressable
                key={`${h}-${col}`}
                accessibilityRole="button"
                accessibilityLabel={`${h || `#${col + 1}`}: ${fieldLabel(mapping[col] ?? null)}`}
                accessibilityHint={bn ? 'বদলাতে চাপুন' : 'Tap to change'}
                onPress={() => cycleColumn(col)}
                style={({ pressed }) => StyleSheet.flatten([s.listRow, pressed && s.pressed])}
              >
                <View style={s.grow}>
                  <Text numberOfLines={1} style={s.listTitle}>{h.trim() || `#${col + 1}`}</Text>
                  <Text numberOfLines={1} style={s.listMeta}>{analysis.dataRows[0]?.[col] || '—'}</Text>
                </View>
                <View style={[
                  s.badge,
                  mapping[col]
                    ? { backgroundColor: accents.blue.soft, borderColor: accents.blue.border }
                    : { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                ]}>
                  <Text style={[s.badgeText, { color: mapping[col] ? accents.blue.on : colors.textMuted }]}>{fieldLabel(mapping[col] ?? null)}</Text>
                </View>
              </Pressable>
            ))}
          </Card>

          {needsDirection ? (
            <Card title={c.sheetDirection}>
              <Text style={[s.listMeta, { marginBottom: spacing.sm }]}>{c.sheetDirectionHint}</Text>
              <View style={s.chipRow}>
                <Chip label={c.myDebts} active={defaultDirection === 'DEBT'} onPress={() => setDefaultDirection('DEBT')} />
                <Chip label={c.myReceivables} active={defaultDirection === 'RECEIVABLE'} onPress={() => setDefaultDirection('RECEIVABLE')} />
              </View>
            </Card>
          ) : null}

          {p && (p.missingAmount > 0 || allowZeroAmount) ? (
            <Card title={c.zeroAmountRows}>
              <View style={s.row}>
                <View style={s.grow}>
                  <Text numberOfLines={2} style={s.listTitle}>{c.keepZeroAmount}</Text>
                  <Text style={s.listMeta}>{c.keepZeroAmountHint}</Text>
                </View>
                <Switch
                  value={allowZeroAmount}
                  onValueChange={setAllowZeroAmount}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor={colors.surface}
                  accessibilityLabel={c.keepZeroAmount}
                />
              </View>
            </Card>
          ) : null}

          {p ? (
            <Card title={c.previewTitle}>
              <Stat label={c.totalRows} value={String(p.totalRows)} />
              <Stat label={c.validRows} value={String(p.validRows)} tone={accents.green} />
              <Stat label={c.myDebts} value={String(p.newDebts)} />
              <Stat label={c.myReceivables} value={String(p.newReceivables)} />
              <Stat label={c.newPeople} value={String(p.newPeople)} />
              <Stat label={c.duplicatePeople} value={String(p.duplicatePeople)} hint={bn ? 'নতুন করে তৈরি হবে না' : 'Will be reused, not duplicated'} />
              {p.duplicateAccounts > 0 ? (
                <Stat
                  label={bn ? 'আগেই আছে এমন হিসাব' : 'Accounts already here'}
                  value={bn ? asciiDigitsToBengali(String(p.duplicateAccounts)) : String(p.duplicateAccounts)}
                  hint={bn ? 'টিক তুলে রাখা হয়েছে — আবার যোগ হবে না' : 'Unticked — they will not be added again'}
                  tone={accents.orange}
                />
              ) : null}
              <Stat label={bn ? 'কিস্তি' : 'Instalments'} value={String(p.installments)} />
              {p.invalidDates ? <Stat label={c.invalidDates} value={String(p.invalidDates)} hint={bn ? 'লেখাটি নোটে রাখা হবে' : 'Kept as text on the record'} tone={accents.orange} /> : null}
              <Stat label={c.excelTotal} value={money(p.excelTotalPaisa)} />
              <Stat label={c.parsedTotal} value={money(p.parsedTotalPaisa)} tone={totalsMatch ? accents.green : accents.red} />
              <View style={[s.row, { marginTop: spacing.xs }]}>
                <AppIcon name={totalsMatch ? 'check-circle-outline' : 'alert-circle-outline'} size={icon.sm} color={totalsMatch ? accents.green.on : accents.red.on} />
                <Text style={[s.statLabel, s.grow, { color: totalsMatch ? accents.green.on : accents.red.on }]}>
                  {totalsMatch ? c.totalsMatch : c.totalsMismatch}
                </Text>
              </View>
            </Card>
          ) : null}

          {p && p.errorRows.length ? (
            <Card title={`${c.errorRows} · ${p.errorRows.length}`}>
              <Text style={[s.listMeta, { marginBottom: spacing.sm }]}>
                {bn ? 'এই সারিগুলো বাদ যাবে, বাকিগুলো যোগ হবে।' : 'These rows are skipped; the rest are still imported.'}
              </Text>
              {p.errorRows.slice(0, 20).map((er) => (
                <View key={er.index} style={s.statRow}>
                  <Text style={s.statLabel}>{bn ? 'সারি' : 'Row'} {er.index + 1}</Text>
                  <Text numberOfLines={1} style={[s.statValue, s.grow, { color: accents.red.on, textAlign: 'right' }]}>{er.errors.map(errorLabel).join(', ')}</Text>
                </View>
              ))}
            </Card>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={!canImport}
            onPress={() => setConfirmOpen(true)}
            style={({ pressed }) => StyleSheet.flatten([s.primary, !canImport && s.disabled, pressed && s.pressed])}
          >
            <AppIcon name="database-import-outline" size={icon.sm} color={colors.onPrimary} />
            <Text style={s.primaryText}>{busy ? c.importing : c.confirmImport}</Text>
          </Pressable>
        </>
      ) : !busy && !error ? (
        <EmptyNote icon="file-table-outline" text={c.noSheetYet} />
      ) : null}

      <AppConfirmDialog
        visible={confirmOpen}
        title={c.confirmImport}
        description={p ? `${p.validRows} ${bn ? 'সারি যোগ হবে' : 'rows will be added'} · ${money(p.parsedTotalPaisa)}` : ''}
        confirmLabel={c.confirmImport}
        cancelLabel={c.cancel}
        icon="alert"
        onConfirm={() => void runImport()}
        onCancel={() => setConfirmOpen(false)}
      />
    </ScrollView>
  );
}
