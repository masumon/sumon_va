// "Which wallet?" and "whose money?" — asked the same way on every form that moves money.
//
// The user's rule for v1.0: money never moves without a wallet, and money going out never
// leaves without its source (income, a loan, a gift, savings). Nine forms move money; each
// used to ask about the wallet in its own way, most of them as optional, and none asked
// about the source. These two pickers are the one way both questions are asked, so every
// form reads the same and none can quietly make either answer optional again.
//
// Nothing here is pre-selected: the person picks, even when there is only one wallet —
// a default is a guess, and a guessed wallet is a balance that is quietly wrong.

import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from './AppText';
import { Chip, Field, useKit } from './AppKit';
import { tapLight } from './haptics';
import { spacing } from '../theme';
import { createWallet, listWallets, type Wallet, type WalletKind } from '../services/wallet-service';
import { FUND_SOURCES, fundSourceLabel, type FundSource } from '../services/finance-service';
import { linkableAccounts, type LinkableAccount } from '../services/money-bridge';

/** The label every required money question wears: the words, then a red star. */
function RequiredLabel({ text }: { text: string }) {
  const { s, colors } = useKit();
  return (
    <Text style={s.label}>
      {text}
      <Text style={{ color: colors.danger }}>{' *'}</Text>
    </Text>
  );
}

/** A name is enough to make a wallet; what kind it is follows from the name people use. */
function kindFromName(name: string): WalletKind {
  if (/বিকাশ|নগদ অ্যাপ|রকেট|উপায়|bkash|nagad|rocket|upay/iu.test(name)) return 'MOBILE';
  if (/ব্যাংক|bank/iu.test(name)) return 'BANK';
  if (/কার্ড|card/iu.test(name)) return 'CARD';
  return 'CASH';
}

/**
 * Which wallet the money moved through. With no wallet yet — or not the right one — a new
 * one is made right here and chosen, and whatever else was typed on the form stays put.
 */
