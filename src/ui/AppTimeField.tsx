// A time field that reads the clock the user asked for, and that cannot hold a time that
// does not exist.
//
// Times were two different things in this app and neither was right. Medicine slots printed
// their stored `HH:MM` straight onto the chip, so a phone set to 12-hour still read
// "সকাল · ০৮:০০"; the health screens asked people to *type* a time into a plain text box
// with "09:00" as the hint, which accepts "25:99" as happily as anything else. And the one
// real picker in the app was the native `@expo/ui` dialog behind the task editor, wired
// `is24Hour={false}` — the setting could never reach it.
//
// So this is the counterpart to AppDateField: same modal, same offline hand-built approach,
// no native dependency. Hours and minutes are tapped from two columns, which is both what
// makes every minute reachable and what makes an impossible time unrepresentable.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { AppText as Text } from './AppText';
import { AppIcon } from './AppIcon';
import { tapLight, tapSelect } from './haptics';
import { useAppPreferences } from '../app/AppPreferences';
import { asciiDigitsToBengali } from '../services/debt/money';
import { formatClock, isValidClock, toClock, partOfDay } from '../i18n/clock';
import { border, control, elevation, icon, layout, radius, spacing, typography, type ThemeColors } from '../theme';

const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
// A tapped row should land under the finger, not at the top of a 60-row list, so the
// columns are scrolled to the current value when the sheet opens. One row height drives
// both the layout and that offset; keeping it a constant is what keeps them agreeing.
const ROW_HEIGHT = 44;

export interface AppTimeFieldProps {
  value: string | null;
  onChange: (next: string | null) => void;
  label?: string;
  /** Text shown when there is no time yet. */
  placeholder?: string;
  /** Lets the user clear the time back to "none". */
  clearable?: boolean;
  accessibilityLabel?: string;
  disabled?: boolean;
}

