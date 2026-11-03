// One মানিব্যাগ, read-only.
//
// Tapping a wallet used to drop straight into the edit form with the name already in a
// text field — so "how much is in bikash" put a keyboard on screen and a Save button
// under the thumb. Reading and changing are separate intentions, and this screen answers
// only the first one: what is in it, what went through it, and how it was set up.
//
// Nothing here writes. Edit hands back to the wallets screen, which owns the form; the
// one destructive act asks first.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../../../src/ui/AppText';
import { AppIcon, type IconName } from '../../../src/ui/AppIcon';
import { Card, EmptyNote, ScreenHeader, Stat, useKit } from '../../../src/ui/AppKit';
import { AppConfirmDialog, useAppFeedback } from '../../../src/ui/AppFeedback';
import { asciiDigitsToBengali, formatPaisa } from '../../../src/services/debt/money';
import { archiveWallet, walletBalances, walletLook, type WalletBalance } from '../../../src/services/wallet-service';
import { icon as iconSize, spacing } from '../../../src/theme';
import { success, tapLight, warn } from '../../../src/ui/haptics';

export default function WalletScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { s, colors, accents, bn } = useKit();
  const { showSnackbar } = useAppFeedback();

  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const money = useCallback((p: number) => formatPaisa(p, { bnDigits: bn }), [bn]);
  const digits = useCallback((v: number | string) => (bn ? asciiDigitsToBengali(String(v)) : String(v)), [bn]);

  const load = useCallback(async () => {
    if (!id) { setReady(true); return; }
    try {
      const all = await walletBalances(db, true);
      setWallet(all.find((w) => w.id === id) ?? null);
    } catch { setWallet(null); }
    finally { setReady(true); }
  }, [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const archive = async () => {
    setConfirmArchive(false);
    if (!id || busy) return;
    setBusy(true);
    try {
      await archiveWallet(db, id);
      success();
      showSnackbar(bn ? 'সরিয়ে রাখা হয়েছে' : 'Archived', 'success');
      router.back();
    } catch {
      warn();
      showSnackbar(bn ? 'সরানো যায়নি' : 'Could not archive', 'danger');
    } finally { setBusy(false); }
  };

  if (!ready) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;

  if (!wallet) {
    return (
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <ScreenHeader title={bn ? 'মানিব্যাগ' : 'Wallet'} backTo="/finance/wallets" backLabel={bn ? 'মানিব্যাগ' : 'Wallets'} />
        <EmptyNote icon="wallet-outline" text={bn ? 'মানিব্যাগটি পাওয়া যায়নি।' : 'That wallet is gone.'} />
      </ScrollView>
    );
  }

  const look = walletLook(wallet.kind);
  const negative = wallet.balancePaisa < 0;
  const tone = negative ? accents.red : accents.green;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        title={wallet.name}
        subtitle={bn ? look.bn : look.en}
        backTo="/finance/wallets"
        backLabel={bn ? 'মানিব্যাগ' : 'Wallets'}
      />

      <Card>
        <View style={styles.head}>
          <View style={[styles.badge, { backgroundColor: tone.soft }]}>
            <AppIcon name={look.icon as IconName} size={iconSize.lg} color={tone.on} />
          </View>
          <View style={s.grow}>
            <Text numberOfLines={1} style={[s.big, { color: tone.on }]}>{money(wallet.balancePaisa)}</Text>
            <Text style={s.bigLabel}>{bn ? 'এখন হাতে আছে' : 'In it right now'}</Text>
          </View>
        </View>
        <View style={styles.gap}>
          <Stat label={bn ? 'আয়' : 'Income'} value={money(wallet.inPaisa)} tone={accents.green} />
          <Stat label={bn ? 'খরচ' : 'Spending'} value={money(wallet.outPaisa)} tone={accents.orange} />
          {/* A move between wallets is neither income nor spending (rc.6 QA). */}
          {wallet.transferInPaisa ? <Stat label={bn ? 'অন্য মানিব্যাগ থেকে এসেছে' : 'Moved in from another wallet'} value={money(wallet.transferInPaisa)} tone={accents.blue} /> : null}
          {wallet.transferOutPaisa ? <Stat label={bn ? 'অন্য মানিব্যাগে সরানো' : 'Moved out to another wallet'} value={money(wallet.transferOutPaisa)} tone={accents.blue} /> : null}
          <Stat label={bn ? 'শুরুর অঙ্ক' : 'Opening amount'} value={money(wallet.openingPaisa)} />
          <Stat label={bn ? 'কতগুলো হিসাব' : 'Entries'} value={digits(wallet.entryCount)} />
          {wallet.archivedAt ? <Stat label={bn ? 'অবস্থা' : 'Status'} value={bn ? 'সরিয়ে রাখা' : 'Archived'} tone={accents.orange} /> : null}
        </View>
      </Card>

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => { tapLight(); router.push({ pathname: '/finance/wallets', params: { edit: wallet.id } }); }}
        style={({ pressed }) => StyleSheet.flatten([s.primary, styles.gap, busy && s.disabled, pressed && s.pressed])}
      >
        <AppIcon name="pencil-outline" size={iconSize.sm} color={colors.onPrimary} />
        <Text style={s.primaryText}>{bn ? 'সম্পাদনা করুন' : 'Edit this wallet'}</Text>
      </Pressable>

      {!wallet.archivedAt ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => { tapLight(); setConfirmArchive(true); }}
          style={({ pressed }) => StyleSheet.flatten([s.dangerBtn, styles.gapTight, busy && s.disabled, pressed && s.pressed])}
        >
          {busy ? <ActivityIndicator color={colors.danger} /> : <AppIcon name="archive-outline" size={iconSize.sm} color={colors.danger} />}
          <Text style={s.dangerText}>{bn ? 'সরিয়ে রাখুন' : 'Archive this wallet'}</Text>
        </Pressable>
      ) : null}

      <AppConfirmDialog
        visible={confirmArchive}
        title={bn ? 'মানিব্যাগটি সরিয়ে রাখবেন?' : 'Archive this wallet?'}
        description={bn
          ? 'পুরনো হিসাবগুলো থেকে যাবে — শুধু নতুন হিসাবে এটি আর দেখা যাবে না।'
          : 'Past entries stay as they are; it just stops being offered for new ones.'}
        confirmLabel={bn ? 'সরান' : 'Archive'}
        cancelLabel={bn ? 'থাক' : 'Cancel'}
        danger
        icon="alert"
        onConfirm={() => void archive()}
        onCancel={() => setConfirmArchive(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  gap: { marginTop: spacing.smd },
  gapTight: { marginTop: spacing.sm },
});
