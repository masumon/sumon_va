import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText as Text } from './AppText';
import { AppIcon, type IconName } from './AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { tapLight } from './haptics';
import { MODULE_GUIDES, type ModuleGuideId } from '../content/module-guides';
import { border, control, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../theme';

const bnDigit = (n: number) => String(n).replace(/\d/gu, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!);

/**
 * "কীভাবে ব্যবহার করবেন?" under a module's title, and the guide it opens.
 *
 * The guide opens by itself the first time the module is visited (one preference row per
 * module), and any time after from the button. It replaces the one-line first-time tip
 * that sat above the tabs: the same moment, with enough in it to actually get started.
 */
/**
 * A small round "?" beside the page title (rc.18 look review: the wide blue "কীভাবে ব্যবহার
 * করবেন?" pill added a whole row to every page). Pages that draw their own header icons pass
 * their icon style and colour so it matches them.
 */
export function ModuleGuide({ id, autoOpen = true, buttonStyle, iconColor }: { id: ModuleGuideId; autoOpen?: boolean; buttonStyle?: StyleProp<ViewStyle>; iconColor?: string }) {
  const db = useSQLiteContext();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const guide = MODULE_GUIDES[id];
  const key = `guide.seen.${id}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Home is explained by onboarding a moment earlier; আপন, reached from another guide's
    // example, must not cover the example it was opened with. Both keep the button.
    if (!autoOpen) return;
    let alive = true;
    void db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', key)
      .then((row) => { if (alive && !row) setOpen(true); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [db, key, autoOpen]);

  const close = () => {
    setOpen(false);
    void db.runAsync('INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)', key, '1').catch(() => undefined);
  };
  const ask = (q: string) => { close(); router.push({ pathname: '/assistant', params: { q } } as never); };
  const say = (line: { bn: string; en: string }) => (bn ? line.bn : line.en);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bn ? 'কীভাবে ব্যবহার করবেন' : 'How to use this'}
        onPress={() => { tapLight(); setOpen(true); }}
        hitSlop={6}
        style={({ pressed }) => StyleSheet.flatten([styles.helpButton, buttonStyle, pressed && styles.pressed])}
      >
        <AppIcon name="help-circle-outline" size={22} color={iconColor ?? colors.primary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
        <View style={styles.root}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel={bn ? 'বন্ধ করুন' : 'Close'} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
            <View style={styles.handle} />
            <View style={styles.head}>
              <View style={styles.headIcon}><AppIcon name={guide.icon as IconName} size={24} color={colors.primary} /></View>
              <Text accessibilityRole="header" style={styles.title}>{say(guide.title)}</Text>
            </View>
            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.what}>{say(guide.what)}</Text>

              <Text style={styles.section}>{bn ? 'কীভাবে করবেন' : 'How'}</Text>
              {guide.steps.map((step, i) => (
                <View key={i} style={styles.step}>
                  <View style={styles.stepNo}><Text style={styles.stepNoText}>{bn ? bnDigit(i + 1) : String(i + 1)}</Text></View>
                  <Text style={styles.stepText}>{say(step)}</Text>
                </View>
              ))}

              <Text style={styles.section}>{bn ? 'আপনকে বলেও করা যায় — চাপ দিয়ে দেখুন' : 'Or just tell আপন — tap to try'}</Text>
              <View style={styles.asks}>
                {guide.ask.map((line, i) => (
                  <Pressable key={i} accessibilityRole="button" onPress={() => ask(say(line))} style={({ pressed }) => StyleSheet.flatten([styles.askChip, pressed && styles.pressed])}>
                    <AppIcon name="message-text-outline" size={16} color={accents.yellow.on} />
                    <Text style={styles.askText}>{say(line)}</Text>
                  </Pressable>
                ))}
              </View>

              {guide.tip ? (
                <View style={styles.tip}>
                  <AppIcon name="lightbulb-on-outline" size={18} color={colors.primary} />
                  <Text style={styles.tipText}>{say(guide.tip)}</Text>
                </View>
              ) : null}
            </ScrollView>
            <Pressable accessibilityRole="button" onPress={close} style={({ pressed }) => StyleSheet.flatten([styles.done, pressed && styles.pressed])}>
              <Text style={styles.doneText}>{bn ? 'বুঝেছি' : 'Got it'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    helpButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: border.thin, borderColor: accents.blue.border, backgroundColor: accents.blue.soft },
    root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { maxHeight: '90%', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopLeftRadius: radius.lg + 8, borderTopRightRadius: radius.lg + 8, backgroundColor: colors.surface },
    handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.md },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    headIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryTint },
    title: { flex: 1, ...typography.cardTitle, color: colors.textPrimary },
    body: { flexGrow: 0, marginTop: spacing.sm },
    bodyContent: { paddingBottom: spacing.sm },
    what: { ...typography.body, color: colors.textSecondary },
    section: { ...typography.label, fontWeight: '700', color: colors.primary, marginTop: spacing.md, marginBottom: spacing.xs },
    step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xxs + 2 },
    stepNo: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
    stepNoText: { ...typography.caption, fontWeight: '700', color: colors.onPrimary },
    stepText: { flex: 1, ...typography.bodySmall, color: colors.textPrimary },
    asks: { gap: spacing.xs },
    askChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.smd, borderRadius: radius.md, borderWidth: border.thin, borderColor: accents.yellow.border, backgroundColor: accents.yellow.soft },
    askText: { flex: 1, ...typography.bodySmall, fontWeight: '600', color: colors.textPrimary },
    tip: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md, padding: spacing.smd, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
    tipText: { flex: 1, ...typography.caption, color: colors.textSecondary },
    done: { minHeight: control.buttonHeight, marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    doneText: { ...typography.callout, fontWeight: '700', color: colors.onPrimary },
    pressed: { opacity: 0.75 },
  });
}
