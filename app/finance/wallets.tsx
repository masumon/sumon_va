// Where the money actually is.
//
// One total is not an answer. Cash in a pocket, a bKash balance and a bank account do not
// substitute for each other, and the difference decides what you can do this afternoon.
//
// Every balance here is derived — opening amount plus everything in, minus everything out
// — never stored. A stored balance and a list of entries disagree the first time anything
// is edited, and after that neither can be trusted.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../../src/ui/AppText';
import { AppIcon, type IconName } from '../../src/ui/AppIcon';
import { Card, Chip, Field, FormBar, ScreenHeader, useKit } from '../../src/ui/AppKit';
import { AppConfirmDialog, useAppFeedback } from '../../src/ui/AppFeedback';
import { useUnsavedGuard } from '../../src/hooks/useUnsavedGuard';
import { asciiDigitsToBengali, formatPaisa, paisaToTakaString, parseTakaToPaisa } from '../../src/services/debt/money';
import {
  archiveWallet, createWallet, onHandBreakdown, transfer, updateWallet, walletLook,
  type WalletBalance, type WalletKind,
} from '../../src/services/wallet-service';
import { border, icon as iconSize, layout, radius, spacing, typography, type ThemeColors } from '../../src/theme';
import { success, tapLight, warn } from '../../src/ui/haptics';

