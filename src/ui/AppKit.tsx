// The app's shared building blocks.
//
// Every module — tasks, memory, debt, and whatever comes next: health, income, study —
// builds its screens from these. That is the whole point: a new module should never have
// to decide what a card looks like, how a form ends, or how a chip behaves. Those
// decisions are made once, here, so the tenth module looks like it was written on the
// same day as the first.
//
// Nothing in this file knows about any module. No debt words, no task words, no routes.
// Anything a component needs to say comes in as a prop or from `common()`. If you find
// yourself wanting to import a module's copy here, the component belongs in that module.
//
// These grew out of the debt module's own kit, which is why the debt screens were the
// first to look finished. Moving them here is what makes that finish available to
// everything else.

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text, AppTextInput as TextInput } from './AppText';
import { AppIcon, type IconName } from './AppIcon';
import { tapLight, tapSelect } from './haptics';
import { useAppPreferences } from '../app/AppPreferences';
import { common } from '../i18n/common';
import { border, control, elevation, icon, layout, radius, spacing, typography, type AccentRole, type ThemeAccents, type ThemeColors } from '../theme';

/**
 * Theme, shared styles and shared copy — memoised once per screen.
 *
 * `t` is the app-wide vocabulary (save, cancel, close, today…). A module that needs its
 * own words wraps this hook and adds them, rather than pushing them down into here.
 */
export function useKit() {
  const { colors, accents, language, timeFormat } = useAppPreferences();
  const bn = language === 'bn';
  const s = useMemo(() => makeKitStyles(colors), [colors]);
  const t = useMemo(() => common(language), [language]);
  return { colors, accents, language, bn, s, t, timeFormat };
}

export type KitStyles = ReturnType<typeof makeKitStyles>;

/**
 * The top of a screen: a back link, a title, an optional subtitle and an optional action.
 *
 * `backLabel` and `backTo` are props rather than constants because "back" means a
 * different place in every module — and a module added next year must be able to say so
 * without editing this file.
 */