export function WalletPicker({
  label, value, onChange, wallets: given, onWalletsChange, note,
}: {
  label: string;
  /** A line under the picker — e.g. what a back-dated entry does to today's balance. */
  note?: string | null;
  value: string | null;
  onChange: (walletId: string | null) => void;
  /** The form's own list, when it already loaded one; otherwise the picker loads it. */
  wallets?: Wallet[];
  onWalletsChange?: (wallets: Wallet[]) => void;
}) {
  const db = useSQLiteContext();
  const { s, bn } = useKit();
  const [own, setOwn] = useState<Wallet[] | null>(null);
  const wallets = given ?? own ?? [];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (given) return;
    let alive = true;
    void listWallets(db).then((list) => { if (alive) setOwn(list); }).catch(() => { if (alive) setOwn([]); });
    return () => { alive = false; };
  }, [db, given]);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const made = await createWallet(db, { name: trimmed, kind: kindFromName(trimmed) });
    const list = await listWallets(db).catch(() => [made]);
    setOwn(list);
    onWalletsChange?.(list);
    onChange(made.id);
    setName('');
    setCreating(false);
  }, [db, name, onChange, onWalletsChange]);

  const open = creating || wallets.length === 0;
  return (
    <View>
      <RequiredLabel text={label} />
      <View style={s.chipRow}>
        {wallets.map((w) => (
          <Chip key={w.id} label={w.name} active={value === w.id} onPress={() => { tapLight(); onChange(value === w.id ? null : w.id); }} />
        ))}
        {wallets.length ? (
          <Chip label={bn ? 'নতুন মানিব্যাগ' : 'New wallet'} icon="plus" active={creating} onPress={() => { tapLight(); setCreating((v) => !v); }} />
        ) : null}
      </View>
      {wallets.length === 0 ? (
        <Text style={s.fieldHint}>{bn ? 'এখনো কোনো মানিব্যাগ নেই — নিচে নাম লিখে একটা তৈরি করুন (যেমন: নগদ হাতে, বিকাশ, ব্যাংক)।' : 'No wallet yet — type a name below to make one (e.g. Cash, bKash, Bank).'}</Text>
      ) : null}
      {note ? <Text style={s.fieldHint}>{note}</Text> : null}
      {open ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Field label={bn ? 'নতুন মানিব্যাগের নাম' : 'New wallet name'} value={name} onChangeText={setName} placeholder={bn ? 'যেমন: নগদ হাতে, বিকাশ' : 'e.g. Cash, bKash'} />
          </View>
          <Chip label={bn ? 'তৈরি করুন' : 'Create'} icon="check" active onPress={() => void create()} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Whose money went out: income, a loan, a gift, savings, other. When it was a loan, which
 * one (optional) — that is what shows a loan being repaid with another loan.
 */
export function FundSourcePicker({
  value, onChange, loanAccountId, onLoanAccountChange, excludeAccountId, note, onNoteChange,
}: {
  value: FundSource | null;
  onChange: (source: FundSource | null) => void;
  loanAccountId: string | null;
  onLoanAccountChange: (accountId: string | null) => void;
  /** What "other" was, in the person's words — every "অন্যান্য" has a place to type. */
  note?: string;
  onNoteChange?: (note: string) => void;
  /** The loan being repaid or lent from itself — never offered as its own source. */
  excludeAccountId?: string | null;
}) {
  const db = useSQLiteContext();
  const { s, bn } = useKit();
  const [loans, setLoans] = useState<LinkableAccount[] | null>(null);

  useEffect(() => {
    if (value !== 'LOAN' || loans) return;
    let alive = true;
    void linkableAccounts(db, 'DEBT').then((list) => { if (alive) setLoans(list); }).catch(() => { if (alive) setLoans([]); });
    return () => { alive = false; };
  }, [db, value, loans]);

  const offered = (loans ?? []).filter((a) => a.id !== excludeAccountId);
  return (
    <View>
      <RequiredLabel text={bn ? 'টাকার উৎস — কোন টাকা থেকে গেল' : 'Source — whose money went out'} />
      <View style={s.chipRow}>
        {FUND_SOURCES.map((src) => (
          <Chip key={src} label={fundSourceLabel(src, bn)} active={value === src} onPress={() => {
            tapLight();
            const next = value === src ? null : src;
            onChange(next);
            if (next !== 'LOAN') onLoanAccountChange(null);
          }} />
        ))}
      </View>
      {value === 'LOAN' ? (
        offered.length ? (
          <>
            <Text style={s.label}>{bn ? 'কোন ঋণের টাকা (ঐচ্ছিক)' : 'Which loan (optional)'}</Text>
            <View style={s.chipRow}>
              {offered.map((a) => (
                <Chip key={a.id} label={a.title ? `${a.personName} · ${a.title}` : a.personName} active={loanAccountId === a.id}
                  onPress={() => { tapLight(); onLoanAccountChange(loanAccountId === a.id ? null : a.id); }} />
              ))}
            </View>
          </>
        ) : loans ? (
          <Text style={s.fieldHint}>{bn ? 'খোলা কোনো ঋণ নেই — শুধু "ঋণ" হিসেবে রাখা হবে।' : 'No open loan — it is kept as "loan".'}</Text>
        ) : null
      ) : null}
      {value === 'OTHER' && onNoteChange ? (
        <Field label={bn ? 'কোথা থেকে — নিজে লিখুন' : 'From where — in your words'} value={note ?? ''} onChangeText={onNoteChange} placeholder={bn ? 'যেমন: কমিটির টাকা, বোনাস' : 'e.g. committee savings, a bonus'} />
      ) : null}
    </View>
  );
}

// The wording rules live with the services (no UI in them), and are re-exported here so every
// form imports its money pieces from one place.
export { backDatedNote, moneyDetailsProblem } from '../services/money-rules';
