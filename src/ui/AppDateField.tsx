// A date field that cannot hold a date that does not exist.
//
// Every date in the app used to be a free-text box expecting "YYYY-MM-DD": "2026-13-45"
// was accepted and stored, and a typo silently switched interest and overdue maths off,
// because an unparseable date makes every elapsed-period calculation return zero.
//
// So the field is not typed into at all — it is tapped, and a month grid opens. There is
// no dependency behind this: the app is offline-first, and a picker is a calendar plus
// arithmetic. Bengali numerals and month names come from the user's language setting, so
// the picker reads the same way as the rest of the screen.

import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { AppText as Text } from './AppText';
import { AppIcon } from './AppIcon';
import { tapLight, tapSelect } from './haptics';
import { useAppPreferences } from '../app/AppPreferences';
import { asciiDigitsToBengali } from '../services/debt/money';
import { border, control, elevation, icon, layout, radius, spacing, typography, type ThemeColors } from '../theme';

const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const BN_DOW = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];
const EN_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `YYYY-MM-DD` for a Date, on the device's own calendar rather than in UTC. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** True only for a real calendar day — "2026-02-30" and "2026-13-01" are both rejected. */
export function isValidDayKey(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
}

function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number) as [number, number];
  const target = (m - 1) + delta;
  const year = y + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export interface AppDateFieldProps {
  value: string | null;
  onChange: (next: string | null) => void;
  label?: string;
  /** Text shown when there is no date yet. */
  placeholder?: string;
  /** Lets the user clear the date back to "none". */
  clearable?: boolean;
  accessibilityLabel?: string;
  /** Quick jumps offered under the grid, e.g. "in a month". Defaults to today + 1 month. */
  presets?: { label: string; date: string }[];
  disabled?: boolean;
}

