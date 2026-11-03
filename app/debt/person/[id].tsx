// A person's record.
//
// Three of these fields — address, relationship and note — have been in the database and
// in every backup since the module shipped, with no screen that could write or show them.
// The name and phone could be set once, at creation, and never corrected. So this screen
// exists mostly to close that gap: everything stored about a person is here, editable, and
// with their accounts listed underneath so it is obvious who is being edited.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../../src/ui/AppText';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppConfirmDialog, useAppFeedback } from '../../../src/ui/AppFeedback';
import { updatePersonDetails } from '../../../src/services/debt/editing';
import { getPerson, listAccounts, softDeletePerson } from '../../../src/services/debt/repository';
import { getPersonStatement, type PersonStatement } from '../../../src/services/debt/statements';
import type { Account, Person } from '../../../src/services/debt/types';
import { AppIcon } from '../../../src/ui/AppIcon';
import { Card, DebtHeader, EmptyNote, Field, FormBar, Stat, useDebt } from '../../../src/ui/DebtKit';
import { useUnsavedGuard } from '../../../src/hooks/useUnsavedGuard';
import { success, warn } from '../../../src/ui/haptics';
import { icon, spacing } from '../../../src/theme';
import { logAppError } from '../../../src/services/error-log';

export default function PersonScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { s, c, bn, colors, accents, money } = useDebt();
  const { showSnackbar } = useAppFeedback();

  const [person, setPerson] = useState<Person | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [statement, setStatement] = useState<PersonStatement | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'DELETE' | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [relationship, setRelationship] = useState('');
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setReady(true); return; }
    try {
      const [p, accs, st] = await Promise.all([getPerson(db, id), listAccounts(db, { personId: id }), getPersonStatement(db, id)]);
      setPerson(p); setAccounts(accs); setStatement(st);
      if (p) {
        setName(p.name);
        setPhone(p.phone ?? '');
        setAddress(p.address ?? '');
        setRelationship(p.relationship ?? '');
        setNotes(p.notes ?? '');
        setDirty(false);
      }
    } catch { setPerson(null); }
    finally { setReady(true); }
  }, [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const edited = (setter: (v: string) => void) => (v: string) => { setter(v); setDirty(true); };
  const guard = useUnsavedGuard(dirty && !busy);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/debt/people' as never));
  const leave = () => guard.attemptLeave(back);

  if (!ready) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!person || !id) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={s.container} contentContainerStyle={s.content}>
        <DebtHeader title={c.editPerson} />
        <EmptyNote icon="account-off-outline" text={bn ? 'ব্যক্তি পাওয়া যায়নি' : 'Person not found'} />
      </ScrollView>
    );
  }

  const save = async () => {
    if (busy || !id) return;
    if (!name.trim()) { warn(); showSnackbar(bn ? 'নাম দিন' : 'A name is required', 'danger'); return; }
    setBusy(true);
    try {
      await updatePersonDetails(db, id, {
        name: name.trim(),
        phone: phone.trim() || null,
        address: address.trim() || null,
        relationship: relationship.trim() || null,
        notes: notes.trim() || null,
      });
      success();
      showSnackbar(bn ? 'সংরক্ষিত হয়েছে' : 'Saved', 'success');
      back();
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/person/id', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setConfirm(null);
    if (busy || !id) return;
    setBusy(true);
    try {
      await softDeletePerson(db, id);
      success();
      showSnackbar(bn ? 'মুছে ফেলা হয়েছে' : 'Removed', 'success');
      router.replace('/debt/people' as never);
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/person/id', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  return (
    <View style={s.container}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <DebtHeader title={c.editPerson} subtitle={person.name} onBack={() => guard.attemptLeave(() => router.dismissTo('/debt' as never))} />

        <Card title={bn ? 'তথ্য' : 'Details'}>
          {!editing ? (
            <>
              <Stat label={c.name} value={name || '—'} />
              <Stat label={c.phone} value={phone || '—'} />
              <Stat label={c.relationship} value={relationship || '—'} />
              <Stat label={c.address} value={address || '—'} />
              <Stat label={c.note} value={notes || '—'} />
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditing(true)}
                style={({ pressed }) => StyleSheet.flatten([s.primary, { marginTop: spacing.sm }, pressed && s.pressed])}
              >
                <AppIcon name="pencil-outline" size={icon.sm} color={colors.onPrimary} />
                <Text style={s.primaryText}>{bn ? 'তথ্য সম্পাদনা' : 'Edit details'}</Text>
              </Pressable>
            </>
          ) : (
          <>
          <Field label={c.name} value={name} onChangeText={edited(setName)} placeholder={c.name} />
          <Field label={c.phone} value={phone} onChangeText={edited(setPhone)} keyboardType="phone-pad" placeholder={c.phone} />
          <Field label={c.relationship} value={relationship} onChangeText={edited(setRelationship)} placeholder={bn ? 'যেমন: ভাই, প্রতিবেশী, সহকর্মী' : 'e.g. brother, neighbour, colleague'} />
          <Field label={c.address} value={address} onChangeText={edited(setAddress)} multiline placeholder={c.address} />
          <Field label={c.note} value={notes} onChangeText={edited(setNotes)} multiline placeholder={c.note} />
          </>
          )}
        </Card>

        {statement && accounts.length ? (
          <Card title={bn ? 'এই ব্যক্তির সঙ্গে হিসাব' : 'Accounts with this person'}>
            <Stat label={c.totalDebt} value={money(statement.totalDebtRemainingPaisa)} tone={accents.red} />
            <Stat label={c.totalReceivable} value={money(statement.totalReceivableRemainingPaisa)} tone={accents.green} />
            <Stat
              label={bn ? 'সব মিলিয়ে' : 'Overall'}
              value={money(Math.abs(statement.netToYouPaisa))}
              hint={statement.netToYouPaisa >= 0 ? (bn ? 'আপনি পাবেন' : 'owed to you') : (bn ? 'আপনি দেবেন' : 'you owe')}
              tone={statement.netToYouPaisa >= 0 ? accents.green : accents.red}
            />
            <View style={{ marginTop: spacing.sm }}>
              {accounts.map((a) => (
                <Pressable
                  key={a.id}
                  accessibilityRole="button"
                  accessibilityLabel={a.title || person.name}
                  onPress={() => router.push(`/debt/account/${a.id}` as never)}
                  style={({ pressed }) => StyleSheet.flatten([s.listRow, pressed && s.pressed])}
                >
                  <AppIcon
                    name={a.direction === 'DEBT' ? 'arrow-up-bold-circle-outline' : 'arrow-down-bold-circle-outline'}
                    size={icon.md}
                    color={a.direction === 'DEBT' ? accents.red.on : accents.green.on}
                  />
                  <View style={s.grow}>
                    <Text numberOfLines={1} style={s.listTitle}>{a.title || (a.direction === 'DEBT' ? c.totalDebt : c.totalReceivable)}</Text>
                    <Text style={s.listMeta}>{c.status[a.status] ?? a.status}</Text>
                  </View>
                  <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/debt/statement/${id}` as never)}
              style={({ pressed }) => StyleSheet.flatten([s.ghost, { marginTop: spacing.sm }, pressed && s.pressed])}
            >
              <AppIcon name="file-document-outline" size={icon.sm} color={colors.primary} />
              <Text style={s.ghostText}>{bn ? 'পূর্ণ বিবরণী' : 'Full statement'}</Text>
            </Pressable>
          </Card>
        ) : (
          <Card title={bn ? 'বিপজ্জনক' : 'Danger zone'}>
            <Text style={s.fieldHint}>
              {bn ? 'এই ব্যক্তির কোনো হিসাব নেই, তাই তালিকা থেকে সরিয়ে দেওয়া যায়।' : 'This person has no accounts, so they can be removed from your list.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setConfirm('DELETE')}
              style={({ pressed }) => StyleSheet.flatten([s.dangerBtn, { marginTop: spacing.sm }, busy && s.disabled, pressed && s.pressed])}
            >
              <AppIcon name="trash-can-outline" size={icon.sm} color={colors.danger} />
              <Text style={s.dangerText}>{bn ? 'তালিকা থেকে সরান' : 'Remove from list'}</Text>
            </Pressable>
          </Card>
        )}

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      {editing ? <FormBar onCancel={leave} onSave={() => void save()} saving={busy} saveLabel={c.save} cancelLabel={c.cancel} /> : null}

      <AppConfirmDialog
        visible={confirm !== null || guard.confirming}
        title={guard.confirming ? c.unsavedAsk : (bn ? 'তালিকা থেকে সরাবেন?' : 'Remove from your list?')}
        description={guard.confirming ? c.unsavedWarn : (bn ? 'পরে আবার যোগ করা যাবে।' : 'You can add them again later.')}
        confirmLabel={guard.confirming ? c.discard : (bn ? 'সরান' : 'Remove')}
        cancelLabel={guard.confirming ? c.keepEditing : c.cancel}
        danger
        icon="alert"
        onConfirm={() => (guard.confirming ? (guard.setConfirming(false), back()) : void remove())}
        onCancel={() => { setConfirm(null); guard.setConfirming(false); }}
      />
    </View>
  );
}
