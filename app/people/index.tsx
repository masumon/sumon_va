// Everyone you keep track of.
//
// Ordered by how much money stands between you rather than alphabetically. A list of
// names is a phone book; a list of standings answers the question people actually open
// this screen with, which is "who do I need to deal with".

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text, AppTextInput as TextInput } from '../../src/ui/AppText';
import { AppIcon } from '../../src/ui/AppIcon';
import { EmptyNote, ScreenHeader, useKit } from '../../src/ui/AppKit';
import { useAppFeedback } from '../../src/ui/AppFeedback';
import { asciiDigitsToBengali, formatPaisa } from '../../src/services/debt/money';
import { listPeopleWithStanding, type PersonSummary } from '../../src/services/person-view-service';
import { findOrCreatePerson } from '../../src/services/people-service';
import { pickContact, describeContactDenial } from '../../src/services/capture/contacts';
import { border, control, icon as iconSize, layout, radius, spacing, typography, type ThemeColors } from '../../src/theme';
import { success, tapLight, warn } from '../../src/ui/haptics';

/** "৩ দিন আগে" — how long since you last spoke, in words rather than a date. */
function sinceLabel(iso: string | null, bn: boolean): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  const n = (value: number) => (bn ? asciiDigitsToBengali(String(value)) : String(value));
  if (days <= 0) return bn ? 'আজ কথা হয়েছে' : 'spoke today';
  if (days === 1) return bn ? 'গতকাল কথা হয়েছে' : 'spoke yesterday';
  if (days < 30) return bn ? `${n(days)} দিন আগে কথা` : `${days} days ago`;
  const months = Math.floor(days / 30);
  return bn ? `${n(months)} মাস আগে কথা` : `${months} months ago`;
}

export default function PeopleScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<PersonSummary[]>([]);

  const money = useCallback((paisa: number) => formatPaisa(paisa, { bnDigits: bn }), [bn]);

  const load = useCallback(async () => {
    try { setPeople(await listPeopleWithStanding(db, query)); }
    catch { setPeople([]); }
  }, [db, query]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const addFromContacts = useCallback(async () => {
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
    try {
      const person = await findOrCreatePerson(db, result.contact);
      success();
      router.push(`/people/${person.id}` as never);
    } catch {
      warn();
      showSnackbar(bn ? 'যোগ করা গেল না' : 'Could not add them', 'danger');
    }
  }, [db, bn, showSnackbar]);

  return (
    <ScrollView keyboardDismissMode="on-drag" style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader
        title={bn ? 'মানুষ' : 'People'}
        subtitle={bn ? 'কার সাথে কীভাবে দাঁড়িয়ে আছেন' : 'Where you stand with each of them'}
        backTo="/"
        backLabel={bn ? 'হোম' : 'Home'}
      />

      <View style={s.searchRow}>
        <AppIcon name="magnify" size={iconSize.md} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={bn ? 'নাম বা নম্বর' : 'Name or number'}
          placeholderTextColor={colors.textMuted}
          style={s.searchInput}
          accessibilityLabel={bn ? 'মানুষ খুঁজুন' : 'Search people'}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => void addFromContacts()}
        style={({ pressed }) => StyleSheet.flatten([s.addRow, pressed && s.pressed])}
      >
        <AppIcon name="card-account-details-outline" size={iconSize.md} color={colors.primary} />
        <Text numberOfLines={1} style={s.addText}>
          {bn ? 'ফোনের কন্টাক্ট থেকে যোগ করুন' : 'Add from your contacts'}
        </Text>
      </Pressable>

      {people.length ? (
        people.map((person) => {
          const owed = person.netPaisa;
          const tone = owed > 0 ? accents.green : owed < 0 ? accents.red : accents.blue;
          const since = sinceLabel(person.lastContactAt, bn);
          return (
            <Pressable
              key={person.id}
              accessibilityRole="button"
              accessibilityLabel={person.name}
              onPress={() => { tapLight(); router.push(`/people/${person.id}` as never); }}
              style={({ pressed }) => StyleSheet.flatten([s.row, pressed && s.pressed])}
            >
              <View style={[s.avatar, { backgroundColor: tone.soft }]}>
                <Text style={[s.avatarText, { color: tone.on }]}>{person.name.trim().slice(0, 1)}</Text>
              </View>
              <View style={s.grow}>
                <Text numberOfLines={1} style={s.name}>{person.name}</Text>
                <Text numberOfLines={1} style={s.meta}>
                  {[
                    owed > 0 ? (bn ? `আপনি পাবেন ${money(owed)}` : `owes you ${money(owed)}`)
                      : owed < 0 ? (bn ? `আপনি দেবেন ${money(-owed)}` : `you owe ${money(-owed)}`)
                      : (bn ? 'হিসাব পরিষ্কার' : 'settled'),
                    since,
                  ].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <AppIcon name="chevron-right" size={iconSize.md} color={colors.textMuted} />
            </Pressable>
          );
        })
      ) : (
        <EmptyNote
          icon="account-multiple-outline"
          text={query.trim()
            ? (bn ? 'এই নামে কাউকে পাওয়া গেল না।' : 'Nobody by that name.')
            : (bn ? 'এখনো কারো নাম লেখা হয়নি।' : 'No one yet.')}
          action={query.trim() ? undefined : (bn ? 'কন্টাক্ট থেকে যোগ করুন' : 'Add from contacts')}
          onAction={query.trim() ? undefined : () => void addFromContacts()}
        />
      )}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    grow: { flex: 1, minWidth: 0 },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: control.buttonHeight, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, marginTop: spacing.sm },
    searchInput: { flex: 1, color: colors.textPrimary, ...typography.body, paddingVertical: spacing.sm },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget, marginTop: spacing.sm, marginBottom: spacing.xs },
    addText: { color: colors.primary, ...typography.body, fontWeight: '800', flexShrink: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget + 14, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs },
    avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    avatarText: { ...typography.cardTitle, fontWeight: '800' },
    name: { color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    meta: { color: colors.textMuted, ...typography.caption, marginTop: 1 },
    pressed: { opacity: 0.78 },
  });
}
