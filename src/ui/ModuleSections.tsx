// The parts of Settings and Reminders that modules fill in.
//
// Both screens used to know only about the app's own concerns, so a module with settings
// had nowhere to put them and invented its own screen — which is how the debt reminder
// switch ended up buried three taps deep, somewhere nobody looking for reminder settings
// would think to look.
//
// These two sections ask the register instead. A module that declares settings gets them
// rendered in Settings; a module that declares reminders gets them listed in Reminders.
// Neither screen imports a module, and adding the tenth module changes nothing here.

import { useEffect, useRef, useState } from 'react';
import { asciiDigitsToBengali } from '../services/debt/money';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text, AppTextInput as TextInput } from './AppText';
import { AppIcon } from './AppIcon';
import { tapLight, tapSelect } from './haptics';
import { useAppPreferences } from '../app/AppPreferences';
import {
  collectReminders,
  collectSettings,
  enabledModules,
  type AppModule,
  type ModuleReminder,
  type ModuleSetting,
} from '../modules';
import { formatBangladeshDateTime } from '../i18n/date-time';
import { border, control, icon, layout, radius, spacing, typography, type ThemeColors } from '../theme';

/**
 * "⚙ সেটিংস" inside a module. Each module setting has one home — its group in Settings — so
 * this is a door, not a second switch: it opens Settings at that module's group, from the
 * screen where the person is actually thinking about it (Android's guidance: settings are
 * reached from the feature they affect; the control itself stays in one place).
 */
export function ModuleSettingsLink({ moduleId }: { moduleId: string }) {
  const { colors, language } = useAppPreferences();
  const s = makeStyles(colors);
  const label = language === 'bn' ? 'সেটিংস' : 'Settings';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={language === 'bn' ? 'এই অংশের সেটিংস' : 'Settings for this part'}
      hitSlop={4}
      onPress={() => { tapLight(); router.push({ pathname: '/settings', params: { module: moduleId } } as never); }}
      style={({ pressed }) => StyleSheet.flatten([s.linkPill, pressed && { opacity: 0.85 }])}
    >
      <AppIcon name="cog-outline" size={icon.sm} color={colors.primary} />
      <Text numberOfLines={1} style={s.linkPillText}>{label}</Text>
    </Pressable>
  );
}

/** Every enabled module's settings, grouped under the module they belong to. With
 *  `focus`, reports where that module's group sits so Settings can scroll to it. */
