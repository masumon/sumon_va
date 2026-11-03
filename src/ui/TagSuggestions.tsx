// Tags work by themselves (the user's rule, RC.2): most people do not know what a tag is,
// so there is no box to type into. The app suggests the tags that fit what was written;
// one tap adds or removes one. Anything not chosen is filled in automatically on save
// (see autoTags), so search and the Assistant can still group things.

import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from './AppText';
import { AppIcon } from './AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { extractTags } from '../ai/nlp/entities';
import { border, radius, spacing, typography } from '../theme';

const LABEL: Record<string, { bn: string; en: string }> = {
  work: { bn: 'কাজ-অফিস', en: 'Work' },
  money: { bn: 'টাকা-পয়সা', en: 'Money' },
  health: { bn: 'স্বাস্থ্য', en: 'Health' },
  home: { bn: 'বাসা-বাড়ি', en: 'Home' },
  family: { bn: 'পরিবার', en: 'Family' },
  study: { bn: 'পড়াশোনা', en: 'Study' },
};

export function tagLabel(tag: string, bn: boolean): string {
  const l = LABEL[tag];
  return l ? (bn ? l.bn : l.en) : tag;
}

/** Tags the text itself calls for — used when the person picked none. */
export function autoTags(text: string): string[] {
  return extractTags(text);
}

export function TagSuggestions({ text, selected, onChange }: { text: string; selected: string[]; onChange: (next: string[]) => void }) {
  const { colors, language } = useAppPreferences();
  const bn = language === 'bn';
  // What fits the text first, then whatever is already on the item, then the rest.
  const fits = extractTags(text);
  // Only what the text calls for, plus what is already on the item — nothing when nothing
  // fits (RC.4 QA: a wall of unrelated tags on every note).
  const all = [...new Set([...fits, ...selected])];
  if (!all.length) return null;
  const toggle = (tag: string) => onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  return (
    <View style={styles.wrap}>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        {bn ? 'চাইলে বেছে নিন — না বাছলে অ্যাপ নিজেই মিলিয়ে দেবে' : 'Tap to add — otherwise the app sorts it for you'}
      </Text>
      <View style={styles.row}>
        {all.map((tag) => {
          const on = selected.includes(tag);
          const suggested = !on && fits.includes(tag);
          return (
            <Pressable
              key={tag}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => toggle(tag)}
              style={({ pressed }) => [
                styles.chip,
                { borderColor: on || suggested ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface },
                pressed && { opacity: 0.8 },
              ]}
            >
              <AppIcon name={on ? 'check-circle' : suggested ? 'star' : 'plus'} size={16} color={on ? colors.onPrimary : colors.primary} />
              <Text style={[styles.chipText, { color: on ? colors.onPrimary : colors.textPrimary }]}>{tagLabel(tag, bn)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  hint: { ...typography.caption },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: spacing.sm, borderRadius: radius.pill ?? 999, borderWidth: border.thin },
  chipText: { ...typography.callout },
});
