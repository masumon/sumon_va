// Which clock this app keeps.
//
// The list comes from the phone, not from a table typed out here: modern JavaScript
// runtimes can name every zone they know, so a hand-written list would be both a
// duplicate and out of date the next time a country moves its clocks. Where the runtime
// will not answer, a short list of the places people using this app actually live stands
// in — better a working picker with fewer choices than an empty screen.

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text, AppTextInput as TextInput } from '../src/ui/AppText';
import { AppIcon } from '../src/ui/AppIcon';
import { ScreenHeader, useKit } from '../src/ui/AppKit';
import { useAppPreferences } from '../src/app/AppPreferences';
import { useAppFeedback } from '../src/ui/AppFeedback';
import {
  BANGLADESH_TIME_ZONE, timeZoneCity, timeZoneOffsetLabel, isValidTimeZone,
} from '../src/i18n/date-time';
import { border, icon as iconSize, radius, spacing, typography, type ThemeColors } from '../src/theme';
import { success, tapLight } from '../src/ui/haptics';

/** Where people using this app actually are, when the runtime cannot list the world. */
const FALLBACK_ZONES = [
  'Asia/Dhaka', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Kathmandu', 'Asia/Yangon',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Jakarta', 'Asia/Manila',
  'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Bahrain', 'Asia/Muscat',
  'Asia/Amman', 'Asia/Beirut', 'Asia/Jerusalem', 'Asia/Baghdad', 'Asia/Tehran', 'Asia/Kabul',
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris',
  'Europe/Berlin', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Zurich',
  'Europe/Stockholm', 'Europe/Oslo', 'Europe/Helsinki', 'Europe/Warsaw', 'Europe/Athens',
  'Europe/Istanbul', 'Europe/Moscow',
  'Africa/Cairo', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Casablanca',
  'America/New_York', 'America/Toronto', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo',
  'America/Bogota', 'America/Lima', 'America/Argentina/Buenos_Aires',
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Sydney', 'Australia/Brisbane',
  'Pacific/Auckland', 'Pacific/Fiji', 'UTC',
];

function allZones(): string[] {
  try {
    // Available on modern runtimes; typed loosely because the lib target may not know it.
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const list = supported?.('timeZone');
    if (list?.length) return list;
  } catch { /* fall through */ }
  return FALLBACK_ZONES;
}

/** Minutes ahead of UTC, so the list reads west-to-east like a map rather than A-to-Z. */
function offsetMinutes(zone: string): number {
  try {
    const label = timeZoneOffsetLabel(zone);
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/u.exec(label);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0));
  } catch { return 0; }
}

