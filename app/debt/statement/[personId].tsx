import { useCallback, useState } from 'react';
import { formatBangladeshDate } from '../../../src/i18n/date-time';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../../src/ui/AppText';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { getPersonStatement, type PersonStatement } from '../../../src/services/debt/statements';
import { sharePersonStatement } from '../../../src/services/debt/port';
import { useAppFeedback } from '../../../src/ui/AppFeedback';
import { success, warn } from '../../../src/ui/haptics';
import { AppIcon } from '../../../src/ui/AppIcon';
import { Card, DebtHeader, EmptyNote, Stat, useDebt } from '../../../src/ui/DebtKit';
import { icon, spacing } from '../../../src/theme';
import { logAppError } from '../../../src/services/error-log';

export default function PersonStatementScreen() {
  const db = useSQLiteContext();
  const { personId } = useLocalSearchParams<{ personId?: string }>();
  const { s, c, bn, colors, accents, money, language } = useDebt();
  const fmtDate = (value: string | null | undefined) => (value ? formatBangladeshDate(value, language) : '—');
  const { showSnackbar } = useAppFeedback();

  const [st, setSt] = useState<PersonStatement | null>(null);
  const [ready, setReady] = useState(false);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    if (!personId) { setReady(true); return; }
    try { setSt(await getPersonStatement(db, personId)); }
    catch { setSt(null); }
    finally { setReady(true); }
  }, [db, personId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!ready) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!st) {
    return (
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <DebtHeader title={c.statement} />
        <EmptyNote icon="account-off-outline" text={bn ? 'ব্যক্তি পাওয়া যায়নি' : 'Person not found'} />
      </ScrollView>
    );
  }

  // netToYou > 0 means they owe you more than you owe them.
  const netTone = st.netToYouPaisa >= 0 ? accents.green : accents.red;

  // The statement's real job is to be handed to the other person, so it leaves the app
  // as plain text: it pastes into WhatsApp or SMS with no viewer and no network.
  const share = async () => {
    if (!personId || sharing) return;
    setSharing(true);
    try {
      const result = await sharePersonStatement(db, personId, language === 'bn' ? 'bn' : 'en');
      if (result === 'shared') success();
      else { warn(); showSnackbar(bn ? 'শেয়ার করা যাচ্ছে না' : 'Sharing is unavailable', 'danger'); }
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/statement/personId', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setSharing(false); }
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <DebtHeader
        title={st.person.name}
        subtitle={st.person.phone ?? c.statement}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'হিসাব পাঠান' : 'Share statement'}
            accessibilityState={{ busy: sharing }}
            disabled={sharing}
            onPress={() => void share()}
            style={({ pressed }) => StyleSheet.flatten([s.ghost, sharing && s.disabled, pressed && s.pressed])}
          >
            {sharing
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <AppIcon name="share-variant-outline" size={icon.sm} color={colors.primary} />}
            <Text style={s.ghostText}>{bn ? 'পাঠান' : 'Share'}</Text>
          </Pressable>
        }
      />

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/debt/person/${personId}` as never)}
        style={({ pressed }) => StyleSheet.flatten([s.ghost, { marginBottom: spacing.md }, pressed && s.pressed])}
      >
        <AppIcon name="pencil-outline" size={icon.sm} color={colors.primary} />
        <Text style={s.ghostText}>{c.editPerson}</Text>
      </Pressable>

      <Card>
        <Text style={[s.big, { color: netTone.on }]}>{money(Math.abs(st.netToYouPaisa))}</Text>
        <Text style={s.bigLabel}>
          {st.netToYouPaisa >= 0
            ? (bn ? 'সে আপনাকে দেবে' : 'They owe you')
            : (bn ? 'আপনি তাকে দেবেন' : 'You owe them')}
        </Text>
        <View style={{ marginTop: spacing.sm }}>
          <Stat label={c.outstandingDebt} value={money(st.totalDebtRemainingPaisa)} tone={accents.red} />
          <Stat label={c.outstandingReceivable} value={money(st.totalReceivableRemainingPaisa)} tone={accents.green} />
          <Stat label={c.totalPaid} value={money(st.totalPaidToThemPaisa)} />
          <Stat label={c.totalReceived} value={money(st.totalReceivedFromThemPaisa)} />
          <Stat label={bn ? 'সর্বশেষ লেনদেন' : 'Last transaction'} value={st.lastTransactionDate ?? '—'} />
          <Stat label={bn ? 'পরবর্তী তারিখ' : 'Next due'} value={st.nextDueDate ?? '—'} />
        </View>
      </Card>

      <Card title={`${c.myDebts} · ${c.myReceivables}`}>
        {st.accounts.length === 0 ? (
          <Text style={s.statLabel}>{c.noDebts}</Text>
        ) : st.accounts.map(({ account: a, balance: b }) => {
          const tone = a.direction === 'DEBT' ? accents.red : accents.green;
          return (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              onPress={() => router.push(`/debt/account/${a.id}` as never)}
              style={({ pressed }) => StyleSheet.flatten([s.listRow, pressed && s.pressed])}
            >
              <View style={[s.badge, { backgroundColor: tone.soft, borderColor: tone.border }]}>
                <Text style={[s.badgeText, { color: tone.on }]}>{c.status[b.status]}</Text>
              </View>
              <View style={s.grow}>
                <Text numberOfLines={1} style={s.listTitle}>{a.title || (a.direction === 'DEBT' ? c.totalDebt : c.totalReceivable)}</Text>
                <Text numberOfLines={1} style={s.listMeta}>{c.remaining} {money(b.remainingPaisa)} · {c.paid} {money(b.paidPaisa)}</Text>
              </View>
              <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
            </Pressable>
          );
        })}
      </Card>

      <Card title={c.ledger}>
        {st.transactions.length === 0 ? (
          <Text style={s.statLabel}>{bn ? 'কোনো লেনদেন নেই' : 'No transactions'}</Text>
        ) : st.transactions.slice(0, 50).map((t) => (
          <View key={t.id} style={[s.statRow, t.reversed && s.disabled]}>
            <View style={s.grow}>
              <Text style={s.listMeta}>{fmtDate(t.txnDate)} · {t.kind}</Text>
            </View>
            <Text numberOfLines={1} style={s.listAmt}>{money(t.amountPaisa)}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}
