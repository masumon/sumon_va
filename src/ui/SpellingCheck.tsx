import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from './AppText';
import { AppIcon } from './AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { tapLight } from './haptics';
import type { SpellingSuggestion } from '../ai/nlp/spelling';
import { border, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../theme';

/**
 * "আপনি কি 'সকাল' বোঝাতে চেয়েছেন?" — asked before anything is saved (spelling.ts).
 * "হ্যাঁ" puts the corrected words in the box; "না, যেমন লিখেছি" keeps them as typed.
 */
export function SpellingCheck({ suggestion, onAccept, onKeep }: { suggestion: SpellingSuggestion; onAccept: (corrected: string) => void; onKeep: () => void }) {
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const words = suggestion.fixes.map((f) => `‘${f.to}’`).join(bn ? ' ও ' : ' and ');
  const typed = suggestion.fixes.map((f) => `‘${f.from}’`).join(bn ? ' ও ' : ' and ');
  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.head}>
        <AppIcon name="spellcheck" size={20} color={accents.blue.on} />
        <Text style={styles.title}>{bn ? `আপনি কি ${words} বোঝাতে চেয়েছেন?` : `Did you mean ${words}?`}</Text>
      </View>
      <Text style={styles.body}>{bn ? `লিখেছেন ${typed}। ঠিক করলে হবে:` : `You typed ${typed}. Corrected it reads:`}</Text>
      <Text style={styles.corrected}>{suggestion.corrected}</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" onPress={() => { tapLight(); onAccept(suggestion.corrected); }} style={({ pressed }) => StyleSheet.flatten([styles.yes, pressed && styles.pressed])}>
          <Text style={styles.yesText}>{bn ? `হ্যাঁ, ${suggestion.fixes[0]!.to}` : `Yes, ${suggestion.fixes[0]!.to}`}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { tapLight(); onKeep(); }} style={({ pressed }) => StyleSheet.flatten([styles.no, pressed && styles.pressed])}>
          <Text style={styles.noText}>{bn ? 'না, যেমন লিখেছি' : 'No, as I typed'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    card: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: accents.blue.border, backgroundColor: accents.blue.soft, gap: spacing.xs },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    title: { flex: 1, ...typography.callout, fontWeight: '700', color: colors.textPrimary },
    body: { ...typography.bodySmall, color: colors.textSecondary },
    corrected: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
    yes: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    yesText: { ...typography.meta, fontWeight: '700', color: colors.onPrimary },
    no: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    noText: { ...typography.meta, fontWeight: '700', color: colors.textSecondary },
    pressed: { opacity: 0.75 },
  });
}
