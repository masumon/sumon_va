// "Give me this as a PDF."
//
// One button, used by every module, so a report is the same gesture wherever you are:
// tap, wait a moment, the PDF is in Apon/Reports and a notification opens it. The screen only
// has to say which report to build — nothing about printing, saving or error handling is
// repeated. The first tap ever asks which folder to use; no tap after it asks anything.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from './AppText';
import { AppIcon } from './AppIcon';
import { useKit } from './AppKit';
import { useAppFeedback } from './AppFeedback';
import { makeAndShareReport, type ReportDocument } from '../services/report-service';
import type { AppLanguage } from '../i18n/date-time';
import { border, control, icon as iconSize, radius, spacing, typography } from '../theme';
import { success, tapLight, warn } from './haptics';
import type { SQLiteDatabase } from 'expo-sqlite';
import { notifyDownloaded } from '../services/download-notification';

export function ReportButton({
  build, label,
}: {
  /** Given the database and the language, produce the document to print. */
  build: (db: SQLiteDatabase, language: AppLanguage) => Promise<ReportDocument>;
  label?: string;
}) {
  const db = useSQLiteContext();
  const { colors, bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (busy) return;
    tapLight();
    setBusy(true);
    try {
      const doc = await build(db, bn ? 'bn' : 'en');
      const result = await makeAndShareReport(doc, bn ? 'bn' : 'en', db);
      if (result.ok) {
        success();
        // A silent download needs a word, or nothing visibly happened at all. The file
        // name is in the message on purpose: it is what the person will look for in their
        // file manager. The share sheet, when it appears, is its own confirmation — a
        // snackbar underneath it would just be noise.
        if (result.downloaded) {
          showSnackbar(
            bn ? `ডাউনলোড হয়েছে · ${result.name}` : `Downloaded · ${result.name}`,
            'success',
          );
          // Like a browser download: a notification to open it later, from anywhere.
          if (result.uri && result.name) void notifyDownloaded(result.uri, result.name, bn ? 'bn' : 'en');
        } else if (!result.shared) {
          showSnackbar(
            result.saved
              ? (bn ? 'রিপোর্ট সেভ হয়েছে' : 'Report saved')
              : (bn ? 'রিপোর্ট তৈরি হয়েছে' : 'Report ready'),
            'success',
          );
        }
      } else {
        warn();
        showSnackbar(
          result.reason === 'nothing-to-report'
            ? (bn ? 'রিপোর্টে দেওয়ার মতো কিছু নেই এখনো' : 'There is nothing to report yet')
            : (bn ? 'রিপোর্ট তৈরি করা যায়নি' : 'Could not make the report'),
          'danger',
        );
      }
    } catch {
      warn();
      showSnackbar(bn ? 'রিপোর্ট তৈরি করা যায়নি' : 'Could not make the report', 'danger');
    } finally {
      setBusy(false);
    }
  }, [build, busy, db, bn, showSnackbar]);

  const s = styles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy }}
      accessibilityLabel={label ?? (bn ? 'PDF রিপোর্ট বানান ও ডাউনলোড করুন' : 'Make a PDF report and download it')}
      disabled={busy}
      onPress={() => void run()}
      style={({ pressed }) => StyleSheet.flatten([s.btn, (pressed || busy) && s.pressed])}
    >
      {busy
        ? <ActivityIndicator color={colors.primary} />
        : <AppIcon name="file-pdf-box" size={iconSize.sm} color={colors.primary} />}
      <Text numberOfLines={1} style={s.text}>
        {label ?? (bn ? 'PDF রিপোর্ট' : 'PDF report')}
      </Text>
    </Pressable>
  );
}

const styles = (colors: { surfaceMuted: string; border: string; primary: string }) => StyleSheet.create({
  btn: {
    minHeight: control.buttonHeight, marginVertical: spacing.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.md,
    borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surfaceMuted,
  },
  text: { color: colors.primary, ...typography.meta, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
