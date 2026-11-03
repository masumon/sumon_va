// One entry of আয়-ব্যয়, read-only.
//
// Tapping a line in the money book used to drop straight into the edit form, which put a
// keyboard and a save button in front of someone who only wanted to check what a number
// was. Reading and changing are different intentions and now they are different screens:
// this one answers "what is this entry", and the two buttons at the bottom are where a
// change starts.
//
// Nothing here writes. Delete is the one destructive act and it asks first.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../../../src/ui/AppText';
import { AppIcon } from '../../../src/ui/AppIcon';
import { Card, EmptyNote, ScreenHeader, Stat, useKit } from '../../../src/ui/AppKit';
import { AppConfirmDialog, useAppFeedback } from '../../../src/ui/AppFeedback';
import { formatPaisa } from '../../../src/services/debt/money';
import { bangladeshDateKey, formatDayKey } from '../../../src/i18n/date-time';
import { deleteEntry, fundSourceLabel, getCategoryNeed, getEntry, type FinanceEntry, type Need } from '../../../src/services/finance-service';
import { hasLinkedDebtTransaction, removeDebtTransactionForDeletedFinanceEntry } from '../../../src/services/money-bridge';
import { listWallets, type Wallet } from '../../../src/services/wallet-service';
import { listAttachments, shareAttachment, type Attachment } from '../../../src/services/attachment-service';
import { FileGallery } from '../../../src/ui/FileGallery';
import { getPlace } from '../../../src/services/place-service';
import { describePlace } from '../../../src/services/capture/place';
import { icon as iconSize, spacing } from '../../../src/theme';
import { success, tapLight, warn } from '../../../src/ui/haptics';

const OWNER = 'FINANCE_ENTRY';

const needLabel = (n: Need, bn: boolean) =>
  bn ? { ESSENTIAL: 'অপরিহার্য', NEEDED: 'দরকারি', WANT: 'শখ' }[n]
    : { ESSENTIAL: 'Essential', NEEDED: 'Needed', WANT: 'A want' }[n];

const recurrenceLabel = (r: string, bn: boolean) =>
  (bn
    ? ({ DAILY: 'প্রতিদিন', WEEKLY: 'প্রতি সপ্তাহে', MONTHLY: 'প্রতি মাসে', YEARLY: 'প্রতি বছরে' } as Record<string, string>)
    : ({ DAILY: 'Every day', WEEKLY: 'Every week', MONTHLY: 'Every month', YEARLY: 'Every year' } as Record<string, string>))[r] ?? r;

