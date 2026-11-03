import { createContext, forwardRef, useContext, useMemo, type ComponentRef } from 'react';
import { useAppPreferencesOptional } from '../app/AppPreferences';
import { Platform, StyleSheet, Text as RNText, TextInput as RNTextInput, type TextProps, type TextInputProps } from 'react-native';

// Thin wrappers over RN's Text / TextInput that put a ceiling on OS font-scaling.
// RN 0.86 dropped `Text.defaultProps`, so a global clamp has to live in a wrapper the
// screens import. `maxFontSizeMultiplier` (not `allowFontScaling={false}`) is the
// accessible choice — large-text users still get bigger type, just not so big it breaks
// fixed-height rows, chips and buttons. Callers can still override per element (the
// spread comes after the default).
const TEXT_CEILING = 1.7;
const INPUT_CEILING = 1.5;

// ── letter spacing and Bengali do not mix ────────────────────────────────────
//
// Android measures a line of Bengali with `letterSpacing` applied and gets the width
// wrong, so the line is cut off part-way — "এক লাইনে লিখুন বা বলুন" rendered as "এক লাইনে
// লিখুন বা", "৩ কিস্তি" as "৩". It is not a font problem and it is not fixable by widening
// the container; the measurement itself is wrong.
//
// Nearly fifty styles across the app set `letterSpacing`, almost all of them on eyebrows
// and section headings where it looks right in English and breaks in Bengali. Editing all
// of them would fix today's screens and none of tomorrow's, so the correction lives here
// instead: any text containing a Bengali character loses its letter spacing, whatever
// style asked for it. English text is untouched.
//
// The range is the Bengali block, U+0980–U+09FF, which covers Bengali and Assamese.
const BENGALI = /[ঀ-৿]/u;

/** Does this node, or anything inside it, contain Bengali? */
function hasBengali(node: unknown): boolean {
  if (typeof node === 'string') return BENGALI.test(node);
  if (typeof node === 'number') return false;
  if (Array.isArray(node)) return node.some(hasBengali);
  return false;
}

// ── bold without a bold font file ─────────────────────────────────────────────
//
// Every type token names one font file (NotoSansBengali_500Medium, Inter_600SemiBold…),
// and many styles then add `fontWeight: '700' | '800'` on top. Android cannot find an 800
// cut of a single-weight file, so it fakes bold by thickening the glyphs *after* the line
// was measured — the drawn text is wider than its box and the last word falls off:
// "মডেল সরান" → "মডেল", "অন্য ফাইল বেছে নিন" → "অন্য ফাইল বেছে" (vivo, RC.3). The fix is
// the one custom fonts need on Android: ask for the real bold file and drop fontWeight.
const WEIGHT_FILES: Record<string, Record<number, string>> = {
  NotoSansBengali: { 400: 'NotoSansBengali_400Regular', 500: 'NotoSansBengali_500Medium', 600: 'NotoSansBengali_600SemiBold', 700: 'NotoSansBengali_700Bold' },
  Inter: { 400: 'Inter_400Regular', 500: 'Inter_500Medium', 600: 'Inter_600SemiBold', 700: 'Inter_700Bold' },
};
function realWeightFont(family: string | undefined, weight: unknown): string | null {
  if (!family || weight === undefined) return null;
  const base = family.split('_')[0]!;
  const files = WEIGHT_FILES[base];
  if (!files) return null;
  const w = weight === 'bold' ? 700 : weight === 'normal' ? 400 : Number(weight);
  if (!Number.isFinite(w)) return null;
  const pick = w >= 700 ? 700 : w >= 600 ? 600 : w >= 500 ? 500 : 400;
  return files[pick] ?? null;
}

// ── Bengali on Android takes the font's own line, never a set lineHeight ──────
//
// Proved on the phone (text-lab, 2026-09-24): the same labels drawn eight ways, each in a
// box exactly as wide as Android measured it. Every variant with a `lineHeight` — bold
// file, fontWeight, even the plain regular file — broke Bengali: "বাদ দিন" lost "দিন",
// "এক লাইনে লিখুন বা বলুন" lost "বলুন", the lost word pushed onto a second line Android had
// not measured for, so it was cut off. The one variant with no lineHeight was perfect, and
// English was fine in all of them. So a lineHeight is not applied to Bengali on Android: the
// font's own line (NotoSansBengali: 1.325 em plus font padding) is used, which also keeps
// every matra, reph and u-kar whole. Font size is untouched; English keeps its lineHeight.

// ── the person's own text size (Settings → লেখার মাপ) ─────────────────────────────
//
// One number for the whole app, applied here so no screen has to know: 1 leaves every
// style exactly as written. Font sizes (and English line heights) are multiplied; Bengali
// keeps no line height on Android (see below), so it grows with its font on its own.
export const TextScaleContext = createContext(1);