export function ScreenHeader({
  title, subtitle, right, backLabel, backTo, onBack,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  backLabel?: string;
  backTo?: string;
  /**
   * Replaces the navigation entirely. An editor passes its unsaved-changes gate here
   * (`() => guard.attemptLeave(() => router.dismissTo(...))`) — without it the arrow was
   * the one exit that skipped the "discard changes?" question hardware back and Cancel ask.
   */
  onBack?: () => void;
}) {
  const { s, t, colors } = useKit();
  return (
    <View style={s.headerWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={backLabel ?? t.back}
        // A label that names a place is a promise about where this lands. It used to call
        // the generic `router.back()` whenever there was any history at all, so arriving at
        // a screen from search, a deep link, a notification or the widget made the arrow
        // say "স্বাস্থ্য" and then go somewhere else entirely. `dismissTo` pops to that
        // route when it is already behind us and navigates there when it is not, so the
        // arrow goes where it says either way. Only an unlabelled header falls back to
        // plain history, which is the one case where no promise was made.
        onPress={() => {
          if (onBack) { onBack(); return; }
          if (backTo) { router.dismissTo(backTo as never); return; }
          if (router.canGoBack()) { router.back(); return; }
          router.replace('/' as never);
        }}
        style={({ pressed }) => StyleSheet.flatten([s.back, pressed && s.pressed])}
      >
        <AppIcon name="arrow-left" size={icon.md} color={colors.primary} />
        <Text numberOfLines={1} style={s.backText}>{backLabel ?? t.back}</Text>
      </Pressable>
      <View style={s.headerRow}>
        <View style={s.grow}>
          <Text accessibilityRole="header" style={s.title}>{title}</Text>
          {subtitle ? <Text style={s.sub}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

/**
 * A selectable pill. The pill stays compact so a row of them reads as one control, while
 * the pressable around it is a full 48dp — the project's own `minTouchTarget`, which a
 * chip sized to its text quietly undercuts.
 */
export function Chip({
  label, active, onPress, disabled, icon: ic,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
  icon?: IconName;
}) {
  const { s, colors } = useKit();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => { tapLight(); onPress(); }}
      style={({ pressed }) => StyleSheet.flatten([s.chipHit, disabled && s.disabled, pressed && s.pressed])}
    >
      <View style={[s.chip, active && s.chipOn]}>
        {ic ? <AppIcon name={ic} size={icon.xs} color={active ? colors.onPrimary : colors.textSecondary} /> : null}
        <Text numberOfLines={1} style={[s.chipText, active && s.chipTextOn]}>{label}</Text>
      </View>
    </Pressable>
  );
}

/**
 * A row of chips behaving as one choice. Tapping the active one clears it.
 *
 * `labelStyle` exists for one reason: a caller with its own `makeStyles` (most screens
 * outside the debt module) has its own `label` text style, not this file's `s.label` --
 * usually close, sometimes visibly not (bolder weight, different colour or spacing). A
 * first attempt at reusing this component in those screens skipped that check, converted
 * eight call sites, and only caught the mismatch by reading the two style objects side by
 * side afterward -- by then the wallet-picker's own label would have looked subtly
 * different from every other label on the same screen. Passing the caller's own label
 * style back in here is what lets this be reused there with no visual change at all;
 * omitting it keeps every existing caller (the debt module) exactly as it rendered before.
 */
export function ChipGroup<T extends string>({
  label, options, value, onChange, labelOf, hint, labelStyle,
}: {
  label?: string;
  options: readonly T[];
  value: T | null;
  onChange: (next: T | null) => void;
  labelOf: (key: T) => string;
  hint?: string;
  labelStyle?: StyleProp<TextStyle>;
}) {
  const { s } = useKit();
  return (
    <View>
      {label ? <Text style={[s.label, labelStyle]}>{label}</Text> : null}
      <View style={s.chipRow}>
        {options.map((o) => (
          <Chip key={o} label={labelOf(o)} active={value === o} onPress={() => onChange(value === o ? null : o)} />
        ))}
      </View>
      {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/** A labelled text input — the same shape on every form in the app. */
export function Field({
  label, value, onChangeText, placeholder, keyboardType, multiline, hint, autoFocus,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad';
  multiline?: boolean;
  hint?: string;
  autoFocus?: boolean;
}) {
  const { s, colors } = useKit();
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        autoFocus={autoFocus}
        accessibilityLabel={label}
        style={multiline ? s.textarea : s.input}
      />
      {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/** The bottom bar a form ends with: cancel on the left, save on the right. */
export function FormBar({
  onCancel, onSave, saving, saveLabel, cancelLabel, disabled, danger,
}: {
  onCancel: () => void;
  onSave: () => void | Promise<unknown>;
  saving?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  const { s, t, colors } = useKit();
  // `saving` is React state, so two taps inside one frame both saw it false and both saved.
  // The ref flips synchronously on the first tap; it is released when the save settles
  // (a returned promise) or, for a plain handler, on the next frame.
  const busy = useRef(false);
  const press = () => {
    if (busy.current || saving || disabled) return;
    busy.current = true;
    let result: unknown;
    try { result = onSave(); } catch (e) { busy.current = false; throw e; }
    if (result && typeof (result as Promise<unknown>).finally === 'function') {
      (result as Promise<unknown>).finally(() => { busy.current = false; }).catch(() => undefined);
    } else {
      requestAnimationFrame(() => { busy.current = false; });
    }
  };
  return (
    <View style={s.formBar}>
      <Pressable
        accessibilityRole="button"
        onPress={onCancel}
        style={({ pressed }) => StyleSheet.flatten([s.secondary, pressed && s.pressed])}
      >
        <Text numberOfLines={1} style={s.secondaryText}>{cancelLabel ?? t.cancel}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: !!saving, disabled: !!disabled }}
        disabled={disabled || saving}
        onPress={press}
        style={({ pressed }) => StyleSheet.flatten([
          s.primary, s.grow,
          danger ? { backgroundColor: colors.danger } : null,
          (disabled || saving) && s.disabled,
          pressed && s.pressed,
        ])}
      >
        {saving ? <ActivityIndicator color={colors.onPrimary} /> : (
          <>
            <AppIcon name="check" size={icon.sm} color={colors.onPrimary} />
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={s.primaryText}>{saveLabel ?? t.save}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

/** A 0-100 progress bar. `pct` is clamped, so callers can hand it raw percentages. */
export function Bar({ pct, tone }: { pct: number; tone: AccentRole }) {
  // `pct` is 0-100, not a fraction. Every screen written after the first four passed a
  // 0-1 fraction and drew a bar at roughly zero — correct-looking code, silently wrong
  // output. NaN is caught here too: it would otherwise become a negative width, which
  // React Native lays out as a stretched bar rather than as an error anyone would see.
  const safe = Number.isFinite(pct) ? pct : 0;
  const { s } = useKit();
  const width = `${Math.max(0, Math.min(100, Math.round(safe)))}%` as const;
  return (
    <View style={s.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.max(0, Math.min(100, Math.round(safe))) }}>
      <View style={[s.barFill, { width, backgroundColor: tone.base }]} />
    </View>
  );
}

/** One label/value line — the workhorse of every summary screen. */
export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: AccentRole }) {
  const { s } = useKit();
  return (
    <View style={s.statRow}>
      <View style={s.grow}>
        <Text style={s.statLabel}>{label}</Text>
        {hint ? <Text style={s.statHint}>{hint}</Text> : null}
      </View>
      <Text numberOfLines={1} style={[s.statValue, tone ? { color: tone.on } : null]}>{value}</Text>
    </View>
  );
}

export function Card({ title, children, style }: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { s } = useKit();
  return (
    <View style={[s.card, style]}>
      {title ? <Text numberOfLines={2} style={s.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

/**
 * Nothing here yet — and what to do about it.
 *
 * An empty state that only says "nothing here" leaves the user to work out the next move
 * on a screen that has just told them it has nothing to offer. Where there is an obvious
 * next action, `action` puts it inside the same box, so the answer is where the question
 * was asked.
 */
export function EmptyNote({
  icon: ic, text, action, onAction,
}: {
  icon: IconName;
  text: string;
  /** The next thing to do, in the user's language. */
  action?: string;
  onAction?: () => void;
}) {
  const { s, colors } = useKit();
  return (
    <View style={s.emptyBox}>
      <AppIcon name={ic} size={28} color={colors.textMuted} />
      <Text style={s.emptyHint}>{text}</Text>
      {action && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action}
          onPress={onAction}
          style={({ pressed }) => StyleSheet.flatten([s.emptyAction, pressed && s.pressed])}
        >
          <Text numberOfLines={1} style={s.emptyActionText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── multi-value input ─────────────────────────────────────────────────────────

/** A stored multi-value field: comma-separated, so old single-value rows still read. */
export function splitMulti(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}
export function joinMulti(values: string[]): string | null {
  const clean = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  return clean.length ? clean.join(',') : null;
}

/**
 * Pick any number of options, and write your own.
 *
 * A predefined list is a shortcut, never a cage: no fixed set of reasons ever covers why
 * someone borrowed, what a symptom was, or what a study session was for. The custom entry
 * is a labelled row rather than a bare "+", because a bare "+" beside a list of choices
 * reads as decoration and gets ignored.
 */
export function MultiChipGroup({
  label, options, values, onChange, labelOf, hint, addLabel, addPlaceholder, otherKey,
}: {
  label?: string;
  options: readonly string[];
  values: string[];
  onChange: (next: string[]) => void;
  labelOf: (key: string) => string;
  hint?: string;
  addLabel?: string;
  addPlaceholder?: string;
  /** The "অন্যান্য" option: turning it on opens the write-your-own row, so "Other" always says what. */
  otherKey?: string;
}) {
  const { s, t, bn, colors } = useKit();
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  // The typed text goes into `values` as it is typed, not only on ✓. A form's Save reads
  // `values`, and Save tapped with the keyboard still up (no blur, no ✓) used to drop what
  // the user had just written for "অন্যান্য". `live` remembers which entry is the one being
  // typed, so each keystroke replaces it instead of adding another.
  const [live, setLive] = useState<string | null>(null);

  const custom = values.filter((v) => !options.includes(v) && v !== live);
  const toggle = useCallback((key: string) => {
    tapSelect();
    if (key === otherKey && !values.includes(key)) setAdding(true);
    onChange(values.includes(key) ? values.filter((v) => v !== key) : [...values, key]);
  }, [onChange, values, otherKey]);

  const typeDraft = (text: string) => {
    setDraft(text);
    const v = text.trim();
    const base = live !== null ? values.filter((x) => x !== live) : values;
    if (v && !base.includes(v)) { setLive(v); onChange([...base, v]); return; }
    setLive(null);
    if (base !== values) onChange(base);
  };

  const addCustom = () => {
    const v = draft.trim();
    if (!v) { setAdding(false); return; }
    tapSelect();
    if (live === null && !values.includes(v)) onChange([...values, v]);
    setLive(null);
    setDraft('');
    setAdding(false);
  };

  const openAdd = () => { tapLight(); setAdding(true); };
  const addText = addLabel ?? (bn ? 'নিজে লিখে দিন' : 'Write your own');

  return (
    <View>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <View style={s.chipRow}>
        {options.map((o) => (
          <Pressable
            key={o}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: values.includes(o) }}
            accessibilityLabel={labelOf(o)}
            onPress={() => toggle(o)}
            style={({ pressed }) => StyleSheet.flatten([s.chipHit, pressed && s.pressed])}
          >
            <View style={[s.chip, values.includes(o) && s.chipOn]}>
              {values.includes(o) ? <AppIcon name="check" size={icon.xs} color={colors.onPrimary} /> : null}
              <Text numberOfLines={1} style={[s.chipText, values.includes(o) && s.chipTextOn]}>{labelOf(o)}</Text>
            </View>
          </Pressable>
        ))}
        {custom.map((v) => (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityLabel={`${v} — ${t.remove}`}
            onPress={() => toggle(v)}
            style={({ pressed }) => StyleSheet.flatten([s.chipHit, pressed && s.pressed])}
          >
            <View style={[s.chip, s.chipOn]}>
              <Text numberOfLines={1} style={[s.chipText, s.chipTextOn]}>{v}</Text>
              <AppIcon name="close" size={icon.xs} color={colors.onPrimary} />
            </View>
          </Pressable>
        ))}
      </View>

      {adding ? (
        <View style={s.row}>
          <TextInput
            value={draft}
            onChangeText={typeDraft}
            autoFocus
            placeholder={addPlaceholder ?? addText}
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={addCustom}
            returnKeyType="done"
            accessibilityLabel={addPlaceholder ?? addText}
            style={[s.input, s.grow]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.save}
            onPress={addCustom}
            style={({ pressed }) => StyleSheet.flatten([s.iconBtn, { backgroundColor: colors.primary }, pressed && s.pressed])}
          >
            <AppIcon name="check" size={icon.md} color={colors.onPrimary} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={addText}
          onPress={openAdd}
          style={({ pressed }) => StyleSheet.flatten([s.addRow, pressed && s.pressed])}
        >
          <AppIcon name="pencil-plus-outline" size={icon.sm} color={colors.primary} />
          <Text numberOfLines={1} style={s.addRowText}>{addText}</Text>
        </Pressable>
      )}

      {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/** A labelled on/off row — the gate in front of an optional section. */
export function ToggleRow({
  label, hint, value, onChange, icon: ic,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  icon?: IconName;
}) {
  const { s, colors } = useKit();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => { tapSelect(); onChange(!value); }}
      style={({ pressed }) => StyleSheet.flatten([s.toggleRow, pressed && s.pressed])}
    >
      {ic ? (
        <View style={[s.avatar, { backgroundColor: value ? colors.primaryTint : colors.surfaceMuted }]}>
          <AppIcon name={ic} size={icon.md} color={value ? colors.primary : colors.textMuted} />
        </View>
      ) : null}
      <View style={s.grow}>
        <Text numberOfLines={2} style={s.listTitle}>{label}</Text>
        {hint ? <Text style={s.listMeta}>{hint}</Text> : null}
      </View>
      <View style={[s.track, { backgroundColor: value ? colors.primary : colors.borderStrong }]}>
        <View style={[s.knob, { backgroundColor: colors.surface }, value && s.knobOn]} />
      </View>
    </Pressable>
  );
}

function makeKitStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl + spacing.xl },
    center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
    headerWrap: { marginBottom: spacing.md },
    headerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.xs },
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700' },
    sub: { color: colors.textSecondary, ...typography.caption, marginTop: 2 },
    grow: { flex: 1, minWidth: 0 },

    card: { borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.md, ...elevation.soft },
    cardTitle: { color: colors.textMuted, ...typography.section, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm },
    sectionTitle: { color: colors.textMuted, ...typography.section, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm, marginTop: spacing.sm },

    statRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
    statLabel: { color: colors.textSecondary, ...typography.bodySmall },
    statHint: { color: colors.textMuted, ...typography.caption, marginTop: 1 },
    statValue: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '800', fontFamily: typography.numeric.fontFamily },

    big: { color: colors.textPrimary, ...typography.display, fontWeight: '800', fontFamily: typography.numeric.fontFamily },
    bigLabel: { color: colors.textSecondary, ...typography.caption, marginTop: 2 },

    bar: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden', marginTop: spacing.xs },
    barFill: { height: '100%', borderRadius: radius.pill },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chipHit: { minHeight: layout.minTouchTarget, justifyContent: 'center' },
    chip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { flexShrink: 1, color: colors.textSecondary, ...typography.bodySmall, fontWeight: '700' },
    chipTextOn: { color: colors.onPrimary },

    // The custom-entry affordance: a labelled row, not a chip pretending to be an option.
    addRow: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
    addRowText: { flexShrink: 1, color: colors.primary, ...typography.caption, fontWeight: '800' },
    iconBtn: { width: control.inputHeight, height: control.inputHeight, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },

    fieldHint: { color: colors.textMuted, ...typography.caption, marginTop: spacing.xs },
    textarea: { minHeight: 96, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.textPrimary, padding: spacing.md, ...typography.body, textAlignVertical: 'top' },
    formBar: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderTopWidth: border.thin, borderTopColor: colors.border, backgroundColor: colors.surface },
    secondary: { minHeight: control.buttonHeight, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { flexShrink: 1, color: colors.textSecondary, ...typography.callout, fontWeight: '800' },
    dangerBtn: { minHeight: control.buttonHeight, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.danger, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
    dangerText: { flexShrink: 1, color: colors.danger, ...typography.callout, fontWeight: '800' },

    input: { minHeight: control.inputHeight, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, color: colors.textPrimary, paddingHorizontal: spacing.md, ...typography.input },
    label: { color: colors.textSecondary, ...typography.caption, fontWeight: '700', marginBottom: spacing.xxs, marginTop: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

    primary: { minHeight: control.buttonHeight, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
    primaryText: { flexShrink: 1, color: colors.onPrimary, ...typography.callout, fontWeight: '800' },
    ghost: { minHeight: control.buttonHeight, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
    ghostText: { flexShrink: 1, color: colors.primary, ...typography.callout, fontWeight: '800' },

    listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.xs, ...elevation.soft },
    listTitle: { flexShrink: 1, color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    listMeta: { color: colors.textSecondary, ...typography.caption, marginTop: 2 },
    listAmt: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '800', fontFamily: typography.numeric.fontFamily },

    badge: { borderWidth: border.thin, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
    badgeText: { ...typography.caption, fontWeight: '800' },

    avatar: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: control.rowMinHeight, paddingVertical: spacing.xs },
    track: { width: 48, height: 28, borderRadius: radius.pill, padding: 3, justifyContent: 'center' },
    knob: { width: 22, height: 22, borderRadius: radius.pill },
    knobOn: { alignSelf: 'flex-end' },

    emptyBox: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
    emptyAction: { minHeight: layout.minTouchTarget, marginTop: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    emptyActionText: { color: colors.primary, ...typography.callout, fontWeight: '800', flexShrink: 1 },
    emptyHint: { color: colors.textSecondary, ...typography.caption, textAlign: 'center', paddingHorizontal: spacing.lg },

    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.78 },
  });
}

export type { ThemeAccents, ThemeColors, AccentRole, IconName };