export function AppTimeField({
  value, onChange, label, placeholder, clearable = false, accessibilityLabel, disabled,
}: AppTimeFieldProps) {
  const { colors, language, reduceMotion, timeFormat } = useAppPreferences();
  const bn = language === 'bn';
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  const parsed = isValidClock(value) ? (value!.split(':').map(Number) as [number, number]) : null;
  const [hour, setHour] = useState(parsed ? parsed[0] : 8);
  const [minute, setMinute] = useState(parsed ? parsed[1] : 0);

  const hourList = useRef<ScrollView>(null);
  const minuteList = useRef<ScrollView>(null);

  const num = (n: number | string) => (bn ? asciiDigitsToBengali(String(n)) : String(n));

  const openPicker = () => {
    if (disabled) return;
    tapLight();
    const current = isValidClock(value) ? (value!.split(':').map(Number) as [number, number]) : null;
    setHour(current ? current[0] : 8);
    setMinute(current ? current[1] : 0);
    setOpen(true);
  };

  // Scrolling has to wait for the columns to exist; the modal mounts them a frame after
  // `open` flips, so this runs off that state rather than off the press handler.
  useEffect(() => {
    if (!open) return;
    const rows = timeFormat === '24' ? HOURS_24 : HOURS_12;
    const hourIndex = rows.indexOf(timeFormat === '24' ? hour : (hour % 12 || 12));
    const frame = requestAnimationFrame(() => {
      hourList.current?.scrollTo({ y: Math.max(0, (hourIndex - 1) * ROW_HEIGHT), animated: false });
      minuteList.current?.scrollTo({ y: Math.max(0, (minute - 1) * ROW_HEIGHT), animated: false });
    });
    return () => cancelAnimationFrame(frame);
    // Only on open: re-running as the user taps would yank the list out from under them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isPm = hour >= 12;
  const setPeriod = (pm: boolean) => {
    tapSelect();
    setHour((h) => (pm ? (h % 12) + 12 : h % 12));
  };
  const pickHour = (h: number) => {
    tapSelect();
    // In 12-hour mode the column shows 1–12, so the chosen hour has to be put back onto
    // whichever half of the day the AM/PM toggle is currently sitting on.
    setHour(timeFormat === '24' ? h : (h % 12) + (isPm ? 12 : 0));
  };

  const confirm = () => { tapSelect(); onChange(toClock(hour, minute)); setOpen(false); };

  const shown = toClock(hour, minute);

  return (
    <View>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label ?? (bn ? 'সময়' : 'Time')}
        accessibilityValue={{ text: isValidClock(value) ? formatClock(value, bn, timeFormat) : (bn ? 'নির্ধারিত নয়' : 'not set') }}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={openPicker}
        style={({ pressed }) => StyleSheet.flatten([s.field, disabled && s.disabled, pressed && s.pressed])}
      >
        <AppIcon name="clock-outline" size={icon.md} color={isValidClock(value) ? colors.primary : colors.textMuted} />
        <Text style={[s.fieldText, !isValidClock(value) && s.fieldPlaceholder]}>
          {isValidClock(value) ? formatClock(value, bn, timeFormat) : (placeholder ?? (bn ? 'সময় বেছে নিন' : 'Pick a time'))}
        </Text>
        {clearable && isValidClock(value) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'সময় মুছুন' : 'Clear time'}
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
              <Text accessibilityRole="header" style={s.preview}>{formatClock(shown, bn, timeFormat)}</Text>
              <Text style={s.previewPart}>{partOfDay(shown, bn)}</Text>

              <View style={s.columns}>
                <View style={s.column}>
                  <Text style={s.columnHead}>{bn ? 'ঘণ্টা' : 'Hour'}</Text>
                  <ScrollView ref={hourList} style={s.columnScroll} showsVerticalScrollIndicator={false}>
                    {(timeFormat === '24' ? HOURS_24 : HOURS_12).map((h) => {
                      const selected = timeFormat === '24' ? h === hour : h === (hour % 12 || 12);
                      return (
                        <Pressable
                          key={h}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() => pickHour(h)}
                          style={({ pressed }) => StyleSheet.flatten([s.optionRow, selected && s.optionSelected, pressed && s.pressed])}
                        >
                          <Text style={[s.optionText, selected && s.optionTextSelected]}>
                            {num(timeFormat === '24' ? String(h).padStart(2, '0') : h)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                <View style={s.column}>
                  <Text style={s.columnHead}>{bn ? 'মিনিট' : 'Minute'}</Text>
                  <ScrollView ref={minuteList} style={s.columnScroll} showsVerticalScrollIndicator={false}>
                    {MINUTES.map((m) => {
                      const selected = m === minute;
                      return (
                        <Pressable
                          key={m}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() => { tapSelect(); setMinute(m); }}
                          style={({ pressed }) => StyleSheet.flatten([s.optionRow, selected && s.optionSelected, pressed && s.pressed])}
                        >
                          <Text style={[s.optionText, selected && s.optionTextSelected]}>{num(String(m).padStart(2, '0'))}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>

              {timeFormat === '12' ? (
                <View style={s.periodRow}>
                  {([[bn ? 'দুপুরের আগে (AM)' : 'AM', false], [bn ? 'দুপুরের পরে (PM)' : 'PM', true]] as const).map(([text, pm]) => (
                    <Pressable
                      key={text}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isPm === pm }}
                      onPress={() => setPeriod(pm)}
                      style={({ pressed }) => StyleSheet.flatten([s.period, isPm === pm && s.periodActive, pressed && s.pressed])}
                    >
                      <Text style={[s.periodText, isPm === pm && s.periodTextActive]}>{text}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                onPress={confirm}
                style={({ pressed }) => StyleSheet.flatten([s.confirm, pressed && s.pressed])}
              >
                <Text style={s.confirmText}>{bn ? 'ঠিক আছে' : 'Done'}</Text>
              </Pressable>

              <View style={s.footerRow}>
                {clearable ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => { tapLight(); onChange(null); setOpen(false); }}
                    style={({ pressed }) => StyleSheet.flatten([s.footerBtn, pressed && s.pressed])}
                  >
                    <Text numberOfLines={1} style={s.footerText}>{bn ? 'সময় নেই' : 'No time'}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setOpen(false)}
                  style={({ pressed }) => StyleSheet.flatten([s.footerBtn, pressed && s.pressed])}
                >
                  <Text numberOfLines={1} style={s.footerText}>{bn ? 'বাতিল' : 'Cancel'}</Text>
                </Pressable>
              </View>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
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
    preview: { textAlign: 'center', color: colors.textPrimary, ...typography.title },
    previewPart: { textAlign: 'center', color: colors.textMuted, ...typography.caption, fontWeight: '700', marginBottom: spacing.sm },
    columns: { flexDirection: 'row', gap: spacing.sm },
    column: { flex: 1 },
    columnHead: { textAlign: 'center', color: colors.textMuted, ...typography.caption, fontWeight: '700', marginBottom: spacing.xs },
    columnScroll: { height: ROW_HEIGHT * 5, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
    optionRow: { height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
    optionSelected: { backgroundColor: colors.primary },
    optionText: { color: colors.textPrimary, ...typography.input, fontWeight: '600' },
    optionTextSelected: { color: colors.onPrimary, fontWeight: '800' },
    periodRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    period: {
      flex: 1, minHeight: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center',
      borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surfaceMuted,
    },
    periodActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    periodText: { color: colors.textSecondary, ...typography.callout, fontWeight: '800' },
    periodTextActive: { color: colors.onPrimary },
    confirm: { minHeight: control.buttonHeight, marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    confirmText: { color: colors.onPrimary, ...typography.callout, fontWeight: '800' },
    footerRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    footerBtn: { flex: 1, minHeight: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
    footerText: { flexShrink: 1, color: colors.textSecondary, ...typography.callout, fontWeight: '800' },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.78 },
  });
}