export function AppDateField({
  value, onChange, label, placeholder, clearable = false, accessibilityLabel, presets, disabled,
}: AppDateFieldProps) {
  const { colors, language, reduceMotion } = useAppPreferences();
  const bn = language === 'bn';
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  const today = dayKey(new Date());
  const [month, setMonth] = useState(() => (isValidDayKey(value) ? value!.slice(0, 7) : today.slice(0, 7)));

  const num = (n: number | string) => (bn ? asciiDigitsToBengali(String(n)) : String(n));

  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    // Built in UTC on purpose: only the weekday index and the day count are wanted, and
    // local-time construction can slip a day either side of a DST boundary.
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [
      ...Array<null>(firstDow).fill(null),
      ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
    ];
  }, [month]);

  const defaultPresets = useMemo(() => {
    const d = new Date();
    const inAMonth = new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate()));
    return [
      { label: bn ? 'আজ' : 'Today', date: today },
      { label: bn ? 'এক মাস পরে' : 'In a month', date: dayKey(inAMonth) },
    ];
  }, [bn, today]);

  const shown = presets ?? defaultPresets;
  const monthLabel = `${(bn ? BN_MONTHS : EN_MONTHS)[Number(month.slice(5, 7)) - 1]} ${num(month.slice(0, 4))}`;

  const openPicker = () => {
    if (disabled) return;
    tapLight();
    setMonth(isValidDayKey(value) ? value!.slice(0, 7) : today.slice(0, 7));
    setOpen(true);
  };

  const pick = (day: string) => {
    tapSelect();
    onChange(day);
    setOpen(false);
  };

  return (
    <View>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label ?? (bn ? 'তারিখ' : 'Date')}
        accessibilityValue={{ text: value ?? (bn ? 'নির্ধারিত নয়' : 'not set') }}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={openPicker}
        style={({ pressed }) => StyleSheet.flatten([s.field, disabled && s.disabled, pressed && s.pressed])}
      >
        <AppIcon name="calendar-month-outline" size={icon.md} color={value ? colors.primary : colors.textMuted} />
        <Text style={[s.fieldText, !value && s.fieldPlaceholder]}>
          {value ? formatLongDate(value, bn) : (placeholder ?? (bn ? 'তারিখ বেছে নিন' : 'Pick a date'))}
        </Text>
        {clearable && value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'তারিখ মুছুন' : 'Clear date'}
            hitSlop={12}
            onPress={() => { tapLight(); onChange(null); }}
            style={s.clear}
          >
            <AppIcon name="close-circle-outline" size={icon.md} color={colors.textMuted} />
          </Pressable>
        ) : (
          <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <View style={[s.backdrop, { backgroundColor: colors.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={bn ? 'বন্ধ' : 'Close'} onPress={() => setOpen(false)} />
          <Animated.View entering={reduceMotion ? undefined : ZoomIn.duration(160)} style={s.sheetWrap}>
            <View style={s.sheet}>
              <View style={s.navRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={bn ? 'আগের মাস' : 'Previous month'}
                  onPress={() => { tapLight(); setMonth(shiftMonth(month, -1)); }}
                  style={({ pressed }) => StyleSheet.flatten([s.navBtn, pressed && s.pressed])}
                >
                  <AppIcon name="chevron-left" size={icon.md} color={colors.primary} />
                </Pressable>
                <Text accessibilityRole="header" style={s.monthLabel}>{monthLabel}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={bn ? 'পরের মাস' : 'Next month'}
                  onPress={() => { tapLight(); setMonth(shiftMonth(month, 1)); }}
                  style={({ pressed }) => StyleSheet.flatten([s.navBtn, pressed && s.pressed])}
                >
                  <AppIcon name="chevron-right" size={icon.md} color={colors.primary} />
                </Pressable>
              </View>

              <View style={s.yearRow}>
                <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'আগের বছর' : 'Previous year'} onPress={() => { tapLight(); setMonth(shiftMonth(month, -12)); }} style={({ pressed }) => StyleSheet.flatten([s.yearBtn, pressed && s.pressed])}>
                  <Text numberOfLines={1} style={s.yearText}>{bn ? '− ১ বছর' : '−1 yr'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'পরের বছর' : 'Next year'} onPress={() => { tapLight(); setMonth(shiftMonth(month, 12)); }} style={({ pressed }) => StyleSheet.flatten([s.yearBtn, pressed && s.pressed])}>
                  <Text numberOfLines={1} style={s.yearText}>{bn ? '+ ১ বছর' : '+1 yr'}</Text>
                </Pressable>
              </View>

              <ScrollView style={s.gridScroll} contentContainerStyle={s.grid} showsVerticalScrollIndicator={false}>
                {(bn ? BN_DOW : EN_DOW).map((d, i) => (
                  <View key={`dow-${i}`} style={s.cell}><Text style={s.dow}>{d}</Text></View>
                ))}
                {cells.map((day, i) => {
                  if (!day) return <View key={`pad-${i}`} style={s.cell} />;
                  const selected = day === value;
                  const isToday = day === today;
                  return (
                    <Pressable
                      key={day}
                      accessibilityRole="button"
                      accessibilityLabel={formatLongDate(day, bn)}
                      accessibilityState={{ selected }}
                      onPress={() => pick(day)}
                      style={({ pressed }) => StyleSheet.flatten([s.cell, pressed && s.pressed])}
                    >
                      <View style={[s.dayBox, isToday && s.dayToday, selected && s.daySelected]}>
                        <Text style={[s.dayNum, selected && s.dayNumSelected]}>{num(Number(day.slice(8)))}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={s.presetRow}>
                {shown.map((p) => (
                  <Pressable
                    key={p.label}
                    accessibilityRole="button"
                    onPress={() => pick(p.date)}
                    style={({ pressed }) => StyleSheet.flatten([s.preset, pressed && s.pressed])}
                  >
                    <Text numberOfLines={1} style={s.presetText}>{p.label}</Text>
                  </Pressable>
                ))}
                {clearable ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => { tapLight(); onChange(null); setOpen(false); }}
                    style={({ pressed }) => StyleSheet.flatten([s.preset, pressed && s.pressed])}
                  >
                    <Text numberOfLines={1} style={s.presetText}>{bn ? 'তারিখ নেই' : 'No date'}</Text>
                  </Pressable>
                ) : null}
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() => setOpen(false)}
                style={({ pressed }) => StyleSheet.flatten([s.close, pressed && s.pressed])}
              >
                <Text style={s.closeText}>{bn ? 'বন্ধ' : 'Close'}</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

/** "১৫ সেপ্টেম্বর ২০২৬" / "15 September 2026" — a date a person reads, not a key. */
export function formatLongDate(dayKeyValue: string, bn: boolean): string {
  if (!isValidDayKey(dayKeyValue)) return dayKeyValue;
  const [y, m, d] = dayKeyValue.split('-') as [string, string, string];
  const monthName = (bn ? BN_MONTHS : EN_MONTHS)[Number(m) - 1];
  const day = String(Number(d));
  return bn
    ? `${asciiDigitsToBengali(day)} ${monthName} ${asciiDigitsToBengali(y)}`
    : `${day} ${monthName} ${y}`;
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    label: { color: colors.textSecondary, ...typography.label, fontWeight: '800', marginTop: spacing.md, marginBottom: spacing.xs },
    field: {
      minHeight: control.inputHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md,
      backgroundColor: colors.surface, paddingHorizontal: spacing.md,
    },
    fieldText: { flex: 1, color: colors.textPrimary, ...typography.input },
    fieldPlaceholder: { color: colors.textMuted },
    clear: { width: layout.minTouchTarget, height: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center' },
    backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    sheetWrap: { width: '100%', maxWidth: layout.dialogMaxWidth },
    sheet: {
      borderRadius: radius.xl, borderWidth: border.thin, borderColor: colors.border,
      backgroundColor: colors.surface, padding: spacing.md, ...elevation.raised,
    },
    navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm},
    navBtn: { width: layout.minTouchTarget, height: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
    monthLabel: { flex: 1, textAlign: 'center', color: colors.textPrimary, ...typography.cardTitle },
    yearRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.xs },
    yearBtn: { minHeight: layout.minTouchTarget, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
    yearText: { flexShrink: 1, color: colors.textSecondary, ...typography.caption, fontWeight: '700' },
    gridScroll: { maxHeight: 320 },
    grid: { paddingBottom: spacing.sm, flexDirection: 'row', flexWrap: 'wrap' },
    cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
    dow: { color: colors.textMuted, ...typography.caption, fontWeight: '700' },
    dayBox: {
      width: 42, height: layout.minTouchTarget, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
      borderWidth: border.thin, borderColor: 'transparent',
    },
    dayToday: { borderColor: colors.primary, borderWidth: border.medium },
    daySelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    dayNum: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '600' },
    dayNumSelected: { color: colors.onPrimary, fontWeight: '800' },
    presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
    preset: { minHeight: layout.minTouchTarget, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
    presetText: { flexShrink: 1, color: colors.textSecondary, ...typography.caption, fontWeight: '700' },
    close: { minHeight: control.buttonHeight, marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
    closeText: { flexShrink: 1, color: colors.textSecondary, ...typography.callout, fontWeight: '800' },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.78 },
  });
}