/** A style with its font size (and line height, where one is kept) multiplied by `scale`. */
export function scaleTextStyle<T>(style: T, scale: number): T {
  if (scale === 1 || !style) return style;
  const flat = (StyleSheet.flatten(style as never) ?? {}) as { fontSize?: number; lineHeight?: number };
  // No size of its own = it inherits one (a <Text> inside a <Text>): leave it to the parent,
  // or the red " *" and nested amounts would jump to 14 × scale (rc.20 audit).
  if (typeof flat.fontSize !== 'number') return flat as T;
  return { ...flat, fontSize: Math.round(flat.fontSize * scale * 10) / 10, ...(typeof flat.lineHeight === 'number' ? { lineHeight: Math.round(flat.lineHeight * scale) } : {}) } as T;
}

const DEFAULT_FAMILY = 'NotoSansBengali_400Regular';
const DEFAULT_FACE = { fontFamily: DEFAULT_FAMILY };

export const AppText = forwardRef<ComponentRef<typeof RNText>, TextProps>(function AppText(
  { style, children, ...rest },
  ref,
) {
  const safeStyle = useMemo(() => {
    // Only Android needs this; iOS measures spaced Bengali correctly, and doing the work
    // on every text node there would be waste.
    if (Platform.OS !== 'android') return style;
    // A style that names no font used to fall through to the phone's own font, so those
    // cards looked unlike the rest of the app and their bold was faked (RC.5 polish). Such
    // text now gets the app's face too, in the real file for its weight.
    if (!style) return DEFAULT_FACE;
    const flat = StyleSheet.flatten(style);
    // Real bold file for any text, Bengali or not (see WEIGHT_FILES).
    const weightFile = !flat ? null
      : flat.fontFamily ? realWeightFont(flat.fontFamily, flat.fontWeight)
        : realWeightFont(DEFAULT_FAMILY, flat.fontWeight ?? 400);
    const weightFix = weightFile ? { fontFamily: weightFile, fontWeight: 'normal' as const } : null;
    if (!hasBengali(children)) return weightFix ? [style, weightFix] : style;
    // flexShrink matters as much as the spacing: a Text with neither, sitting in a row,
    // keeps whatever width Android measured for it — and for Bengali that measurement is
    // short, so the line is cut. "আপনার অংশগুলো" rendered as "আপনার".
    if (!flat) return style;
    const needsSpacing = flat.letterSpacing !== undefined && flat.letterSpacing !== 0;
    const needsShrink = flat.flexShrink === undefined && flat.flex === undefined;
    const hasLine = flat.lineHeight !== undefined;
    if (!needsSpacing && !needsShrink && !weightFix && !hasLine) return style;
    // One flattened style, so the lineHeight is truly gone rather than overridden. Android's
    // font padding stays on: without it (rc.18) every page looked cramped — rc.16's look.
    const { lineHeight: _dropped, ...withoutLine } = flat;
    return {
      ...withoutLine,
      ...(needsSpacing ? { letterSpacing: 0 } : {}),
      ...(needsShrink ? { flexShrink: 1 } : {}),
      ...(weightFix ?? {}),
    };

  }, [style, children]);
  const scale = useContext(TextScaleContext);
  const sized = useMemo(() => scaleTextStyle(safeStyle, scale), [safeStyle, scale]);
  // Text that names no colour used to fall back to the system's black — invisible on a dark background. It now follows the theme.
  const prefs = useAppPreferencesOptional();
  const hasColor = useMemo(() => { const f = StyleSheet.flatten(sized as never) as { color?: unknown } | undefined; return !!f && f.color !== undefined; }, [sized]);
  const finalStyle = !hasColor && prefs ? [{ color: prefs.colors.textPrimary }, sized] : sized;

  return (
    <RNText ref={ref} maxFontSizeMultiplier={TEXT_CEILING} style={finalStyle as never} {...rest}>
      {children}
    </RNText>
  );
});

export const AppTextInput = forwardRef<ComponentRef<typeof RNTextInput>, TextInputProps>(function AppTextInput(props, ref) {
  // The same root cause as Text (see above), in the boxes people type into: a set lineHeight
  // on Android cut Bengali in the Home box after saving (rc.13 review). Inputs change
  // language as the user types, so on Android the font's own line is always used — the box
  // keeps its size from minHeight and padding, and English looks the same without it.
  const style = useMemo(() => {
    if (Platform.OS !== 'android' || !props.style) return props.style;
    const flat = StyleSheet.flatten(props.style) ?? {};
    if (flat.lineHeight === undefined) return props.style;
    const { lineHeight: _dropped, ...withoutLine } = flat;
    return withoutLine;
  }, [props.style]);
  const scale = useContext(TextScaleContext);
  const sized = useMemo(() => scaleTextStyle(style, scale), [style, scale]);
  const prefs = useAppPreferencesOptional();
  const hasColor = useMemo(() => { const f = StyleSheet.flatten(sized as never) as { color?: unknown } | undefined; return !!f && f.color !== undefined; }, [sized]);
  const finalStyle = !hasColor && prefs ? [{ color: prefs.colors.textPrimary }, sized] : sized;
  return <RNTextInput ref={ref} maxFontSizeMultiplier={INPUT_CEILING} placeholderTextColor={prefs?.colors.textMuted} {...props} style={finalStyle as never} />;
});