export default function TimeZoneScreen() {
  const { colors, accents, bn } = useKit();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { timeZone, setTimeZone } = useAppPreferences();
  const { showSnackbar } = useAppFeedback();
  const [query, setQuery] = useState('');

  const zones = useMemo(() => {
    const list = allZones().filter(isValidTimeZone);
    const decorated = list.map((zone) => ({ zone, offset: offsetMinutes(zone) }));
    decorated.sort((a, b) => (a.offset - b.offset) || a.zone.localeCompare(b.zone));
    return decorated;
  }, []);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return zones;
    return zones.filter(({ zone }) => zone.toLowerCase().includes(term) || timeZoneOffsetLabel(zone).toLowerCase().includes(term));
  }, [zones, query]);

  const pick = useCallback(async (zone: string) => {
    tapLight();
    await setTimeZone(zone);
    success();
    showSnackbar(
      bn ? `সময় অঞ্চল এখন ${timeZoneCity(zone)}` : `Time zone is now ${timeZoneCity(zone)}`,
      'success',
    );
    router.back();
  }, [setTimeZone, showSnackbar, bn]);

  const takePhoneZone = useCallback(async () => {
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await pick(isValidTimeZone(guess) ? guess : BANGLADESH_TIME_ZONE);
  }, [pick]);

  return (
    <View style={s.root}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title={bn ? 'সময় অঞ্চল' : 'Time zone'}
          subtitle={bn ? 'অ্যাপের সব তারিখ ও হিসাব এই সময় ধরে হবে' : 'Every date and total in the app is read in this zone'}
          backTo="/settings"
          backLabel={bn ? 'সেটিংস' : 'Settings'}
        />

        <View style={s.current}>
          <AppIcon name="earth" size={iconSize.md} color={accents.blue.on} />
          <View style={s.currentCopy}>
            <Text numberOfLines={1} style={s.currentTitle}>{timeZoneCity(timeZone)}</Text>
            <Text numberOfLines={1} style={s.currentMeta}>{timeZone} · {timeZoneOffsetLabel(timeZone)}</Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bn ? 'ফোনের সময় অঞ্চল ব্যবহার করুন' : 'Use the phone’s time zone'}
          onPress={() => void takePhoneZone()}
          style={({ pressed }) => StyleSheet.flatten([s.phoneBtn, pressed && s.pressed])}
        >
          <AppIcon name="cellphone-cog" size={iconSize.sm} color={colors.primary} />
          <Text numberOfLines={1} style={s.phoneText}>
            {bn ? 'ফোনের সময় অঞ্চল নিন' : 'Use the phone’s zone'}
          </Text>
        </Pressable>

        <View style={s.searchBox}>
          <AppIcon name="magnify" size={iconSize.sm} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={bn ? 'শহর বা GMT লিখে খুঁজুন' : 'Search a city or GMT offset'}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={bn ? 'সময় অঞ্চল খুঁজুন' : 'Search time zones'}
            style={s.searchInput}
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'মুছুন' : 'Clear'} onPress={() => setQuery('')}>
              <AppIcon name="close-circle" size={iconSize.sm} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {shown.map(({ zone }) => {
          const active = zone === timeZone;
          return (
            <Pressable
              key={zone}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${timeZoneCity(zone)} ${timeZoneOffsetLabel(zone)}`}
              onPress={() => void pick(zone)}
              style={({ pressed }) => StyleSheet.flatten([s.row, active && s.rowActive, pressed && s.pressed])}
            >
              <View style={s.rowCopy}>
                <Text numberOfLines={1} style={[s.rowTitle, active && { color: colors.primary }]}>{timeZoneCity(zone)}</Text>
                <Text numberOfLines={1} style={s.rowMeta}>{zone}</Text>
              </View>
              <Text numberOfLines={1} style={s.rowOffset}>{timeZoneOffsetLabel(zone)}</Text>
              {active ? <AppIcon name="check-circle" size={iconSize.sm} color={colors.primary} /> : null}
            </Pressable>
          );
        })}

        {!shown.length ? (
          <Text style={s.empty}>{bn ? 'এই নামে কোনো সময় অঞ্চল নেই।' : 'No time zone matches that.'}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs },
    current: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
      borderWidth: border.thin, borderColor: colors.border, marginBottom: spacing.sm,
    },
    currentCopy: { flex: 1, minWidth: 0 },
    currentTitle: { color: colors.textPrimary, ...typography.cardTitle, fontWeight: '800' },
    currentMeta: { color: colors.textSecondary, ...typography.caption, marginTop: 2 },
    phoneBtn: {
      minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: spacing.xs, borderRadius: radius.md, borderWidth: border.thin,
      borderColor: colors.border, backgroundColor: colors.surfaceMuted, marginBottom: spacing.sm,
    },
    phoneText: { color: colors.primary, ...typography.meta, fontWeight: '800' },
    searchBox: {
      minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.md, borderRadius: radius.md,
      borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface,
      marginBottom: spacing.sm,
    },
    searchInput: { flex: 1, color: colors.textPrimary, ...typography.input, paddingVertical: spacing.sm },
    row: {
      minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md,
      borderWidth: border.thin, borderColor: colors.border,
    },
    rowActive: { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.textPrimary, ...typography.meta, fontWeight: '700' },
    rowMeta: { color: colors.textMuted, ...typography.caption, marginTop: 1 },
    rowOffset: { color: colors.textSecondary, ...typography.caption, fontWeight: '800' },
    empty: { color: colors.textMuted, ...typography.meta, marginTop: spacing.lg, textAlign: 'center' },
    pressed: { opacity: 0.7 },
  });
}
