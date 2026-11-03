// Which parts of your life this app keeps.
//
// The register has always known how to switch a module off — `setModuleEnabled` was written
// with it — and there was no screen that called it. So a module shipped with
// `defaultEnabled: false`, which the health module is, could never be reached at all: it
// existed, it worked, and no path in the app led to it.
//
// This is also the screen that makes the app feel like one person's rather than everyone's.
// A student has no use for a debt ledger; someone tracking their blood pressure has no use
// for an inbox. Turning a module off hides it from Home, the navigation, search, the
// assistant and the reminder list at once, because every one of those reads the register.
//
// Nothing is ever deleted. A module switched off keeps all its records, and switching it
// back on brings them straight back — which is what makes it safe to experiment.

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../src/ui/AppText';
import { AppIcon } from '../src/ui/AppIcon';
import { ScreenHeader, useKit } from '../src/ui/AppKit';
import { allModules, isModuleEnabled, setModuleEnabled, type AppModule } from '../src/modules/registry';
import { border, icon as iconSize, layout, radius, spacing, typography, type ThemeColors } from '../src/theme';
import { success, tapLight } from '../src/ui/haptics';
import { asciiDigitsToBengali } from '../src/services/debt/money';

export default function ModulesScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn, language } = useKit();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [state, setState] = useState<{ module: AppModule; on: boolean }[]>([]);

  const load = useCallback(async () => {
    const modules = allModules();
    const rows: { module: AppModule; on: boolean }[] = [];
    for (const module of modules) {
      rows.push({ module, on: await isModuleEnabled(db, module).catch(() => module.defaultEnabled) });
    }
    setState(rows);
  }, [db]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const toggle = useCallback(async (module: AppModule, next: boolean) => {
    if (module.essential) return;
    tapLight();
    // Optimistic, because the switch has to move under the thumb; the reload that follows
    // is what makes it true.
    setState((rows) => rows.map((row) => (row.module.id === module.id ? { ...row, on: next } : row)));
    await setModuleEnabled(db, module.id, next).catch(() => {});
    success();
    await load();
  }, [db, load]);

  const onCount = state.filter((row) => row.on).length;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        title={bn ? 'আপনার অংশগুলো' : 'Your parts'}
        subtitle={bn
          ? 'যেগুলো আপনার কাজে লাগে সেগুলোই রাখুন — বাকিগুলো লুকিয়ে থাকবে'
          : 'Keep the ones you use; the rest stay out of the way'}
        backTo="/more"
        backLabel={bn ? 'আরও' : 'More'}
      />

      <Text style={s.intro}>
        {bn
          ? 'বন্ধ করলে কিছুই মুছে যায় না। হোম, নিচের বার, খোঁজা আর রিমাইন্ডার থেকে শুধু সরে যায়; আবার চালু করলে সব হিসাব যেমন ছিল তেমনই ফিরে আসে।'
          : 'Switching one off deletes nothing. It leaves Home, the navigation, search and reminders; switch it back on and every record is exactly where it was.'}
      </Text>

      {state.map(({ module, on }) => {
        const tone = accents[module.tone];
        return (
          <Pressable
            key={module.id}
            accessibilityRole="switch"
            accessibilityState={{ checked: on, disabled: !!module.essential }}
            accessibilityLabel={module.title(language)}
            disabled={!!module.essential}
            onPress={() => void toggle(module, !on)}
            style={({ pressed }) => StyleSheet.flatten([s.row, !on && s.rowOff, pressed && s.pressed])}
          >
            <View style={[s.icon, { backgroundColor: on ? tone.soft : colors.surfaceMuted }]}>
              <AppIcon name={module.icon} size={iconSize.md} color={on ? tone.on : colors.textMuted} />
            </View>
            <View style={s.grow}>
              <Text numberOfLines={1} style={s.name}>{module.title(language)}</Text>
              <Text numberOfLines={2} style={s.description}>
                {module.description?.(language) ?? (bn ? 'এই অংশটি' : 'This part of the app')}
              </Text>
            </View>
            <Switch
              value={on}
              disabled={!!module.essential}
              onValueChange={(next) => void toggle(module, next)}
              trackColor={{ false: colors.border, true: tone.soft }}
              thumbColor={on ? tone.on : colors.textMuted}
            />
          </Pressable>
        );
      })}

      <Text style={s.footnote}>
        {bn
          ? `এখন ${onCount === state.length ? 'সবগুলোই' : `${asciiDigitsToBengali(String(onCount))}টি`} চালু আছে। পরে নতুন অংশ যোগ হলে সেগুলোও এখানেই দেখাবে।`
          : `${onCount} of ${state.length} are on. Anything added later appears here too.`}
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={() => { tapLight(); router.push('/permissions' as never); }}
        style={({ pressed }) => StyleSheet.flatten([s.link, pressed && s.pressed])}
      >
        <AppIcon name="shield-check-outline" size={iconSize.sm} color={colors.primary} />
        <Text numberOfLines={1} style={s.linkText}>
          {bn ? 'কোন অংশের জন্য কী অনুমতি লাগে' : 'What each part asks permission for'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    grow: { flex: 1, minWidth: 0 },
    intro: { color: colors.textSecondary, ...typography.bodySmall, lineHeight: 20, marginBottom: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget + 20, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.sm },
    rowOff: { opacity: 0.62 },
    icon: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    name: { color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    description: { color: colors.textMuted, ...typography.caption, marginTop: 2, lineHeight: 17 },
    footnote: { color: colors.textMuted, ...typography.caption, marginTop: spacing.sm, lineHeight: 17 },
    link: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: layout.minTouchTarget, marginTop: spacing.md },
    linkText: { color: colors.primary, ...typography.body, fontWeight: '800' },
    pressed: { opacity: 0.78 },
  });
}
