// Adding — or editing — one line of আয়-ব্যয়.
//
// Manual first. An amount and a category are all that is ever required; everything else
// is optional, and every optional thing can be typed by hand. The chips underneath a
// field are suggestions, not a menu — a wage earner paid in an envelope by a man called
// Karim should not have to find "Other" because the list was written for someone else.
//
// The camera, the contact picker and the place button are the shared foundations turning
// up where they are useful; none of them is a feature of this module.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../../src/ui/AppText';
import { AppIcon } from '../../src/ui/AppIcon';
import { Card, Chip, ChipGroup, Field, FormBar, ScreenHeader, useKit } from '../../src/ui/AppKit';
import { AppConfirmDialog, useAppFeedback } from '../../src/ui/AppFeedback';
import { useUnsavedGuard } from '../../src/hooks/useUnsavedGuard';
import { addFrom, stageFrom, type AttachSource } from '../../src/services/attachment-sources';
import {
  addEntry, deleteEntry, getCategoryNeed, getEntry, setCategoryNeed, updateEntry,
  usedCategories, usedMethods, NEEDS, RECURRENCES,
  type EntryKind, type Need, type Recurrence,
  type FundSource,
} from '../../src/services/finance-service';
import { formatPaisa, paisaToTakaString, parseTakaToPaisa } from '../../src/services/debt/money';
import { bangladeshDateKey } from '../../src/i18n/date-time';
import { AppDateField } from '../../src/ui/AppDateField';
import { priceMemory, type PriceMemory } from '../../src/services/money-sense';
import {
  discardStagedAttachments, finalizeStagedAttachments, listAttachments, removeAttachment, shareAttachment,
  AttachmentPermissionError, type Attachment, type StagedAttachment,
} from '../../src/services/attachment-service';
import { FileGallery } from '../../src/ui/FileGallery';
import { capturePlace, cleanPlaceLabel, describePlace, type Place } from '../../src/services/capture/place';
import { pickContact, searchContacts, describeContactDenial, type PickedContact } from '../../src/services/capture/contacts';
import { findOrCreatePerson } from '../../src/services/people-service';
import { getPlace, knownNameNear, recentNamedPlaces, setPlace } from '../../src/services/place-service';
import { listWallets, type Wallet } from '../../src/services/wallet-service';
import {
  collectAndRecordIncome, linkableAccounts, looksLikeDebtMovement, looksLikeNewDebtMovement,
  openDebtAccountAndRecordEntry, payDebtAndRecordExpense, removeDebtTransactionForDeletedFinanceEntry,
  syncDebtTransactionToFinanceEdit, type LinkableAccount,
} from '../../src/services/money-bridge';
import { border, control, fonts, icon as iconSize, layout, radius, spacing, type ThemeColors, typography } from '../../src/theme';
import { success, tapLight, warn } from '../../src/ui/haptics';
import { FundSourcePicker, WalletPicker, moneyDetailsProblem } from '../../src/ui/MoneyPickers';

const OWNER = 'FINANCE_ENTRY';

/**
 * "২০২৬-০৯-০৫" as the phone sees it, kept as a plain date so a month never shifts.
 *
 * Dhaka time, not UTC. An expense entered at 1am was being filed under yesterday —
 * a wrong date on a saved record, not just a wrong label — because UTC had not turned
 * over yet.
 */
const todayISO = () => bangladeshDateKey(new Date());

/** Shift a yyyy-mm-dd by whole days — how "yesterday" is offered without a calendar. */
function shiftDay(iso: string, by: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + by);
  return bangladeshDateKey(date);
}

