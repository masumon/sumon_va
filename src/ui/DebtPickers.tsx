// Choosing a person.
//
// The generic controls this file used to hold — multi-select, the on/off row, the
// multi-value helpers — now live in `AppKit`, because health, study and income will all
// want them too. What stayed is the one control that still depends on the debt module's
// own `people` table; it moves to AppKit when that table becomes shared.
//
// The idea behind it: a long list of names must not arrive uninvited. The field is a
// search box that shows the few most relevant people, not everyone the user has ever
// borrowed from.

import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from './AppText';
import { AppIcon } from './AppIcon';
import { tapLight, tapSelect } from './haptics';
import { useDebt } from './DebtKit';
import type { Person } from '../services/debt/types';
import { border, control, icon, layout, radius, spacing, typography } from '../theme';

export interface PersonPickerProps {
  people: Person[];
  /** The chosen existing person, if any. */
  personId: string | null;
  onPickExisting: (id: string | null) => void;
  /** A name typed in when nobody in the list matches — created on save. */
  typedName: string;
  onTypeName: (name: string) => void;
  label?: string;
  /** Offered on the person screen only; the create form has its own contact button. */
  onImportContact?: () => void;
  importing?: boolean;
}

/**
 * Choose who the money came from — or name someone new, in one field.
 *
 * The old form rendered every person as a chip, so the field grew without limit and the
 * amount box was pushed off screen. Here the box is a search: typing filters the list and,
 * when nothing matches, the same text becomes the new person's name. No separate "add
 * person" trip, and no duplicate created by accident, because near-matches stay visible
 * while you type.
 */
export function PersonPicker({
  people, personId, onPickExisting, typedName, onTypeName, label, onImportContact, importing,
}: PersonPickerProps) {
  const { s, c, bn, colors } = useDebt();
  const selected = people.find((p) => p.id === personId) ?? null;

  const matches = useMemo(() => {
    const q = typedName.trim().toLowerCase();
    if (!q) return people.slice(0, 6);
    return people.filter((p) => `${p.name} ${p.phone ?? ''}`.toLowerCase().includes(q)).slice(0, 8);
  }, [people, typedName]);

  const exactExists = people.some((p) => p.name.trim().toLowerCase() === typedName.trim().toLowerCase());

  if (selected) {
    return (
      <View>
        <Text style={s.label}>{label ?? c.person}</Text>
        <View style={styles.selectedRow}>
          <View style={[styles.avatar, { backgroundColor: colors.primaryTint }]}>
            <AppIcon name="account" size={icon.md} color={colors.primary} />
          </View>
          <View style={s.grow}>
            <Text numberOfLines={1} style={s.listTitle}>{selected.name}</Text>
            {selected.phone ? <Text numberOfLines={1} style={s.listMeta}>{selected.phone}</Text> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'অন্য কেউ বেছে নিন' : 'Choose someone else'}
            onPress={() => { tapLight(); onPickExisting(null); onTypeName(''); }}
            style={({ pressed }) => StyleSheet.flatten([styles.changeBtn, pressed && s.pressed])}
          >
            <Text style={[s.chipText, { color: colors.primary }]}>{bn ? 'বদলান' : 'Change'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text style={s.label}>{label ?? c.person}</Text>
      <View style={styles.addRow}>
        <TextInput
          value={typedName}
          onChangeText={onTypeName}
          placeholder={bn ? 'নাম লিখুন বা খুঁজুন' : 'Type or search a name'}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={bn ? 'ব্যক্তির নাম' : 'Person name'}
          style={[s.input, styles.grow]}
        />
        {onImportContact ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'ফোনবুক থেকে নিন' : 'Pick from contacts'}
            disabled={importing}
            onPress={onImportContact}
            style={({ pressed }) => StyleSheet.flatten([styles.addBtn, { backgroundColor: colors.surfaceMuted }, pressed && s.pressed])}
          >
            {importing
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <AppIcon name="account-box-outline" size={icon.md} color={colors.primary} />}
          </Pressable>
        ) : null}
      </View>

      {matches.length ? (
        <View style={s.chipRow}>
          {matches.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={p.name}
              onPress={() => { tapSelect(); onPickExisting(p.id); onTypeName(''); }}
              style={({ pressed }) => StyleSheet.flatten([s.chipHit, pressed && s.pressed])}
            >
              <View style={s.chip}>
                <AppIcon name="account-outline" size={icon.xs} color={colors.textSecondary} />
                <Text numberOfLines={1} style={s.chipText}>{p.name}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {typedName.trim() && !exactExists ? (
        <Text style={s.fieldHint}>
          {bn
            ? `“${typedName.trim()}” নামে নতুন ব্যক্তি তৈরি হবে।`
            : `“${typedName.trim()}” will be added as a new person.`}
        </Text>
      ) : null}
      {typedName.trim() && matches.length === 0 ? null : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addBtn: { width: control.inputHeight, height: control.inputHeight, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: control.rowMinHeight },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  changeBtn: { minHeight: layout.minTouchTarget, paddingHorizontal: spacing.md, justifyContent: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: control.rowMinHeight, paddingVertical: spacing.xs },
  track: { width: 48, height: 28, borderRadius: radius.pill, padding: 3, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: radius.pill },
  knobOn: { alignSelf: 'flex-end' },
  hidden: { borderWidth: border.thin, ...typography.caption },
});
