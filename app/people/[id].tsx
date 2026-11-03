// One person, whole.
//
// Where you stand with them, everything that has passed between you in one timeline, and
// the two buttons that matter — call and message — which also write down that you did.
//
// The timeline mixes sources deliberately. A loan, a repayment, an expense and a phone
// call are different tables but the same story, and the only place that story exists is
// here; every other screen sees a slice of it.

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../../src/ui/AppText';
import { AppIcon } from '../../src/ui/AppIcon';
import { Card, EmptyNote, ScreenHeader, useKit } from '../../src/ui/AppKit';
import { useAppFeedback , AppConfirmDialog } from '../../src/ui/AppFeedback';
import { asciiDigitsToBengali, formatPaisa } from '../../src/services/debt/money';
import { personStanding, type PersonStanding } from '../../src/services/person-view-service';
import { reachOut } from '../../src/services/follow-up-service';
import { deletePerson, PersonHasRecordsError } from '../../src/services/people-service';

import { formatBangladeshWeekdayDate } from '../../src/i18n/date-time';
import { txnKindLabel } from '../../src/i18n/debt';
import { border, icon as iconSize, layout, radius, spacing, typography, type ThemeColors } from '../../src/theme';
import { success, tapLight, warn } from '../../src/ui/haptics';
import { ReportButton } from '../../src/ui/ReportButton';
import { personReport } from '../../src/services/module-reports';