export function ModuleSettingsSection({ focus, onFocusY }: { focus?: string; onFocusY?: (y: number) => void } = {}) {
  const reported = useRef(false);
  const db = useSQLiteContext();
  const { colors, language } = useAppPreferences();
  const s = makeStyles(colors);

  const [groups, setGroups] = useState<{ module: AppModule; settings: ModuleSetting[] }[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const found = collectSettings(language, await enabledModules(db));
        const next: Record<string, string> = {};
        for (const group of found) {
          for (const setting of group.settings) {
            next[`${group.module.id}.${setting.key}`] = (await setting.read(db).catch(() => null)) ?? '';
          }
        }
        if (!alive) return;
        setGroups(found);
        setValues(next);
      } catch {
        if (alive) setGroups([]);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => { alive = false; };
  }, [db, language]);

  const write = async (module: AppModule, setting: ModuleSetting, value: string) => {
    const key = `${module.id}.${setting.key}`;
    setValues((v) => ({ ...v, [key]: value }));
    try { await setting.write(db, value); } catch { /* the field keeps what was typed */ }
  };

  if (!ready || groups.length === 0) return null;

  return (
    <>
      {groups.map(({ module, settings }) => (
        <View
          key={module.id}
          onLayout={focus === module.id && onFocusY ? (e) => { if (!reported.current) { reported.current = true; onFocusY(e.nativeEvent.layout.y); } } : undefined}
        >
          <Text style={s.section}>{module.title(language)}</Text>
          {settings.map((setting) => {
            const key = `${module.id}.${setting.key}`;
            const value = values[key] ?? '';
            return (
              <View key={key} style={s.row}>
                <View style={s.rowBody}>
                  <Text style={s.rowLabel}>{setting.label(language)}</Text>
                  {setting.hint ? <Text style={s.rowHint}>{setting.hint(language)}</Text> : null}

                  {setting.kind === 'CHOICE' ? (
                    <View style={s.chipRow}>
                      {(setting.options?.(language) ?? []).map((o) => (
                        <Pressable
                          key={o.value}
                          accessibilityRole="button"
                          accessibilityState={{ selected: value === o.value }}
                          accessibilityLabel={o.label}
                          onPress={() => { tapSelect(); void write(module, setting, o.value); }}
                          style={({ pressed }) => StyleSheet.flatten([s.chipHit, pressed && s.pressed])}
                        >
                          <View style={[s.chip, value === o.value && s.chipOn]}>
                            <Text numberOfLines={1} style={[s.chipText, value === o.value && s.chipTextOn]}>{o.label}</Text>
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}

                  {setting.kind === 'AMOUNT' ? (
                    <TextInput
                      value={value}
                      onChangeText={(v) => void write(module, setting, v)}
                      keyboardType="numeric"
                      placeholder={language === 'bn' ? '০' : '0'}
                      placeholderTextColor={colors.textMuted}
                      accessibilityLabel={setting.label(language)}
                      style={s.input}
                    />
                  ) : null}
                </View>

                {setting.kind === 'TOGGLE' ? (
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: value === '1' }}
                    accessibilityLabel={setting.label(language)}
                    onPress={() => { tapSelect(); void write(module, setting, value === '1' ? '0' : '1'); }}
                    style={({ pressed }) => StyleSheet.flatten([s.track, value === '1' && { backgroundColor: colors.primary }, pressed && s.pressed])}
                  >
                    <View style={[s.knob, value === '1' && s.knobOn]} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </>
  );
}

/** Reminders every enabled module has scheduled, soonest first. */
export function ModuleRemindersSection() {
  const db = useSQLiteContext();
  const { colors, language } = useAppPreferences();
  const bn = language === 'bn';
  const s = makeStyles(colors);

  const [rows, setRows] = useState<{ module: AppModule; reminder: ModuleReminder }[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void collectReminders(db, language)
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [db, language]);

  if (!ready) return <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />;
  if (rows.length === 0) return null;

  return (
    <View>
      <View style={s.sectionHeader}>
        <Text style={s.section}>{bn ? 'মডিউল থেকে' : 'From your modules'}</Text>
        <View style={s.count}><Text style={s.countText}>{language === 'bn' ? asciiDigitsToBengali(String(rows.length)) : rows.length}</Text></View>
      </View>
      {rows.map(({ module, reminder }) => (
        <Pressable
          key={`${module.id}:${reminder.id}`}
          accessibilityRole="button"
          accessibilityLabel={reminder.title}
          disabled={!reminder.route}
          onPress={() => { if (reminder.route) { tapLight(); router.push(reminder.route as never); } }}
          style={({ pressed }) => StyleSheet.flatten([s.row, pressed && reminder.route && s.pressed])}
        >
          <View style={s.rowIcon}><AppIcon name={module.icon} size={icon.md} color={colors.primary} /></View>
          <View style={s.rowBody}>
            <Text numberOfLines={1} style={s.rowLabel}>{reminder.title}</Text>
            <Text numberOfLines={1} style={s.rowHint}>
              {formatBangladeshDateTime(reminder.at, language)}
              {reminder.body ? ` · ${reminder.body}` : ''}
            </Text>
          </View>
          {reminder.route ? <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    linkPill: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.smd, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    linkPillText: { color: colors.primary, ...typography.meta, fontWeight: '700' },
    section: { color: colors.textMuted, ...typography.section, fontWeight: '700', letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    count: { minWidth: 24, paddingHorizontal: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, alignItems: 'center', marginTop: spacing.sm },
    countText: { color: colors.textSecondary, ...typography.caption, fontWeight: '800', fontFamily: typography.numeric.fontFamily },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: control.rowMinHeight,
      borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg,
      backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.sm,
    },
    rowIcon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
    rowBody: { flex: 1, minWidth: 0 },
    rowLabel: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    rowHint: { color: colors.textSecondary, ...typography.caption, marginTop: 2 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
    chipHit: { minHeight: layout.minTouchTarget, justifyContent: 'center' },
    chip: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { flexShrink: 1, color: colors.textSecondary, ...typography.caption, fontWeight: '700' },
    chipTextOn: { color: colors.onPrimary },
    input: { minHeight: control.inputHeight, marginTop: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, color: colors.textPrimary, paddingHorizontal: spacing.md, ...typography.input },
    track: { width: 48, height: 28, borderRadius: radius.pill, padding: 3, justifyContent: 'center', backgroundColor: colors.borderStrong },
    knob: { width: 22, height: 22, borderRadius: radius.pill, backgroundColor: colors.surface },
    knobOn: { alignSelf: 'flex-end' },
    pressed: { opacity: 0.78 },
  });
}