/** Bengali numerals inside Bengali text. Android mis-measures a line that mixes ASCII
 *  digits with Bengali and cuts it short, so every number in a Bengali sentence goes
 *  through here. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

const KINDS: WalletKind[] = ['CASH', 'MOBILE', 'BANK', 'CARD', 'OTHER'];

export default function WalletsScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [extra, setExtra] = useState<{ archived: number; loose: number; total: number } | null>(null);
  const [mode, setMode] = useState<'none' | 'add' | 'move'>('none');
  const [editing, setEditing] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<WalletKind>('CASH');
  const [opening, setOpening] = useState('');

  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const guard = useUnsavedGuard(mode !== 'none' && touched && !busy);
  const edited = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setTouched(true); };

  const money = useCallback((paisa: number) => formatPaisa(paisa, { bnDigits: bn }), [bn]);
  const digits = useCallback((v: string | number) => (bn ? asciiDigitsToBengali(String(v)) : String(v)), [bn]);

  const load = useCallback(async () => {
    // One on-hand figure for the whole app (onHandBreakdown): the listed wallets, plus
    // put-away wallets and money written without a wallet as their own lines, so what is
    // on screen adds up to the total (RC.4 QA: ৳49,600 shown against ৳39,200 listed).
    try {
      const b = await onHandBreakdown(db);
      setWallets(b.wallets);
      setExtra({ archived: b.archivedPaisa, loose: b.unassignedPaisa, total: b.totalPaisa });
    } catch { setWallets([]); setExtra(null); }
  }, [db]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const total = extra?.total ?? wallets.reduce((sum, wallet) => sum + wallet.balancePaisa, 0);

  const reset = () => {
    setMode('none'); setEditing(null);
    setName(''); setKind('CASH'); setOpening('');
    setFromId(null); setToId(null); setAmount(''); setTouched(false);
  };

  const saveWallet = useCallback(async () => {
    if (busy) return;
    if (!name.trim()) {
      warn();
      showSnackbar(bn ? 'নাম লিখুন' : 'Give it a name', 'danger');
      return;
    }
    setBusy(true);
    try {
      if (editing) await updateWallet(db, editing, { name, kind, opening });
      else await createWallet(db, { name, kind, opening });
      success();
      reset();
      await load();
    } catch {
      warn();
      showSnackbar(bn ? 'সংরক্ষণ করা গেল না' : 'Could not save', 'danger');
    } finally { setBusy(false); }
  }, [busy, name, kind, opening, editing, db, bn, showSnackbar, load]);

  /**
   * Move money, after saying so when the source cannot cover it.
   *
   * Deliberately a warning and not a block. This is a ledger, not a bank: it records what
   * the person did with their own money, and a wallet that reads short is far more often a
   * missing income entry or a rough opening balance than a transfer that did not happen.
   * Refusing to record something that already happened would leave the books further from
   * the truth, not closer. Nothing else in the app blocks on balance either — an expense
   * paid from an empty wallet is written without complaint — so refusing here alone would
   * be an arbitrary rule in one screen. What was actually wrong was doing it *silently*.
   */
  const [confirmOverdraw, setConfirmOverdraw] = useState(false);
  const [overdrawBy, setOverdrawBy] = useState(0);

  const runMove = useCallback(async () => {
    if (!fromId || !toId) return;
    setConfirmOverdraw(false);
    setBusy(true);
    try {
      await transfer(db, { fromWalletId: fromId, toWalletId: toId, amount });
      success();
      showSnackbar(bn ? 'টাকা সরানো হলো' : 'Moved', 'success');
      reset();
      await load();
    } catch {
      warn();
      showSnackbar(bn ? 'সরানো গেল না — দুটো আলাদা মানিব্যাগ বাছুন' : 'Could not move it — pick two different wallets', 'danger');
    } finally { setBusy(false); }
  }, [fromId, toId, amount, db, bn, showSnackbar, load]);

  const move = useCallback(() => {
    if (busy) return;
    if (!fromId || !toId || !amount.trim()) {
      warn();
      showSnackbar(bn ? 'কোথা থেকে, কোথায়, কত — তিনটিই লাগবে' : 'From, to and how much are all needed', 'danger');
      return;
    }
    const source = wallets.find((w) => w.id === fromId);
    // A typo like "1.2.3" made the parser throw inside onPress — an unhandled crash.
    let moving = 0;
    try { moving = parseTakaToPaisa(amount); } catch { moving = 0; }
    if (moving <= 0) {
      warn();
      showSnackbar(bn ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount', 'danger');
      return;
    }
    if (source && moving > source.balancePaisa) {
      setOverdrawBy(moving - source.balancePaisa);
      setConfirmOverdraw(true);
      return;
    }
    void runMove();
  }, [busy, fromId, toId, amount, wallets, bn, showSnackbar, runMove, setConfirmOverdraw, setOverdrawBy]);

  const [confirmArchive, setConfirmArchive] = useState(false);
  const doArchive = async () => {
    setConfirmArchive(false);
    if (!editing) return;
    await archiveWallet(db, editing);
    reset();
    await load();
  };

  const startEdit = (wallet: WalletBalance) => {
    tapLight();
    setMode('add');
    setEditing(wallet.id);
    setName(wallet.name);
    setKind(wallet.kind);
    setOpening(wallet.openingPaisa ? paisaToTakaString(wallet.openingPaisa) : '');
  };

  // Arriving with ?edit=<id> from the wallet preview: open that wallet in the form once.
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const openedFor = useRef<string | null>(null);
  // Seeding the form from a URL parameter is state-in-effect by nature: the wallet only
  // exists once the async load finishes, so there is no render-time value to derive from.
  // The ref makes it run once per id, which is what the rule is really guarding against.
  useEffect(() => {
    if (!edit || openedFor.current === edit) return;
    const found = wallets.find((w) => w.id === edit);
    if (!found) return;
    openedFor.current = edit;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    startEdit(found);
  }, [edit, wallets]);


  return (
    <ScrollView keyboardDismissMode="on-drag" style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader
        title={bn ? 'মানিব্যাগ' : 'Wallets'}
        subtitle={bn ? 'টাকা কোথায় কত আছে' : 'Where the money actually is'}
        backTo="/finance"
        backLabel={bn ? 'আয়-ব্যয়' : 'Income & spending'}
        onBack={() => guard.attemptLeave(() => router.dismissTo('/finance' as never))}
      />

      <View style={[s.hero, { backgroundColor: accents.blue.soft }]}>
        <Text style={[s.heroLabel, { color: accents.blue.on }]}>{bn ? 'সব মিলিয়ে হাতে' : 'Everything, together'}</Text>
        <Text numberOfLines={1} style={[s.heroValue, { color: accents.blue.on }]}>{money(total)}</Text>
        <Text style={s.heroHint}>
          {bn ? `${digits(wallets.length)}টি মানিব্যাগ` : `${bnNum(wallets.length)} wallets`}
        </Text>
      </View>

      {wallets.map((wallet) => {
        const look = walletLook(wallet.kind);
        const negative = wallet.balancePaisa < 0;
        const tone = negative ? accents.red : accents.green;
        return (
          <Pressable
            key={wallet.id}
            accessibilityRole="button"
            accessibilityLabel={`${wallet.name} ${money(wallet.balancePaisa)}`}
            onPress={() => { tapLight(); router.push(`/finance/wallet/${wallet.id}` as never); }}
            style={({ pressed }) => StyleSheet.flatten([s.row, pressed && s.pressed])}
          >
            <View style={[s.rowIcon, { backgroundColor: tone.soft }]}>
              <AppIcon name={look.icon as IconName} size={iconSize.md} color={tone.on} />
            </View>
            <View style={s.grow}>
              <Text numberOfLines={1} style={s.rowName}>{wallet.name}</Text>
              <Text numberOfLines={1} style={s.rowMeta}>
                {bn ? `${look.bn} · ${digits(wallet.entryCount)}টি হিসাব` : `${look.en} · ${wallet.entryCount} entries`}
              </Text>
            </View>
            <Text numberOfLines={1} style={[s.rowValue, { color: tone.on }]}>{money(wallet.balancePaisa)}</Text>
          </Pressable>
        );
      })}

      {/* rc.6 QA: the rows have to add up to the total above. Money written with no wallet,
          and money in put-away wallets, are counted in it — so they are rows too, not a
          line of small print the eye skips. */}
      {([
        extra?.loose ? { key: 'loose', icon: 'help-circle-outline', paisa: extra.loose, name: bn ? 'মানিব্যাগ ছাড়া লেখা হিসাব' : 'No wallet chosen', meta: bn ? 'যে হিসাবে মানিব্যাগ বাছা হয়নি' : 'Entries written without a wallet' } : null,
        extra?.archived ? { key: 'archived', icon: 'archive-outline', paisa: extra.archived, name: bn ? 'বন্ধ করা মানিব্যাগ' : 'Put-away wallets', meta: bn ? 'বন্ধ করা মানিব্যাগে থাকা টাকা' : 'Money still in wallets you put away' } : null,
      ].filter(Boolean) as { key: string; icon: string; paisa: number; name: string; meta: string }[]).map((r) => {
        const tone = r.paisa < 0 ? accents.red : accents.blue;
        return (
          <View key={r.key} style={s.row} accessibilityLabel={`${r.name} ${money(r.paisa)}`}>
            <View style={[s.rowIcon, { backgroundColor: tone.soft }]}>
              <AppIcon name={r.icon as IconName} size={iconSize.md} color={tone.on} />
            </View>
            <View style={s.grow}>
              <Text numberOfLines={1} style={s.rowName}>{r.name}</Text>
              <Text numberOfLines={1} style={s.rowMeta}>{r.meta}</Text>
            </View>
            <Text numberOfLines={1} style={[s.rowValue, { color: tone.on }]}>{money(r.paisa)}</Text>
          </View>
        );
      })}

      {mode === 'none' ? (
        <View style={s.buttons}>
          <Pressable
            accessibilityRole="button"
            onPress={() => { tapLight(); setMode('add'); }}
            style={({ pressed }) => StyleSheet.flatten([s.button, { borderColor: accents.green.on }, pressed && s.pressed])}
          >
            <AppIcon name="plus" size={iconSize.md} color={accents.green.on} />
            <Text numberOfLines={1} style={[s.buttonText, { color: accents.green.on }]}>{bn ? 'নতুন মানিব্যাগ' : 'New wallet'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={wallets.length < 2}
            onPress={() => { tapLight(); setMode('move'); }}
            style={({ pressed }) => StyleSheet.flatten([s.button, { borderColor: accents.blue.on }, wallets.length < 2 && s.faded, pressed && s.pressed])}
          >
            <AppIcon name="swap-horizontal" size={iconSize.md} color={accents.blue.on} />
            <Text numberOfLines={1} style={[s.buttonText, { color: accents.blue.on }]}>{bn ? 'টাকা সরান' : 'Move money'}</Text>
          </Pressable>
        </View>
      ) : null}

      {mode === 'add' ? (
        <Card title={editing ? (bn ? 'মানিব্যাগ বদলান' : 'Edit wallet') : (bn ? 'নতুন মানিব্যাগ' : 'New wallet')}>
          <Field label={bn ? 'নাম' : 'Name'} value={name} onChangeText={edited(setName)} placeholder={bn ? 'যেমন নগদ হাতে' : 'e.g. Cash'} />
          <Text style={s.label}>{bn ? 'ধরন' : 'Kind'}</Text>
          <View style={s.chips}>
            {KINDS.map((k) => (
              <Chip key={k} label={bn ? walletLook(k).bn : walletLook(k).en} active={kind === k} onPress={() => { tapLight(); setKind(k); }} />
            ))}
          </View>
          <Field
            label={bn ? 'শুরুর টাকা' : 'Opening amount'}
            value={opening}
            onChangeText={edited(setOpening)}
            keyboardType="numeric"
            placeholder={bn ? 'এখন এতে কত আছে' : 'What is in it now'}
            hint={bn
              ? 'আজ যত আছে তা লিখুন — এরপর থেকে আয়-ব্যয় নিজেই যোগ-বিয়োগ করবে।'
              : 'Enter what is in it today; entries add and subtract from here on.'}
          />
          {editing ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => { tapLight(); setConfirmArchive(true); }}
              style={({ pressed }) => StyleSheet.flatten([s.archive, pressed && s.pressed])}
            >
              <Text numberOfLines={1} style={[s.archiveText, { color: accents.orange.on }]}>
                {bn ? 'এটি আর ব্যবহার করব না' : 'Stop using this wallet'}
              </Text>
            </Pressable>
          ) : null}
          <FormBar onCancel={() => guard.attemptLeave(reset)} onSave={() => void saveWallet()} saving={busy} saveLabel={bn ? 'সংরক্ষণ' : 'Save'} />
        </Card>
      ) : null}

      {mode === 'move' ? (
        <Card title={bn ? 'এক মানিব্যাগ থেকে আরেকটিতে' : 'Move between wallets'}>
          <Text style={s.label}>{bn ? 'কোথা থেকে' : 'From'}</Text>
          <View style={s.chips}>
            {wallets.map((wallet) => (
              <Chip key={wallet.id} label={wallet.name} active={fromId === wallet.id} onPress={() => { tapLight(); setFromId(wallet.id); }} />
            ))}
          </View>
          <Text style={s.label}>{bn ? 'কোথায়' : 'To'}</Text>
          <View style={s.chips}>
            {wallets.filter((wallet) => wallet.id !== fromId).map((wallet) => (
              <Chip key={wallet.id} label={wallet.name} active={toId === wallet.id} onPress={() => { tapLight(); setToId(wallet.id); }} />
            ))}
          </View>
          <Field label={bn ? 'কত টাকা' : 'How much'} value={amount} onChangeText={edited(setAmount)} keyboardType="numeric" />
          <Text style={s.note}>
            {bn
              ? 'এটি আয়ও নয়, ব্যয়ও নয় — শুধু আপনার নিজের টাকা এক পকেট থেকে আরেক পকেটে। মাসের হিসাবে এটি গোনা হবে না।'
              : 'This is neither income nor spending — your own money moving pockets. It is left out of the month’s totals.'}
          </Text>
          <FormBar onCancel={() => guard.attemptLeave(reset)} onSave={() => void move()} saving={busy} saveLabel={bn ? 'সরান' : 'Move'} />
        </Card>
      ) : null}

      <AppConfirmDialog
        visible={guard.confirming}
        title={bn ? 'পরিবর্তন বাতিল করবেন?' : 'Discard your changes?'}
        description={bn ? 'যা লিখেছেন তা সংরক্ষণ হয়নি।' : 'What you typed has not been saved.'}
        confirmLabel={bn ? 'বাতিল করুন' : 'Discard'}
        cancelLabel={bn ? 'লিখতে থাকি' : 'Keep editing'}
        danger
        icon="alert"
        onConfirm={() => { guard.setConfirming(false); reset(); }}
        onCancel={() => guard.setConfirming(false)}
      />

      <AppConfirmDialog
        visible={confirmOverdraw}
        title={bn ? 'এই মানিব্যাগে এত টাকা নেই' : 'That wallet is short'}
        description={bn
          ? `সরালে হিসাবটি ${money(overdrawBy)} ঋণাত্মক হয়ে যাবে। কোনো আয় লিখতে ভুলে গেলে আগে সেটি যোগ করুন — নয়তো এগিয়ে যান, হিসাব যেমন ঘটেছে তেমনই থাকবে।`
          : `Moving it leaves the wallet ${money(overdrawBy)} below zero. If an income entry is missing, add that first — otherwise carry on and the books will say what happened.`}
        confirmLabel={bn ? 'তবুও সরান' : 'Move anyway'}
        cancelLabel={bn ? 'থাক' : 'Cancel'}
        icon="alert"
        onConfirm={() => void runMove()}
        onCancel={() => setConfirmOverdraw(false)}
      />

      <AppConfirmDialog
        visible={confirmArchive}
        title={bn ? 'এটি আর ব্যবহার করবেন না?' : 'Stop using this wallet?'}
        description={bn
          ? 'পুরনো হিসাবগুলো থেকে যাবে — শুধু নতুন হিসাবে এটি আর দেখা যাবে না।'
          : 'Past entries stay as they are; it just stops being offered for new ones.'}
        confirmLabel={bn ? 'সরান' : 'Archive'}
        cancelLabel={bn ? 'থাক' : 'Cancel'}
        danger
        icon="alert"
        onConfirm={() => void doArchive()}
        onCancel={() => setConfirmArchive(false)}
      />
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs },
    grow: { flex: 1, minWidth: 0 },
    hero: { borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm },
    heroLabel: { ...typography.caption, fontWeight: '800' },
    heroValue: { ...typography.display, fontWeight: '700', marginTop: 2, flexShrink: 1 },
    heroHint: { color: colors.textSecondary, ...typography.caption, marginTop: spacing.xs },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget + 12, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    rowIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    rowName: { color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    rowMeta: { color: colors.textMuted, ...typography.caption, marginTop: 1 },
    rowValue: { ...typography.callout, fontWeight: '800', flexShrink: 1 },
    buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    button: { flex: 1, minHeight: 64, borderRadius: radius.lg, borderWidth: border.thin, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: spacing.sm },
    buttonText: { ...typography.caption, fontWeight: '800', flexShrink: 1 },
    label: { color: colors.textSecondary, ...typography.caption, fontWeight: '800', marginTop: spacing.sm, marginBottom: spacing.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    note: { color: colors.textMuted, ...typography.caption, marginTop: spacing.sm, lineHeight: 17 },
    archive: { minHeight: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
    archiveText: { ...typography.bodySmall, fontWeight: '800', flexShrink: 1 },
    faded: { opacity: 0.4 },
    pressed: { opacity: 0.78 },
  });
}