export default function FinanceEntryForm() {
  const db = useSQLiteContext();
  const { colors, accents, bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const params = useLocalSearchParams<{ id?: string; kind?: string }>();
  const editingId = typeof params.id === 'string' ? params.id : null;

  const [kind, setKind] = useState<EntryKind>(params.kind === 'INCOME' ? 'INCOME' : 'EXPENSE');
  // A reused screen keeps its first state; the door the user just tapped decides (RC.4 QA:
  // "আয় যোগ" opened the expense form).
  const [kindParam, setKindParam] = useState(params.kind);
  if (params.kind !== kindParam) {
    setKindParam(params.kind);
    if (!editingId && (params.kind === 'INCOME' || params.kind === 'EXPENSE')) setKind(params.kind);
  }
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [method, setMethod] = useState('');
  const [personName, setPersonName] = useState('');
  const [personPhone, setPersonPhone] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  // What matches, as the name is typed — in Bengali or English, whichever the phone's
  // contact book already holds it in. A name and an eleven-digit number typed by hand is
  // exactly the kind of small friction a phonebook lookup exists to remove.
  const [suggestions, setSuggestions] = useState<PickedContact[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [note, setNote] = useState('');
  const [recurring, setRecurring] = useState<Recurrence>('NONE');
  const [need, setNeed] = useState<Need>('NEEDED');
  const [walletId, setWalletId] = useState<string | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  // Whose money went out. Asked on every expense (the user's rule for v1.0), never guessed.
  const [fundSource, setFundSource] = useState<FundSource | null>(null);
  const [fundAccountId, setFundAccountId] = useState<string | null>(null);
  const [fundNote, setFundNote] = useState('');
  // When the category means a loan moved, the debt ledger should hear about it too —
  // otherwise the same payment gets written twice by hand, or once and forgotten.
  const [accounts, setAccounts] = useState<LinkableAccount[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [prices, setPrices] = useState<PriceMemory | null>(null);
  const [showMore, setShowMore] = useState(false);

  const [categories, setCategories] = useState<string[]>([]);
  const [methods, setMethods] = useState<string[]>([]);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  // The place itself (to name it), the names used before (to pick again), and the name
  // being typed for a spot the phone could not name — never shown as numbers.
  const [currentPlace, setCurrentPlace] = useState<Place | null>(null);
  const [recentPlaces, setRecentPlaces] = useState<Place[]>([]);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Attachment[]>([]);
  // A new entry's receipt and place wait here until Save, the way the task and memory
  // editors keep theirs. Writing the entry early just to hang a photo on it skipped the
  // wallet/source checks and the debt link, left a half entry behind on Discard, and a
  // double tap wrote two.
  const stagedRef = useRef<StagedAttachment[]>([]);
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [stagedPlace, setStagedPlace] = useState<Place | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  // `saving` is state, so two taps in one frame both read it false; the ref does not.
  const savingRef = useRef(false);
  const [touched, setTouched] = useState(false);
  const guard = useUnsavedGuard(touched && !saving);
  const edited = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setTouched(true); };


  // Does this category mean a debt moved? If so, offer the accounts — never assume one.
  const debtDirection = looksLikeDebtMovement(category);
  // Does this category mean a *new* debt is being taken on or given out? Separate from the
  // check above on purpose — this one opens a fresh account instead of picking an existing
  // one, and only when a person has actually been named (never guessed).
  const newDebtDirection = looksLikeNewDebtMovement(category);
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!debtDirection || editingId) {
        if (alive) { setAccounts([]); setAccountId(null); }
        return;
      }
      try {
        const list = await linkableAccounts(db, debtDirection);
        if (alive) setAccounts(list);
      } catch {
        if (alive) setAccounts([]);
      }
    })();
    return () => { alive = false; };
  }, [db, debtDirection, editingId]);

  // What this category has cost before. Debounced with the same delay as the need lookup,
  // so typing a category name does not run a query per keystroke.
  useEffect(() => {
    const name = category.trim();
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        if (!name || kind === 'INCOME') {
          if (alive) setPrices(null);
          return;
        }
        try {
          const found = await priceMemory(db, name);
          if (alive) setPrices(found);
        } catch { /* the field still works without a hint */ }
      })();
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [db, category, kind]);

  // A category the app has seen before keeps the answer it was given. Nothing is asked
  // twice, and nothing is guessed on the user's behalf.
  useEffect(() => {
    const name = category.trim();
    if (!name) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      void getCategoryNeed(db, name)
        .then((found) => { if (alive) setNeed(found); })
        .catch(() => {});
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [db, category]);

  useEffect(() => {
    let alive = true;
    void listWallets(db)
      .then((list) => { if (alive) setWallets(list); })
      .catch(() => {});
    return () => { alive = false; };
  }, [db]);

  // A picked person clears its own name change below (setPersonId(null) on every edit),
  // so once a suggestion has been accepted, personId is set and there is nothing left to
  // suggest — this only ever fires while the field is genuinely being typed into.
  useEffect(() => {
    if (personId || !personName.trim()) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      void searchContacts(personName)
        .then((found) => { if (alive) { setSuggestions(found); setSuggestionsOpen(found.length > 0); } })
        .catch(() => {});
    }, 220);
    return () => { alive = false; clearTimeout(timer); };
  }, [personName, personId]);

  // Derived rather than cleared from inside the effect above. Emptying the list on the way
  // out of that effect meant a render pass whose only job was to undo the previous one —
  // and the moment a name is picked or the field emptied, "no suggestions" is simply what
  // the current state means, not something that has to be assigned.
  const visibleSuggestions = personId || !personName.trim() ? [] : suggestions;

  // Suggestions follow the kind: a salary is not a category anyone spends under.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [cats, meths] = await Promise.all([usedCategories(db, kind), usedMethods(db, kind)]);
      if (!alive) return;
      setCategories(cats);
      setMethods(meths);
    })();
    return () => { alive = false; };
  }, [db, kind]);

  useEffect(() => {
    if (!editingId) return;
    let alive = true;
    void (async () => {
      const entry = await getEntry(db, editingId);
      if (!entry || !alive) return;
      setKind(entry.kind);
      setAmount(paisaToTakaString(entry.amountPaisa));
      setCategory(entry.category);
      setMethod(entry.method ?? '');
      setPersonId(entry.personId);
      setPersonName(entry.personName ?? '');
      setOccurredOn(entry.occurredAt.slice(0, 10));
      setNote(entry.note ?? '');
      setRecurring((entry.recurring as Recurrence) ?? 'NONE');
      setWalletId(entry.walletId);
      setFundSource(entry.fundSource);
      setFundAccountId(entry.fundAccountId);
      setFundNote(entry.fundNote ?? '');
      if (entry.personId || entry.recurring) setShowMore(true);
      const place = await getPlace(db, OWNER, editingId);
      if (alive && place) { setCurrentPlace(place); setPlaceLabel(describePlace(place, bn ? 'bn' : 'en')); }
      const files = await listAttachments(db, OWNER, editingId);
      if (alive) setPhotos(files);
    })();
    return () => { alive = false; };
  }, [db, editingId, bn]);

  /** The person is optional, and typing a name is enough — the row is made on save. */
  const resolvePerson = useCallback(async (): Promise<string | null> => {
    if (personId) return personId;
    if (!personName.trim()) return null;
    const person = await findOrCreatePerson(db, { name: personName, phone: personPhone });
    setPersonId(person.id);
    return person.id;
  }, [db, personId, personName, personPhone]);

  const fromContacts = useCallback(async () => {
    tapLight();
    const result = await pickContact(true);
    if (result.status !== 'picked') {
      if (result.status === 'unavailable') {
        warn();
        showSnackbar(bn ? 'কন্টাক্ট খোলা গেল না' : 'Could not open contacts', 'danger');
      } else if (result.status === 'denied') {
        // Silence here left the user tapping a button that did nothing.
        warn();
        const info = describeContactDenial(bn, result.blocked);
        showSnackbar(info.message, 'danger', info.action);
      }
      return;
    }
    setPersonName(result.contact.name);
    setPersonPhone(result.contact.phone);
    setPersonId(null);
    success();
  }, [bn, showSnackbar]);

  const save = useCallback(async () => {
    if (saving || savingRef.current) return;
    if (!amount.trim() || !category.trim()) {
      warn();
      showSnackbar(bn ? 'টাকার অঙ্ক ও খাত দুটোই লাগবে' : 'An amount and a category are both needed', 'danger');
      return;
    }
    // Every entry moves through a wallet, and every expense names whose money it was.
    const problem = moneyDetailsProblem({ walletId, needsSource: kind === 'EXPENSE', fundSource }, bn);
    if (problem) {
      warn();
      showSnackbar(problem, 'danger');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      let newAccountId: string | null = null;
      let createdId: string | null = null;
      const who = await resolvePerson();
      const sourceFields = kind === 'EXPENSE'
        ? { fundSource, fundAccountId: fundSource === 'LOAN' ? fundAccountId : null, fundNote: fundSource === 'OTHER' ? fundNote : null }
        : { fundSource: null, fundAccountId: null, fundNote: null };
      const payload = {
        kind, amount, category, method, note, personId: who, walletId, ...sourceFields,
        occurredAt: `${occurredOn}T12:00:00.000Z`,
        recurring: recurring === 'NONE' ? null : recurring,
      };
      if (editingId) {
        await updateEntry(db, editingId, payload);
        // If this entry is the wallet side of a debt payment or collection, the ledger row
        // it is linked to has to move by the same correction — otherwise editing the wallet
        // amount here silently stops matching what the debt account shows as repaid.
        const saved = await getEntry(db, editingId);
        if (saved) {
          await syncDebtTransactionToFinanceEdit(db, editingId, saved.amountPaisa, saved.occurredAt).catch(() => {});
        }
      } else if (accountId && debtDirection) {
        // One action, two books. The ledger is written first because it is the one that
        // can refuse; only once it accepts does the expense get written, so a rejected
        // payment never leaves an expense behind claiming money went somewhere it did not.
        const bridge = debtDirection === 'DEBT' ? payDebtAndRecordExpense : collectAndRecordIncome;
        createdId = (await bridge(db, {
          accountId,
          amount,
          walletId,
          ...sourceFields,
          method,
          note,
          occurredAt: `${occurredOn}T12:00:00.000Z`,
        })).entry.id;
      } else if (newDebtDirection && who) {
        // "ধার নেওয়া"/"ধার দেওয়া" with a person named: open the debt account and write
        // this entry as its wallet side, in one action — never guessed without a person.
        const opened = await openDebtAccountAndRecordEntry(db, {
          direction: newDebtDirection,
          personId: who,
          amount,
          walletId,
          ...sourceFields,
          note,
          occurredAt: `${occurredOn}T12:00:00.000Z`,
        });
        newAccountId = opened.accountId;
        createdId = opened.entry.id;
      } else {
        createdId = (await addEntry(db, payload)).id;
      }
      // The entry exists now, so what was set aside for it can be hung on it. The entry is
      // already saved at this point; a failed attachment is said plainly, never undone.
      let attachFailed = false;
      if (createdId && stagedPlace) await setPlace(db, OWNER, createdId, stagedPlace).catch(() => { attachFailed = true; });
      if (createdId && stagedRef.current.length) {
        try { await finalizeStagedAttachments(db, OWNER, createdId, stagedRef.current); }
        catch { attachFailed = true; }
        // Finalize either kept the files or already cleaned them up — never retry dead refs.
        stagedRef.current = [];
        setStaged([]);
      }
      if (kind === 'EXPENSE') await setCategoryNeed(db, category, need).catch(() => {});
      success();
      // A new debt account was opened alongside this entry — say so, and offer a way to
      // see it, but never navigate there ourselves: the save flow's job is to save and
      // return, same as always, not to decide the account is more interesting than that.
      if (attachFailed) {
        showSnackbar(bn ? 'লেখা হয়েছে, কিন্তু ছবি/জায়গা যোগ করা যায়নি' : 'Saved, but the photo or place could not be added', 'danger');
      } else if (newAccountId) {
        showSnackbar(
          bn ? 'লেখা হয়েছে — দেনা-পাওনায় নতুন হিসাব খোলা হয়েছে' : 'Saved — a new account was opened in Debts',
          'success',
          { label: bn ? 'দেখুন' : 'View', onPress: () => router.push(`/debt/account/${newAccountId}` as never) },
        );
      } else {
        showSnackbar(bn ? 'লেখা হয়েছে' : 'Saved', 'success');
      }
      router.back();
    } catch {
      warn();
      showSnackbar(bn ? 'লেখা গেল না — অঙ্কটি দেখে নিন' : 'Could not save — check the amount', 'danger');
    } finally { savingRef.current = false; setSaving(false); }
  }, [saving, amount, category, kind, method, note, occurredOn, recurring, need, walletId, fundSource, fundAccountId, fundNote, accountId, debtDirection, newDebtDirection, resolvePerson, editingId, stagedPlace, db, bn, showSnackbar]);

  // Where a place goes: straight onto an entry that exists, or set aside until Save.
  const keepPlace = useCallback(async (place: Place) => {
    if (editingId) await setPlace(db, OWNER, editingId, place);
    else { setStagedPlace(place); setTouched(true); }
  }, [db, editingId]);

  // Leaving without saving: the set-aside copies are only this screen's cache files.
  const dropStaged = useCallback(() => {
    const items = stagedRef.current;
    stagedRef.current = [];
    setStaged([]);
    if (items.length) void discardStagedAttachments(items).catch(() => undefined);
  }, []);

  const takePhoto = useCallback(async (source: AttachSource) => {
    tapLight();
    try {
      if (editingId) {
        const added = await addFrom(db, OWNER, editingId, source);
        if (added.length) { success(); setPhotos((current) => [...added, ...current]); }
      } else {
        const added = await stageFrom(source);
        if (added.length) {
          success();
          stagedRef.current = [...added, ...stagedRef.current];
          setStaged(stagedRef.current);
          setTouched(true);
        }
      }
    } catch (error) {
      warn();
      // A refused permission is not a failure to save — telling the user "could not save
      // the photo" sends them looking for a bug that is really a switch in Settings.
      if (error instanceof AttachmentPermissionError) {
        showSnackbar(
          error.source === 'camera'
            ? (bn ? 'ক্যামেরার অনুমতি লাগবে — সেটিংস থেকে দিন' : 'Camera access is needed — allow it in Settings')
            : (bn ? 'ছবি দেখার অনুমতি লাগবে — সেটিংস থেকে দিন' : 'Photo access is needed — allow it in Settings'),
          'danger',
        );
        return;
      }
      showSnackbar(bn ? 'ছবি সংরক্ষণ করা গেল না' : 'Could not save the photo', 'danger');
    }
  }, [db, editingId, bn, showSnackbar]);

  const removeStaged = useCallback(async (item: StagedAttachment) => {
    try {
      await discardStagedAttachments([item]);
      stagedRef.current = stagedRef.current.filter((p) => p.id !== item.id);
      setStaged(stagedRef.current);
    } catch { showSnackbar(bn ? 'মোছা গেল না' : 'Could not remove it', 'danger'); }
  }, [bn, showSnackbar]);

  const removePhoto = useCallback(async (photo: Attachment) => {
    try {
      if (await removeAttachment(db, photo)) { setPhotos((current) => current.filter((p) => p.id !== photo.id)); showSnackbar(bn ? 'ছবি মুছে ফেলা হয়েছে' : 'Photo removed', 'success'); }
    } catch { showSnackbar(bn ? 'মোছা গেল না' : 'Could not remove it', 'danger'); }
  }, [db, bn, showSnackbar]);

  const pinPlace = useCallback(async () => {
    tapLight();
    const result = await capturePlace(true);
    if (result.status !== 'captured') {
      warn();
      showSnackbar(bn ? 'জায়গা পাওয়া গেল না' : 'Could not read the place', 'danger');
      return;
    }
    // No name from the phone (common offline): reuse the name already given to this spot,
    // or ask for one.
    const label = result.place.label ?? await knownNameNear(db, result.place.latitude, result.place.longitude).catch(() => null);
    const place = { ...result.place, label };
    await keepPlace(place);
    success();
    setCurrentPlace(place);
    setPlaceLabel(describePlace(place, bn ? 'bn' : 'en'));
    if (!label) setPlaceName('');
  }, [db, keepPlace, bn, showSnackbar]);

  useEffect(() => {
    let alive = true;
    recentNamedPlaces(db).then((list) => { if (alive) setRecentPlaces(list); }).catch(() => {});
    return () => { alive = false; };
  }, [db]);

  const pickPlace = useCallback(async (picked: Place) => {
    tapLight();
    const place = { ...picked, capturedAt: new Date().toISOString() };
    await keepPlace(place);
    setCurrentPlace(place);
    setPlaceLabel(describePlace(place, bn ? 'bn' : 'en'));
    setPlaceName(null);
  }, [keepPlace, bn]);

  // "নিজে লিখুন": the person's own name for the place. It used to be saved only on top of
  // a GPS fix, so with location off — or with the phone's own name ("Beanibazar, Sylhet
  // Division") already there — nothing could be typed at all. With a fix, the name goes on
  // those coordinates. Without one it is kept on its own: the places table requires
  // coordinates, so a typed-only place sits at 0,0 — nowhere near any real capture here,
  // and never shown, since every screen reads the name alone.
  const savePlaceName = useCallback(async () => {
    const name = (placeName ?? '').trim();
    if (!name) { setPlaceName(null); return; }
    const base = currentPlace ?? { latitude: 0, longitude: 0, label: null, capturedAt: new Date().toISOString() };
    const place = { ...base, label: name };
    await keepPlace(place);
    success();
    setCurrentPlace(place);
    setPlaceLabel(name);
    setPlaceName(null);
    setRecentPlaces((list) => [place, ...list.filter((p) => p.label !== name)].slice(0, 6));
  }, [keepPlace, placeName, currentPlace]);

  const remove = useCallback(async () => {
    setConfirmDelete(false);
    if (!editingId) return;
    tapLight();
    try {
      await deleteEntry(db, editingId);
      // Same as the entry screen's delete: an entry that was the wallet side of a debt
      // payment or collection takes that ledger movement with it, or the debt stays
      // reduced by a payment that no longer exists anywhere.
      await removeDebtTransactionForDeletedFinanceEntry(db, editingId, bangladeshDateKey(new Date())).catch(() => {});
      showSnackbar(bn ? 'মুছে ফেলা হয়েছে' : 'Deleted', 'success');
      router.back();
    } catch {
      warn();
      showSnackbar(bn ? 'মোছা যায়নি' : 'Could not delete', 'danger');
    }
  }, [db, editingId, bn, showSnackbar]);

  const income = kind === 'INCOME';
  const parsed = (() => { try { return amount.trim() ? parseTakaToPaisa(amount) : 0; } catch { return 0; } })();

  const dayChips: { label: string; value: string }[] = [
    { label: bn ? 'আজ' : 'Today', value: todayISO() },
    { label: bn ? 'গতকাল' : 'Yesterday', value: shiftDay(todayISO(), -1) },
    { label: bn ? 'পরশু' : '2 days ago', value: shiftDay(todayISO(), -2) },
  ];

  const needLabel = (n: Need) => {
    if (!bn) return { ESSENTIAL: 'Essential', NEEDED: 'Needed', WANT: 'A want' }[n];
    return { ESSENTIAL: 'অপরিহার্য', NEEDED: 'দরকারি', WANT: 'শখ' }[n];
  };

  const recurrenceLabel = (r: Recurrence) => {
    if (!bn) return { NONE: 'One-off', DAILY: 'Every day', WEEKLY: 'Every week', MONTHLY: 'Every month', YEARLY: 'Every year' }[r];
    return { NONE: 'একবারই', DAILY: 'প্রতিদিন', WEEKLY: 'প্রতি সপ্তাহে', MONTHLY: 'প্রতি মাসে', YEARLY: 'প্রতি বছরে' }[r];
  };

  return (
    // Save used to sit wherever the form's own scroll left it, and the keyboard opening
    // over the bottom of a long form put it out of reach — a real tap that landed on
    // nothing, not a broken button. Letting the keyboard push the layout up keeps it
    // reachable by the same scroll gesture that reaches everything else on the page.
    // (The keyboard itself is handled once, for every screen, in the root layout.)
    <View style={s.flex}>
      <ScrollView keyboardDismissMode="on-drag" style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader
        title={editingId ? (bn ? 'হিসাব বদলান' : 'Edit entry') : income ? (bn ? 'আয় যোগ' : 'Add income') : (bn ? 'ব্যয় যোগ' : 'Add expense')}
        backTo="/finance"
        backLabel={bn ? 'আয়-ব্যয়' : 'Income & spending'}
        onBack={() => guard.attemptLeave(() => { dropStaged(); router.dismissTo('/finance' as never); })}
      />

      <View style={s.kindRow}>
        {(['EXPENSE', 'INCOME'] as EntryKind[]).map((k) => (
          <Chip
            key={k}
            label={k === 'INCOME' ? (bn ? 'আয়' : 'Income') : (bn ? 'ব্যয়' : 'Expense')}
            active={kind === k}
            onPress={() => { tapLight(); setKind(k); }}
          />
        ))}
      </View>

      <Field
        label={bn ? 'কত টাকা' : 'How much'}
        value={amount}
        onChangeText={edited(setAmount)}
        placeholder={bn ? 'যেমন ১২৫০' : 'e.g. 1250'}
        keyboardType="numeric"
        autoFocus={!editingId}
        hint={parsed ? formatPaisa(parsed, { bnDigits: bn }) : undefined}
      />

      {prices ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bn ? 'আগের দাম বসান' : 'Use the last amount'}
          onPress={() => { tapLight(); setAmount(paisaToTakaString(prices.lastPaisa)); }}
          style={({ pressed }) => StyleSheet.flatten([s.priceRow, pressed && s.pressed])}
        >
          <AppIcon name="history" size={iconSize.sm} color={colors.textMuted} />
          <Text numberOfLines={2} style={s.priceText}>
            {bn
              ? `গত বার ${formatPaisa(prices.lastPaisa, { bnDigits: true })}${prices.typicalPaisa !== prices.lastPaisa ? ` · সাধারণত ${formatPaisa(prices.typicalPaisa, { bnDigits: true })}` : ''} — চাপ দিলে বসে যাবে`
              : `Last time ${formatPaisa(prices.lastPaisa)}${prices.typicalPaisa !== prices.lastPaisa ? ` · usually ${formatPaisa(prices.typicalPaisa)}` : ''} — tap to use it`}
          </Text>
        </Pressable>
      ) : null}

      <Field
        label={income ? (bn ? 'কোন খাত থেকে এল' : 'What it came from') : (bn ? 'কোন খাতে গেল' : 'What it went on')}
        value={category}
        onChangeText={edited(setCategory)}
        placeholder={bn ? 'নিজে লিখুন, বা নিচ থেকে বাছুন' : 'Type your own, or pick below'}
      />
      <View style={s.chips}>
        {categories.slice(0, 14).map((c) => (
          <Chip key={c} label={c} active={category === c} onPress={() => { tapLight(); setCategory(c); }} />
        ))}
      </View>

      {accounts.length ? (
        <View style={s.bridgeBox}>
          <ChipGroup
            label={debtDirection === 'DEBT'
              ? (bn ? 'কোন দেনায় গেল?' : 'Which debt is this paying?')
              : (bn ? 'কোন পাওনা আদায় হলো?' : 'Which receivable is this?')}
            labelStyle={s.label}
            options={accounts.slice(0, 8).map((account) => account.id)}
            value={accountId}
            labelOf={(id) => {
              const account = accounts.find((a) => a.id === id);
              return account ? `${account.personName} · ${formatPaisa(account.outstandingPaisa, { bnDigits: bn })}` : '';
            }}
            onChange={(next) => { tapLight(); setAccountId(next); }}
          />
          <Text style={s.dayNote}>
            {accountId
              ? (bn
                ? 'বেছে নেওয়া হয়েছে — একবার সংরক্ষণ করলেই দেনার খাতা আর আয়-ব্যয় দুটোতেই লেখা হবে, দুবার লিখতে হবে না।'
                : 'Chosen — saving once writes it into both the debt ledger and this book, so you never enter it twice.')
              : (bn
                ? 'কোনোটি বাছলে দেনার খাতাতেও নিজে থেকেই লেখা হবে। না বাছলে শুধু এখানেই থাকবে।'
                : 'Pick one and the debt ledger is updated too. Leave it and this stays a plain entry.')}
          </Text>
        </View>
      ) : null}

      {!income && category.trim() ? (
        <>
          <ChipGroup
            label={bn ? 'এই খরচটা কেমন?' : 'What kind of spending is this?'}
            labelStyle={s.label}
            options={NEEDS}
            value={need}
            labelOf={needLabel}
            onChange={(next) => { tapLight(); setNeed(next ?? 'NEEDED'); }}
          />
          <Text style={s.dayNote}>
            {bn
              ? 'একবার বলে দিলেই হবে — অ্যাপ এটা মনে রাখবে আর এই হিসাবেই সতর্ক করবে।'
              : 'Say it once; the app remembers, and every warning it gives is based on your answer.'}
          </Text>
        </>
      ) : null}

      <Field
        label={income ? (bn ? 'কীভাবে এল' : 'How it came') : (bn ? 'কীভাবে দিলেন' : 'How it was paid')}
        value={method}
        onChangeText={edited(setMethod)}
        placeholder={bn ? 'নিজে লিখুন, বা নিচ থেকে বাছুন' : 'Type your own, or pick below'}
      />
      <View style={s.chips}>
        {methods.map((m) => (
          <Chip key={m} label={m} active={method === m} onPress={() => { tapLight(); setMethod(method === m ? '' : m); }} />
        ))}
      </View>

      <WalletPicker
        label={income ? (bn ? 'কোথায় জমা হলো' : 'Into which wallet') : (bn ? 'কোথা থেকে গেল' : 'Out of which wallet')}
        value={walletId}
        onChange={setWalletId}
        wallets={wallets}
        onWalletsChange={setWallets}
      />
      {!income ? (
        <FundSourcePicker
          value={fundSource}
          onChange={setFundSource}
          note={fundNote} onNoteChange={setFundNote} loanAccountId={fundAccountId}
          onLoanAccountChange={setFundAccountId}
          excludeAccountId={accountId}
        />
      ) : null}

      <ChipGroup
        label={bn ? 'কবে' : 'When'}
        labelStyle={s.label}
        options={dayChips.map((d) => d.value)}
        value={dayChips.some((d) => d.value === occurredOn) ? occurredOn : null}
        labelOf={(v) => dayChips.find((d) => d.value === v)?.label ?? ''}
        onChange={(next) => { tapLight(); setOccurredOn(next ?? todayISO()); }}
      />
      {/* Any day, past or future — a bill paid last year or a salary due next month (RC.4 QA). */}
      <AppDateField
        value={occurredOn}
        onChange={(next) => setOccurredOn(next ?? todayISO())}
        accessibilityLabel={bn ? 'অন্য তারিখ বাছুন' : 'Pick another date'}
      />

      <Pressable
        accessibilityRole="button"
        onPress={() => { tapLight(); setShowMore((v) => !v); }}
        style={({ pressed }) => StyleSheet.flatten([s.moreToggle, pressed && s.pressed])}
      >
        <AppIcon name={showMore ? 'chevron-up' : 'chevron-down'} size={iconSize.sm} color={colors.primary} />
        <Text numberOfLines={1} style={s.moreText}>
          {bn ? 'কার সাথে, পুনরাবৃত্তি, নোট' : 'Who, repeats, note'}
        </Text>
      </Pressable>

      {showMore ? (
        <>
          <Field
            label={income ? (bn ? 'কার কাছ থেকে' : 'From whom') : (bn ? 'কাকে দিলেন' : 'To whom')}
            value={personName}
            onChangeText={(v) => { setPersonName(v); setPersonId(null); setSuggestionsOpen(true); setTouched(true); }}
            placeholder={bn ? 'নাম লিখুন — ঐচ্ছিক' : 'A name — optional'}
          />
          {/* Matches from the phone's own contact book, as the name is typed — Bengali or
              English, whichever it is already saved in. Silent when there is nothing to
              show: no permission, no match, or a suggestion already accepted. */}
          {suggestionsOpen && visibleSuggestions.length > 0 ? (
            <View style={s.suggestBox}>
              {visibleSuggestions.map((c, i) => (
                <Pressable
                  key={`${c.name}-${c.phone ?? i}`}
                  accessibilityRole="button"
                  onPress={() => {
                    tapLight();
                    setPersonName(c.name);
                    setPersonPhone(c.phone);
                    setPersonId(null);
                    setSuggestionsOpen(false);
                  }}
                  style={({ pressed }) => StyleSheet.flatten([s.suggestRow, pressed && s.pressed])}
                >
                  <AppIcon name="account-outline" size={iconSize.sm} color={colors.textMuted} />
                  <Text numberOfLines={1} style={s.suggestName}>{c.name}</Text>
                  {c.phone ? <Text numberOfLines={1} style={s.suggestPhone}>{c.phone}</Text> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => void fromContacts()}
            style={({ pressed }) => StyleSheet.flatten([s.inline, pressed && s.pressed])}
          >
            <AppIcon name="card-account-details-outline" size={iconSize.sm} color={colors.primary} />
            <Text numberOfLines={1} style={s.inlineText}>
              {bn ? 'ফোনের কন্টাক্ট থেকে নিন' : 'Pick from contacts'}
            </Text>
          </Pressable>

          <ChipGroup
            label={bn ? 'বারবার হয়?' : 'Does it repeat?'}
            labelStyle={s.label}
            options={RECURRENCES}
            value={recurring}
            labelOf={recurrenceLabel}
            onChange={(next) => { tapLight(); setRecurring(next ?? 'NONE'); }}
          />

          <Field label={bn ? 'নোট' : 'Note'} value={note} onChangeText={edited(setNote)} multiline placeholder={bn ? 'ঐচ্ছিক' : 'Optional'} />
        </>
      ) : null}

      <Card title={bn ? 'রশিদ ও জায়গা' : 'Receipt & place'}>
        {/* The same gallery as every other screen (RC.5): tiles, a "+" tile, tap to open. */}
        <FileGallery
          items={[...staged, ...photos]}
          header={false}
          hint={bn ? 'রশিদ, মেমো বা বিলের ছবি বা PDF' : 'A photo or PDF of the receipt, memo or bill'}
          onPick={(source) => void takePhoto(source)}
          onShare={(g) => { const it = photos.find((p) => p.id === g.id); if (it) void shareAttachment(it).catch(() => undefined); }}
          onRemove={(g) => {
            const kept = staged.find((p) => p.id === g.id);
            if (kept) { void removeStaged(kept); return; }
            const it = photos.find((p) => p.id === g.id); if (it) void removePhoto(it);
          }}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => void pinPlace()}
          style={({ pressed }) => StyleSheet.flatten([s.proof, pressed && s.pressed])}
        >
          <View style={[s.proofIcon, { backgroundColor: accents.green.soft }]}>
            <AppIcon name={placeLabel ? 'check' : 'map-marker-outline'} size={iconSize.sm} color={accents.green.on} />
          </View>
          <Text numberOfLines={1} style={s.proofText}>
            {placeLabel ?? (bn ? 'বর্তমান অবস্থান নিন' : 'Use current location')}
          </Text>
        </Pressable>
        {placeName !== null ? (
          <View style={s.placeNameRow}>
            <View style={{ flex: 1 }}>
              <Field
                label={bn ? 'জায়গাটির নাম দিন' : 'Name this place'}
                value={placeName}
                onChangeText={setPlaceName}
                placeholder={bn ? 'যেমন: বাজার, অফিস, বাসা' : 'e.g. Market, Office, Home'}
              />
            </View>
            <Chip label={bn ? 'রাখুন' : 'Save'} active icon="check" onPress={() => void savePlaceName()} />
          </View>
        ) : null}
        {placeName === null || recentPlaces.some((p) => p.label !== placeLabel) ? (
          <View style={s.chips}>
            {placeName === null ? (
              <Chip label={bn ? 'নিজে লিখুন' : 'Type it yourself'} active={false} icon="pencil-outline" onPress={() => { tapLight(); setPlaceName(cleanPlaceLabel(currentPlace?.label) ?? ''); }} />
            ) : null}
            {recentPlaces.filter((p) => p.label !== placeLabel).map((p) => (
              <Chip key={p.label!} label={p.label!} active={false} icon="map-marker-outline" onPress={() => void pickPlace(p)} />
            ))}
          </View>
        ) : null}

      </Card>

      {editingId ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => { tapLight(); setConfirmDelete(true); }}
          style={({ pressed }) => StyleSheet.flatten([s.delete, pressed && s.pressed])}
        >
          <Text numberOfLines={1} style={[s.deleteText, { color: accents.red.on }]}>
            {bn ? 'এই হিসাবটি মুছে দিন' : 'Delete this entry'}
          </Text>
        </Pressable>
      ) : null}

      {/* Deleting used to happen on the first tap. It is the one irreversible thing this
          form can do, so it asks — same dialog every other module uses. */}
      <AppConfirmDialog
        visible={guard.confirming}
        title={bn ? 'পরিবর্তন বাতিল করবেন?' : 'Discard your changes?'}
        description={bn ? 'যা লিখেছেন তা সংরক্ষণ হয়নি।' : 'What you typed has not been saved.'}
        confirmLabel={bn ? 'বাতিল করুন' : 'Discard'}
        cancelLabel={bn ? 'লিখতে থাকি' : 'Keep editing'}
        danger
        icon="alert"
        onConfirm={() => { guard.setConfirming(false); dropStaged(); router.back(); }}
        onCancel={() => guard.setConfirming(false)}
      />

      <AppConfirmDialog
        visible={confirmDelete}
        title={bn ? 'হিসাবটি মুছে ফেলবেন?' : 'Delete this entry?'}
        description={bn ? 'মাসের যোগফল থেকে বাদ যাবে।' : 'It stops counting towards the month.'}
        confirmLabel={bn ? 'মুছুন' : 'Delete'}
        cancelLabel={bn ? 'থাক' : 'Cancel'}
        danger
        icon="alert"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />

      </ScrollView>

      {/* Outside the ScrollView, deliberately.
          Save used to be the last thing in the scrolling content, which meant that on a
          form this long — amount, category, need, method, wallet, date, then an entire
          attachments card — it was several swipes below the fold. Someone who had filled
          in every field still had to go looking for the button that saves it, and on a
          short screen with the keyboard up it was not on screen at all. A form's commit
          action belongs where the thumb already is. */}
      <FormBar
        onCancel={() => guard.attemptLeave(() => { dropStaged(); router.back(); })}
        onSave={() => void save()}
        saving={saving}
        saveLabel={bn ? 'সংরক্ষণ' : 'Save'}
      />
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    root: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
    kindRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    // `fontFamily` here is a real 700-weight Bengali font file, not a numeric fontWeight
    // asked of a named 500-weight one. The clipped-glyph bug this form kept showing --
    // reported live on-device, still present after a marginTop fix that should have been
    // enough for a plain spacing issue -- traces to that: Android has to synthetically
    // embolden a specific named font file to fake a weight it was never built for, and
    // that synthesis is what was slicing Bengali conjuncts/matras. Loading the actual bold
    // file instead means nothing needs to be faked.
    label: { color: colors.textSecondary, ...typography.caption, fontFamily: fonts.bold, marginTop: spacing.md, marginBottom: spacing.xs },
    dayNote: { color: colors.textMuted, ...typography.caption, marginTop: 2, lineHeight: 17 },
    priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: layout.minTouchTarget - 8, paddingHorizontal: spacing.xs },
    priceText: { flex: 1, minWidth: 0, color: colors.textMuted, ...typography.caption, lineHeight: 17 },
    bridgeBox: { borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs },
    moreToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: layout.minTouchTarget, marginTop: spacing.xs },
    moreText: { color: colors.primary, ...typography.body, fontWeight: '800', flexShrink: 1 },
    inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: layout.minTouchTarget },
    inlineText: { color: colors.primary, ...typography.bodySmall, fontWeight: '700', flexShrink: 1 },
    suggestBox: { marginTop: -spacing.xs, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, overflow: 'hidden' },
    suggestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget, paddingHorizontal: spacing.sm, borderBottomWidth: border.thin, borderBottomColor: colors.border },
    suggestName: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    suggestPhone: { color: colors.textMuted, ...typography.caption },
    proofIcon: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  proof: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, minHeight: control.rowMinHeight, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, marginBottom: spacing.xs },
    placeNameRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
    proofText: { color: colors.textPrimary, ...typography.body, fontWeight: '700', flexShrink: 1 },
    delete: { minHeight: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
    deleteText: { ...typography.callout, fontWeight: '800', flexShrink: 1 },
    pressed: { opacity: 0.78 },
  });
}