export default function FinanceEntryScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { s, colors, accents, bn, language } = useKit();
  const { showSnackbar } = useAppFeedback();

  const [entry, setEntry] = useState<FinanceEntry | null>(null);
  const [need, setNeed] = useState<Need | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [linkedToDebt, setLinkedToDebt] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setReady(true); return; }
    try {
      const found = await getEntry(db, id);
      setEntry(found);
      if (found) {
        // Everything below the entry itself is decoration: if one of these lookups fails
        // the screen still answers the question it was opened for, so none of them throws.
        const [n, wallets, files, place, debtLinked] = await Promise.all([
          getCategoryNeed(db, found.category).catch(() => null),
          found.walletId ? listWallets(db, true).catch(() => [] as Wallet[]) : Promise.resolve([] as Wallet[]),
          listAttachments(db, OWNER, id).catch(() => [] as Attachment[]),
          getPlace(db, OWNER, id).catch(() => null),
          hasLinkedDebtTransaction(db, id).catch(() => false),
        ]);
        setNeed(n);
        setWallet(wallets.find((w) => w.id === found.walletId) ?? null);
        setPhotos(files);
        setPlaceLabel(place ? describePlace(place, bn ? 'bn' : 'en') : null);
        setLinkedToDebt(debtLinked);
      }
    } catch { setEntry(null); }
    finally { setReady(true); }
  }, [db, id, bn]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const remove = async () => {
    setConfirmOpen(false);
    if (!id || busy) return;
    setBusy(true);
    try {
      await deleteEntry(db, id);
      // If this entry is the wallet side of a debt payment or collection, deleting it means
      // that money never left (or arrived) after all — the ledger reduction it caused has
      // to be undone too, or the debt account stays reduced by a payment that no longer
      // exists anywhere.
      await removeDebtTransactionForDeletedFinanceEntry(db, id, bangladeshDateKey(new Date())).catch(() => {});
      success();
      showSnackbar(bn ? 'মুছে ফেলা হয়েছে' : 'Deleted', 'success');
      router.back();
    } catch {
      warn();
      showSnackbar(bn ? 'মোছা যায়নি' : 'Could not delete', 'danger');
    } finally { setBusy(false); }
  };

  if (!ready) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;

  if (!entry) {
    return (
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <ScreenHeader title={bn ? 'হিসাব' : 'Entry'} backTo="/finance" backLabel={bn ? 'আয়-ব্যয়' : 'Money'} />
        <EmptyNote icon="notebook-outline" text={bn ? 'হিসাবটি পাওয়া যায়নি — মুছে ফেলা হয়ে থাকতে পারে।' : 'Entry not found — it may have been deleted.'} />
      </ScrollView>
    );
  }

  const income = entry.kind === 'INCOME';
  const tone = income ? accents.green : accents.orange;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        title={entry.category}
        subtitle={`${income ? (bn ? 'আয়' : 'Income') : (bn ? 'ব্যয়' : 'Expense')} · ${formatDayKey(entry.occurredAt, language)}`}
        backTo="/finance"
        backLabel={bn ? 'আয়-ব্যয়' : 'Money'}
      />

      <Card>
        <Text style={[s.big, { color: tone.on }]}>{`${income ? '+' : '−'} ${formatPaisa(entry.amountPaisa, { bnDigits: bn })}`}</Text>
        <Text style={s.bigLabel}>{income ? (bn ? 'যা এসেছে' : 'What came in') : (bn ? 'যা গিয়েছে' : 'What went out')}</Text>
        <View style={{ marginTop: spacing.sm }}>
          <Stat label={bn ? 'তারিখ' : 'Date'} value={formatDayKey(entry.occurredAt, language)} />
          <Stat label={bn ? 'খাত' : 'Category'} value={entry.category} />
          {need ? <Stat label={bn ? 'কতটা দরকারি' : 'How needed'} value={needLabel(need, bn)} /> : null}
          {entry.method ? <Stat label={bn ? 'মাধ্যম' : 'Method'} value={entry.method} /> : null}
          {wallet ? <Stat label={bn ? 'মানিব্যাগ' : 'Wallet'} value={wallet.name} /> : null}
          {/* Whose money it was — the user's own words when they picked "অন্যান্য". */}
          {entry.fundNote || entry.fundSource ? (
            <Stat label={bn ? 'উৎস' : 'Source'} value={entry.fundNote || (entry.fundSource ? fundSourceLabel(entry.fundSource, bn) : '')} />
          ) : null}
          {entry.personName ? <Stat label={bn ? 'কার সাথে' : 'Person'} value={entry.personName} /> : null}
          {entry.recurring && entry.recurring !== 'NONE' ? <Stat label={bn ? 'পুনরাবৃত্তি' : 'Repeats'} value={recurrenceLabel(entry.recurring, bn)} /> : null}
          {placeLabel ? <Stat label={bn ? 'জায়গা' : 'Place'} value={placeLabel} /> : null}
          {entry.transferId ? <Stat label={bn ? 'ধরন' : 'Kind'} value={bn ? 'মানিব্যাগ বদল' : 'Wallet transfer'} /> : null}
        </View>
      </Card>

      {entry.note ? <Card title={bn ? 'নোট' : 'Note'}><Text style={s.listMeta}>{entry.note}</Text></Card> : null}

      {photos.length ? (
        <Card title={bn ? 'রশিদ ও ফাইল' : 'Receipt & files'}>
          {/* The same tiles as everywhere else (RC.5) — a PDF shows as a PDF, not a broken photo. */}
          <FileGallery
            items={photos}
            header={false}
            onShare={(g) => { const it = photos.find((p) => p.id === g.id); if (it) void shareAttachment(it).catch(() => undefined); }}
          />
        </Card>
      ) : null}

      {entry.personId ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => { tapLight(); router.push(`/people/${entry.personId}` as never); }}
          style={({ pressed }) => StyleSheet.flatten([s.ghost, styles.gap, pressed && s.pressed])}
        >
          <AppIcon name="account-outline" size={iconSize.sm} color={colors.primary} />
          <Text style={s.ghostText}>{bn ? 'এই ব্যক্তিকে দেখুন' : 'Open this person'}</Text>
        </Pressable>
      ) : null}

      {/* One primary action, then the destructive one — never side by side competing. */}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => { tapLight(); router.push({ pathname: '/finance/new' as never, params: { id: entry.id } }); }}
        style={({ pressed }) => StyleSheet.flatten([s.primary, styles.gap, busy && s.disabled, pressed && s.pressed])}
      >
        <AppIcon name="pencil-outline" size={iconSize.sm} color={colors.onPrimary} />
        <Text style={s.primaryText}>{bn ? 'সম্পাদনা করুন' : 'Edit this entry'}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => { tapLight(); setConfirmOpen(true); }}
        style={({ pressed }) => StyleSheet.flatten([s.dangerBtn, styles.gapTight, busy && s.disabled, pressed && s.pressed])}
      >
        {busy ? <ActivityIndicator color={colors.danger} /> : <AppIcon name="trash-can-outline" size={iconSize.sm} color={colors.danger} />}
        <Text style={s.dangerText}>{bn ? 'এই হিসাবটি মুছুন' : 'Delete this entry'}</Text>
      </Pressable>

      <AppConfirmDialog
        visible={confirmOpen}
        title={entry.transferId ? (bn ? 'বদলটি মুছে ফেলবেন?' : 'Delete this transfer?') : (bn ? 'হিসাবটি মুছে ফেলবেন?' : 'Delete this entry?')}
        description={entry.transferId
          ? (bn ? 'দুই দিকই একসাথে মুছে যাবে — টাকা কোনো মানিব্যাগে বেশি দেখাবে না।' : 'Both sides of the transfer are removed together, so no wallet ends up showing extra money.')
          : linkedToDebt
            ? (bn ? 'এটি একটি ঋণ/পাওনার সাথে যুক্ত — মুছে ফেললে হিসাবের সেই কিস্তিও বাতিল হয়ে যাবে।' : 'This is linked to a debt account — deleting it also reverses that payment on the debt ledger.')
            : (bn ? 'মাসের যোগফল থেকে বাদ যাবে।' : 'It stops counting towards the month.')}
        confirmLabel={bn ? 'মুছুন' : 'Delete'}
        cancelLabel={bn ? 'থাক' : 'Cancel'}
        danger
        icon="alert"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmOpen(false)}
      />
    </ScrollView>
  );
}

// The only styling this screen owns — the thumbnail grid and two spacing shims.
// Everything else is the kit, on purpose.
const styles = StyleSheet.create({
  gap: { marginTop: spacing.smd },
  gapTight: { marginTop: spacing.sm },
});
