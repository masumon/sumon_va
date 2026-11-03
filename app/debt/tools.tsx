import { useCallback, useState } from 'react';
import { asciiDigitsToBengali } from '../../src/services/debt/money';
import { formatBangladeshDate } from '../../src/i18n/date-time';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../src/ui/AppText';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppFeedback } from '../../src/ui/AppFeedback';
import { getDebtConsolidation, type DebtConsolidation } from '../../src/services/debt/statements';
import { shareDebtExport, type DebtExportKind } from '../../src/services/debt/port';
import { AppIcon, type IconName } from '../../src/ui/AppIcon';
import { Card, DebtHeader, Stat, useDebt } from '../../src/ui/DebtKit';
import { success, warn } from '../../src/ui/haptics';
import { icon, spacing } from '../../src/theme';
import { logAppError } from '../../src/services/error-log';

const EXPORTS: { kind: DebtExportKind; icon: IconName; bn: string; en: string }[] = [
  { kind: 'accounts', icon: 'wallet-outline', bn: 'হিসাবসমূহ', en: 'Accounts' },
  { kind: 'ledger', icon: 'book-open-outline', bn: 'খতিয়ান', en: 'Ledger' },
  { kind: 'people', icon: 'account-multiple-outline', bn: 'মানুষজন', en: 'People' },
];

export default function DebtTools() {
  const db = useSQLiteContext();
  const { s, c, bn, colors, accents, money , language } = useDebt();
  const fmtDate = (value: string | null | undefined) => (value ? formatBangladeshDate(value, language) : '—');
  const { showSnackbar } = useAppFeedback();

  const [consolidation, setConsolidation] = useState<DebtConsolidation | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setConsolidation(await getDebtConsolidation(db));
    } catch { setConsolidation(null); }
    finally { setReady(true); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const doExport = async (kind: DebtExportKind) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await shareDebtExport(db, kind);
      if (result === 'unavailable') showSnackbar(bn ? 'শেয়ার করা যাচ্ছে না' : 'Sharing unavailable', 'danger');
      else success();
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/tools', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  if (!ready) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <DebtHeader title={c.tools} subtitle={bn ? 'সেটিংস, রপ্তানি ও সারসংক্ষেপ' : 'Settings, export and summary'} />

      <Card title={bn ? 'সেটিংস' : 'Settings'}>
        <Text style={s.listMeta}>
          {bn
            ? 'রিমাইন্ডার চালু/বন্ধ, তার সময় আর শুরুর দেনা — সবই এখন অ্যাপের সেটিংসে, বাকি সব সেটিংসের সঙ্গে।'
            : 'Reminders, their time and your starting debt now live in the app\u2019s Settings, alongside everything else.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings' as never)}
          style={({ pressed }) => StyleSheet.flatten([s.ghost, { marginTop: spacing.sm }, pressed && s.pressed])}
        >
          <AppIcon name="cog-outline" size={icon.sm} color={colors.primary} />
          <Text style={s.ghostText}>{bn ? 'সেটিংসে যান' : 'Open Settings'}</Text>
        </Pressable>
      </Card>

      {consolidation && consolidation.count > 0 ? (
        <Card title={bn ? 'দেনার সারসংক্ষেপ' : 'Debt summary'}>
          <Stat label={c.activeDebts} value={bn ? asciiDigitsToBengali(String(consolidation.count)) : String(consolidation.count)} />
          <Stat label={c.outstandingDebt} value={money(consolidation.totalRemainingPaisa)} tone={accents.red} />
          <Stat label={bn ? 'গড়' : 'Average'} value={money(consolidation.averagePaisa)} />
          <Stat label={bn ? 'সবচেয়ে বড়' : 'Largest'} value={money(consolidation.largestPaisa)} />
          <Stat label={bn ? 'সবচেয়ে ছোট' : 'Smallest'} value={money(consolidation.smallestPaisa)} />
          <Stat label={bn ? 'এ মাসের কিস্তি' : 'This month due'} value={money(consolidation.monthlyObligationPaisa)} tone={accents.orange} />
          <Stat label={bn ? 'নিকটতম তারিখ' : 'Earliest due'} value={fmtDate(consolidation.earliestDueDate)} />
        </Card>
      ) : null}

      <Card title={c.exportCsv}>
        <Text style={s.listMeta}>{bn ? 'ফাইলটি আপনার ফোনেই তৈরি হয় — কোথাও পাঠানো হয় না।' : 'The file is built on your device — nothing is uploaded.'}</Text>
        <View style={[s.chipRow, { marginTop: spacing.sm }]}>
          {EXPORTS.map((e) => (
            <Pressable
              key={e.kind}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void doExport(e.kind)}
              style={({ pressed }) => StyleSheet.flatten([s.ghost, busy && s.disabled, pressed && s.pressed])}
            >
              <AppIcon name={e.icon} size={icon.sm} color={colors.primary} />
              <Text style={s.ghostText}>{bn ? e.bn : e.en}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card title={c.importExcel}>
        <Text style={s.listMeta}>{c.pickFileHint}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/debt/import' as never)}
          style={({ pressed }) => StyleSheet.flatten([s.primary, { marginTop: spacing.sm }, pressed && s.pressed])}
        >
          <AppIcon name="file-excel-outline" size={icon.sm} color={colors.onPrimary} />
          <Text style={s.primaryText}>{c.importExcel}</Text>
        </Pressable>
      </Card>

    </ScrollView>
  );
}