export default function PersonScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn, language } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const s = useMemo(() => makeStyles(colors), [colors]);
  const params = useLocalSearchParams<{ id?: string }>();
  // Removing a person was only possible from inside the debt module, so a contact added
  // here could never be taken back from here.
  const remove = useCallback(async () => {
    setConfirmRemove(false);
    try {
      await deletePerson(db, String(params.id));
      success();
      showSnackbar(bn ? 'তালিকা থেকে সরানো হয়েছে' : 'Removed from your list', 'success');
      router.back();
    } catch (error) {
      warn();
      showSnackbar(
        error instanceof PersonHasRecordsError
          ? (bn ? 'এই ব্যক্তির খোলা হিসাব আছে — আগে সেগুলো মিটিয়ে নিন' : 'This person still has open accounts — settle those first')
          : (bn ? 'সরানো গেল না' : 'Could not remove'),
        'danger',
      );
    }
  }, [db, params.id, bn, showSnackbar]);

  const personId = typeof params.id === 'string' ? params.id : '';

  const [standing, setStanding] = useState<PersonStanding | null>(null);
  const [ready, setReady] = useState(false);

  const money = useCallback((paisa: number) => formatPaisa(paisa, { bnDigits: bn }), [bn]);
  const digits = useCallback((v: string | number) => (bn ? asciiDigitsToBengali(String(v)) : String(v)), [bn]);

  const load = useCallback(async () => {
    try { setStanding(await personStanding(db, personId)); }
    catch { setStanding(null); }
    finally { setReady(true); }
  }, [db, personId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Calling and messaging both record that a reminder was given — which is the part that
  // survives when the amount is disputed a year later.
  const contact = useCallback(async (channel: 'CALL' | 'SMS') => {
    const phone = standing?.person.phone;
    if (!phone) {
      warn();
      showSnackbar(bn ? 'এই নামে কোনো ফোন নম্বর নেই' : 'No phone number for them', 'danger');
      return;
    }
    tapLight();
    const owed = standing?.netPaisa ?? 0;
    const message = owed > 0
      ? (bn ? `আসসালামু আলাইকুম। ${money(owed)} টাকার বিষয়ে একটু কথা বলতে চাই।` : `Hello — about the ${money(owed)} outstanding.`)
      : undefined;
    const result = await reachOut(db, {
      ownerType: 'PERSON',
      ownerId: personId,
      phone,
      channel,
      message,
      note: bn ? 'অ্যাপ থেকে' : 'from the app',
    });
    if (result.status === 'opened') { success(); await load(); }
    else {
      warn();
      showSnackbar(bn ? 'খোলা গেল না' : 'Could not open it', 'danger');
    }
  }, [db, personId, standing, bn, money, showSnackbar, load]);

  if (ready && !standing) {
    return (
      <ScrollView style={s.root} contentContainerStyle={s.content}>
        <ScreenHeader title={bn ? 'মানুষ' : 'Person'} backTo="/people" backLabel={bn ? 'মানুষ' : 'People'} />
        <EmptyNote icon="account-off-outline" text={bn ? 'এই ব্যক্তিকে আর পাওয়া যাচ্ছে না।' : 'That person is no longer here.'} />
      </ScrollView>
    );
  }

  const net = standing?.netPaisa ?? 0;
  const tone = net > 0 ? accents.green : net < 0 ? accents.red : accents.blue;
  const person = standing?.person;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <ScreenHeader
        title={person?.name ?? (bn ? 'মানুষ' : 'Person')}
        subtitle={person?.phone ?? undefined}
        backTo="/people"
        backLabel={bn ? 'মানুষ' : 'People'}
      />

      {params.id ? <ReportButton build={(d, l) => personReport(d, l, params.id!)} label={bn ? 'এই ব্যক্তির রিপোর্ট' : 'Report on this person'} /> : null}

      {/* Where you stand — one number, said in words. */}
      <View style={[s.hero, { backgroundColor: tone.soft }]}>
        <Text style={[s.heroLabel, { color: tone.on }]}>
          {net > 0 ? (bn ? 'আপনি পাবেন' : 'They owe you')
            : net < 0 ? (bn ? 'আপনি দেবেন' : 'You owe them')
            : (bn ? 'হিসাব পরিষ্কার' : 'All settled')}
        </Text>
        <Text numberOfLines={1} style={[s.heroValue, { color: tone.on }]}>{money(Math.abs(net))}</Text>
        {standing && (standing.openAccounts || standing.contactCount) ? (
          <Text style={s.heroHint}>
            {[
              standing.openAccounts
                ? (bn ? `${digits(standing.openAccounts)}টি চলমান হিসাব` : `${standing.openAccounts} open`)
                : null,
              standing.contactCount
                ? (bn ? `${digits(standing.contactCount)} বার তাগাদা` : `chased ${standing.contactCount}×`)
                : null,
            ].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>

      {/* The two buttons that matter, and the record they leave behind. */}
      <View style={s.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bn ? 'কল করুন' : 'Call'}
          onPress={() => void contact('CALL')}
          style={({ pressed }) => StyleSheet.flatten([s.action, { borderColor: accents.green.on }, pressed && s.pressed])}
        >
          <AppIcon name="phone-outline" size={iconSize.md} color={accents.green.on} />
          <Text numberOfLines={1} style={[s.actionText, { color: accents.green.on }]}>{bn ? 'কল' : 'Call'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bn ? 'এসএমএস' : 'Message'}
          onPress={() => void contact('SMS')}
          style={({ pressed }) => StyleSheet.flatten([s.action, { borderColor: accents.blue.on }, pressed && s.pressed])}
        >
          <AppIcon name="message-text-outline" size={iconSize.md} color={accents.blue.on} />
          <Text numberOfLines={1} style={[s.actionText, { color: accents.blue.on }]}>{bn ? 'এসএমএস' : 'Message'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bn ? 'হিসাব যোগ' : 'Add an entry'}
          onPress={() => { tapLight(); router.push('/finance/new' as never); }}
          style={({ pressed }) => StyleSheet.flatten([s.action, { borderColor: accents.orange.on }, pressed && s.pressed])}
        >
          <AppIcon name="plus" size={iconSize.md} color={accents.orange.on} />
          <Text numberOfLines={1} style={[s.actionText, { color: accents.orange.on }]}>{bn ? 'হিসাব' : 'Entry'}</Text>
        </Pressable>
      </View>

      {/* What is known about them, only where something is actually known. */}
      {person && (person.email || person.address || person.relationship) ? (
        <Card title={bn ? 'যোগাযোগ' : 'Contact'}>
          {[
            { icon: 'email-outline' as const, value: person.email },
            { icon: 'map-marker-outline' as const, value: person.address },
            { icon: 'account-heart-outline' as const, value: person.relationship },
          ].filter((row) => row.value).map((row) => (
            <View key={row.icon} style={s.detailRow}>
              <AppIcon name={row.icon} size={iconSize.sm} color={colors.textMuted} />
              <Text style={s.detailText}>{row.value}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {standing && (standing.receivedPaisa || standing.givenPaisa) ? (
        <Card title={bn ? 'হাতবদল' : 'Money between you'}>
          <View style={s.splitRow}>
            <View style={s.grow}>
              <Text style={s.splitLabel}>{bn ? 'তার কাছ থেকে পেয়েছেন' : 'Received from them'}</Text>
              <Text numberOfLines={1} style={[s.splitValue, { color: accents.green.on }]}>{money(standing.receivedPaisa)}</Text>
            </View>
            <View style={s.grow}>
              <Text style={s.splitLabel}>{bn ? 'তাকে দিয়েছেন' : 'Given to them'}</Text>
              <Text numberOfLines={1} style={[s.splitValue, { color: accents.orange.on }]}>{money(standing.givenPaisa)}</Text>
            </View>
          </View>
        </Card>
      ) : null}

      {/* The timeline: four tables, one story. */}
      <Text style={s.section}>{bn ? 'যা যা হয়েছে' : 'What has passed between you'}</Text>
      {standing?.events.length ? (
        standing.events.slice(0, 40).map((event) => {
          const amount = event.amountPaisa ?? 0;
          const eventTone = event.source === 'followUp' ? accents.purple
            : amount > 0 ? accents.green
            : amount < 0 ? accents.red
            : accents.blue;
          const glyph = event.source === 'followUp'
            ? (event.title === 'CALL' ? 'phone-outline' : 'message-text-outline')
            : event.source === 'finance' ? 'swap-vertical' : 'wallet-outline';
          return (
            <Pressable
              key={event.id}
              accessibilityRole="button"
              disabled={!event.route}
              onPress={() => { if (event.route) { tapLight(); router.push(event.route as never); } }}
              style={({ pressed }) => StyleSheet.flatten([s.event, pressed && event.route && s.pressed])}
            >
              <View style={[s.eventIcon, { backgroundColor: eventTone.soft }]}>
                <AppIcon name={glyph} size={iconSize.sm} color={eventTone.on} />
              </View>
              <View style={s.grow}>
                <Text numberOfLines={1} style={s.eventTitle}>{event.source === 'debt' ? txnKindLabel(event.title, language) : eventLabel(event.title, bn)}</Text>
                <Text numberOfLines={1} style={s.eventMeta}>
                  {[formatBangladeshWeekdayDate(new Date(event.at), language), event.subtitle].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {event.amountPaisa !== undefined ? (
                <Text numberOfLines={1} style={[s.eventAmount, { color: eventTone.on }]}>
                  {`${amount >= 0 ? '+' : '−'} ${money(Math.abs(amount))}`}
                </Text>
              ) : null}
            </Pressable>
          );
        })
      ) : (
        <EmptyNote
          icon="timeline-text-outline"
          text={bn ? 'এখনো কিছু হয়নি। দেনা, হিসাব বা কল — যা-ই করবেন এখানে জমা হবে।' : 'Nothing yet. Debts, entries and calls all collect here.'}
        />
      )}
      {/* Their name, number and address are here because the user typed them. Taking
          that back has to be possible from the same screen. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bn ? 'তালিকা থেকে সরান' : 'Remove from list'}
        onPress={() => { tapLight(); setConfirmRemove(true); }}
        style={({ pressed }) => StyleSheet.flatten([s.remove, pressed && s.pressed])}
      >
        <AppIcon name="delete-outline" size={iconSize.sm} color={accents.red.on} />
        <Text numberOfLines={1} style={[s.removeText, { color: accents.red.on }]}>
          {bn ? 'তালিকা থেকে সরান' : 'Remove from list'}
        </Text>
      </Pressable>

      <AppConfirmDialog
        visible={confirmRemove}
        title={bn ? 'তালিকা থেকে সরাবেন?' : 'Remove from your list?'}
        description={bn ? 'নাম, নম্বর ও ঠিকানা সরে যাবে। পরে আবার যোগ করা যাবে।' : 'The name, number and address go. You can add them again later.'}
        confirmLabel={bn ? 'সরান' : 'Remove'}
        cancelLabel={bn ? 'বাতিল' : 'Cancel'}
        danger
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void remove()}
      />
    </ScrollView>
  );
}

/** The ledger's kind words, said the way a person says them. */
function eventLabel(raw: string, bn: boolean): string {
  if (!bn) return raw;
  const map: Record<string, string> = {
    CALL: 'কল করেছেন',
    SMS: 'এসএমএস পাঠিয়েছেন',
    MEET: 'দেখা হয়েছে',
    NOTE: 'নোট',
    REPAYMENT: 'শোধ করেছেন',
    COLLECTION: 'আদায় হয়েছে',
    DISBURSEMENT: 'দিয়েছেন',
    ADJUSTMENT: 'সংশোধন',
    INTEREST: 'সুদ',
  };
  return map[raw] ?? raw;
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    grow: { flex: 1, minWidth: 0 },
    hero: { borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
    heroLabel: { ...typography.caption, fontWeight: '800' },
    heroValue: { ...typography.display, fontWeight: '700', marginTop: 2, flexShrink: 1 },
    heroHint: { color: colors.textSecondary, ...typography.caption, marginTop: spacing.xs },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    action: { flex: 1, minHeight: 64, borderRadius: radius.lg, borderWidth: border.thin, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: spacing.xs },
    actionText: { ...typography.caption, fontWeight: '800', flexShrink: 1 },
    detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget - 8 },
    detailText: { flex: 1, minWidth: 0, color: colors.textSecondary, ...typography.bodySmall },
    splitRow: { flexDirection: 'row', gap: spacing.md },
    splitLabel: { color: colors.textSecondary, ...typography.caption, fontWeight: '700' },
    splitValue: { ...typography.callout, fontWeight: '800', marginTop: 2, flexShrink: 1 },
    section: { color: colors.textPrimary, ...typography.section, fontWeight: '800', marginTop: spacing.lg, marginBottom: spacing.sm },
    event: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget + 8, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs },
    eventIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    eventTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    eventMeta: { color: colors.textMuted, ...typography.caption, marginTop: 1 },
    eventAmount: { ...typography.caption, fontWeight: '800', flexShrink: 1 },
    remove: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: layout.minTouchTarget, marginTop: spacing.xl, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, paddingHorizontal: spacing.md },
    removeText: { ...typography.caption, fontWeight: '800', flexShrink: 1 },
    pressed: { opacity: 0.78 },
  });
}
