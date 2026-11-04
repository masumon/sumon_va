// ── Sumon VA · three design themes (owner-approved 2026-11-05) ─────────────────────────────────
// A "আভা কাচ" (aurora glass) · B "প্রিমিয়াম" (premium) · C "রঙিন উষ্ণ" (warm and colourful).
// Each design has a light and a dark palette; the existing low-light "dim" mode stays as it was for every design.
// Everything here is visual: no screen logic reads these values except to paint itself.
// Text colours follow meaning in every design: ink = normal, danger = red, warning = amber (a pure yellow is unreadable on
// light backgrounds), success = green, info = blue, primary = the design's action colour.
import { dimColors, type ThemeColors } from './index';

export type DesignId = 'aurora' | 'prime' | 'warm';
export const DESIGN_IDS: DesignId[] = ['aurora', 'prime', 'warm'];
export const DEFAULT_DESIGN: DesignId = 'aurora';

type Mode = 'light' | 'dark' | 'dim';

const lightA: ThemeColors = { background: '#F4F6FB', surface: '#FFFFFF', surfaceMuted: '#EEF0FB', surfaceSunken: '#E4E7F5', primary: '#4F46E5', primaryPressed: '#4338CA', primaryTint: '#EEF0FF', onPrimary: '#FFFFFF', accent: '#7C3AED', textPrimary: '#111827', textSecondary: '#374151', textMuted: '#4B5563', border: '#E1E4F2', borderStrong: '#C9CEE6', success: '#15803D', warning: '#B45309', danger: '#B91C1C', info: '#1D4ED8', overlay: 'rgba(17, 24, 39, 0.5)' };
const darkA: ThemeColors = { background: '#0B1020', surface: '#151B34', surfaceMuted: '#1E2547', surfaceSunken: '#0E1428', primary: '#A5B4FC', primaryPressed: '#8B9CF5', primaryTint: '#222A57', onPrimary: '#0B1020', accent: '#C4B5FD', textPrimary: '#F3F4F6', textSecondary: '#D1D5DB', textMuted: '#A9B2C8', border: '#27304D', borderStrong: '#3A4672', success: '#86EFAC', warning: '#FCD34D', danger: '#FCA5A5', info: '#93C5FD', overlay: 'rgba(0, 0, 0, 0.66)' };

const lightB: ThemeColors = { background: '#EBEFF8', surface: '#FFFFFF', surfaceMuted: '#E3E9F6', surfaceSunken: '#D8DFF0', primary: '#3730A3', primaryPressed: '#2E2788', primaryTint: '#E3E6FA', onPrimary: '#FFFFFF', accent: '#0E7490', textPrimary: '#0F172A', textSecondary: '#334155', textMuted: '#475569', border: '#D5DCEE', borderStrong: '#B8C2DC', success: '#15803D', warning: '#B45309', danger: '#B91C1C', info: '#1D4ED8', overlay: 'rgba(15, 23, 42, 0.5)' };
const darkB: ThemeColors = { background: '#080C1C', surface: '#10162D', surfaceMuted: '#171F3E', surfaceSunken: '#0A0F22', primary: '#818CF8', primaryPressed: '#6366F1', primaryTint: '#1C2550', onPrimary: '#0A0F22', accent: '#22D3EE', textPrimary: '#F3F4F6', textSecondary: '#D1D5DB', textMuted: '#A3AEC9', border: '#232C4E', borderStrong: '#34406B', success: '#86EFAC', warning: '#FCD34D', danger: '#FCA5A5', info: '#7DD3FC', overlay: 'rgba(0, 0, 0, 0.7)' };

const lightC: ThemeColors = { background: '#FFF7ED', surface: '#FFFFFF', surfaceMuted: '#FFEDD5', surfaceSunken: '#FDE3C3', primary: '#C2410C', primaryPressed: '#9A3412', primaryTint: '#FFEDD5', onPrimary: '#FFFFFF', accent: '#DB2777', textPrimary: '#1F2937', textSecondary: '#44403C', textMuted: '#57534E', border: '#F1E4D3', borderStrong: '#E5CDB0', success: '#15803D', warning: '#B45309', danger: '#B91C1C', info: '#1D4ED8', overlay: 'rgba(31, 24, 18, 0.5)' };
const darkC: ThemeColors = { background: '#1C1410', surface: '#2A1D16', surfaceMuted: '#36261D', surfaceSunken: '#150F0B', primary: '#FB923C', primaryPressed: '#F97316', primaryTint: '#3D2A1D', onPrimary: '#2A1205', accent: '#F472B6', textPrimary: '#FFF7ED', textSecondary: '#E7D5C4', textMuted: '#B8A594', border: '#4A3527', borderStrong: '#634632', success: '#86EFAC', warning: '#FCD34D', danger: '#FCA5A5', info: '#93C5FD', overlay: 'rgba(0, 0, 0, 0.7)' };

const PALETTES: Record<DesignId, { light: ThemeColors; dark: ThemeColors }> = {
  aurora: { light: lightA, dark: darkA },
  prime: { light: lightB, dark: darkB },
  warm: { light: lightC, dark: darkC },
};

export function getDesignColors(id: DesignId, mode: Mode): ThemeColors {
  if (mode === 'dim') return dimColors;
  return PALETTES[id][mode];
}

export type Blob = { color: string; alpha: number; cx: string; cy: string; r: string };
export type Shadow = { shadowColor: string; shadowOpacity: number; shadowRadius: number; shadowOffset: { width: number; height: number }; elevation: number };
export type Grad2 = [string, string];

/** What a design adds on top of the colours: corner sizes, translucent card fill, shadow, gradients and the background art. */
export type DesignTokens = {
  id: DesignId;
  blobs: Blob[];
  baseColor: string;
  radiusCard: number; radiusChip: number; radiusButton: number; radiusHero: number; radiusBar: number;
  cardFill: string; cardBorder: string; shadow: Shadow | null; heroShadow: Shadow | null;
  heroGrad: Grad2; ctaGrad: Grad2; drawerGrad: Grad2;
  barFill: string; barBorder: string;
  /** Tinted, coloured icon tiles (drawer, lists) instead of plain outline icons. */
  tiles: boolean;
};

const sh = (color: string, opacity: number, radius: number, y: number, elevation: number): Shadow => ({ shadowColor: color, shadowOpacity: opacity, shadowRadius: radius, shadowOffset: { width: 0, height: y }, elevation });

export function getDesignTokens(id: DesignId, mode: Mode): DesignTokens {
  const dark = mode !== 'light';
  const dim = mode === 'dim';
  const colors = getDesignColors(id, mode);
  const base = {
    id, baseColor: colors.background,
    // low-light mode stays calm: no background art, no coloured glow
    blobs: [] as Blob[], tiles: true,
  };
  if (id === 'aurora') {
    return {
      ...base,
      blobs: dim ? [] : dark
        ? [{ color: '#6366F1', alpha: 0.42, cx: '12%', cy: '4%', r: '62%' }, { color: '#C026D3', alpha: 0.26, cx: '96%', cy: '30%', r: '58%' }, { color: '#0EA5E9', alpha: 0.26, cx: '20%', cy: '92%', r: '58%' }]
        : [{ color: '#6366F1', alpha: 0.38, cx: '12%', cy: '4%', r: '62%' }, { color: '#F472B6', alpha: 0.30, cx: '96%', cy: '30%', r: '58%' }, { color: '#38BDF8', alpha: 0.30, cx: '20%', cy: '92%', r: '58%' }, { color: '#FBBF24', alpha: 0.22, cx: '90%', cy: '96%', r: '50%' }],
      radiusCard: 18, radiusChip: 12, radiusButton: 14, radiusHero: 24, radiusBar: 22,
      cardFill: dim ? colors.surface : dark ? 'rgba(21,27,52,0.72)' : 'rgba(255,255,255,0.72)',
      cardBorder: dim ? colors.border : dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.9)',
      shadow: dim ? null : sh(dark ? '#000000' : '#4F46E5', dark ? 0.35 : 0.12, 16, 6, 3),
      heroShadow: dim ? null : sh('#4F46E5', 0.35, 18, 8, 6),
      heroGrad: dim ? ['#2A2214', '#15130F'] : ['#4F46E5', '#7C3AED'], ctaGrad: dim ? ['#D6A453', '#BF8F44'] : ['#4F46E5', '#7C3AED'], drawerGrad: dim ? ['#2A2214', '#15130F'] : ['#4F46E5', '#7C3AED'],
      barFill: dim ? colors.surface : dark ? 'rgba(21,27,52,0.84)' : 'rgba(255,255,255,0.80)', barBorder: dim ? colors.border : dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.95)',
    };
  }
  if (id === 'prime') {
    return {
      ...base,
      blobs: dim ? [] : dark
        ? [{ color: '#4F46E5', alpha: 0.40, cx: '14%', cy: '4%', r: '60%' }, { color: '#06B6D4', alpha: 0.26, cx: '98%', cy: '32%', r: '56%' }, { color: '#F59E0B', alpha: 0.18, cx: '18%', cy: '94%', r: '56%' }]
        : [{ color: '#4F46E5', alpha: 0.18, cx: '14%', cy: '4%', r: '60%' }, { color: '#06B6D4', alpha: 0.16, cx: '98%', cy: '32%', r: '56%' }],
      radiusCard: 16, radiusChip: 10, radiusButton: 12, radiusHero: 20, radiusBar: 20,
      cardFill: dim ? colors.surface : dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.82)',
      cardBorder: dim ? colors.border : dark ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.95)',
      shadow: dim ? null : sh('#000000', dark ? 0.45 : 0.10, 16, 6, 3),
      heroShadow: dim ? null : sh('#6366F1', 0.45, 20, 8, 6),
      heroGrad: dim ? ['#2A2214', '#15130F'] : ['#4F46E5', '#0891B2'], ctaGrad: dim ? ['#D6A453', '#BF8F44'] : ['#6366F1', '#06B6D4'], drawerGrad: dim ? ['#2A2214', '#15130F'] : ['#4F46E5', '#0891B2'],
      barFill: dim ? colors.surface : dark ? 'rgba(16,22,45,0.86)' : 'rgba(255,255,255,0.84)', barBorder: dim ? colors.border : dark ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.95)',
    };
  }
  return {
    ...base,
    blobs: dim ? [] : dark
      ? [{ color: '#EA580C', alpha: 0.30, cx: '92%', cy: '4%', r: '56%' }, { color: '#DB2777', alpha: 0.22, cx: '4%', cy: '44%', r: '54%' }]
      : [{ color: '#FDBA74', alpha: 0.46, cx: '92%', cy: '4%', r: '56%' }, { color: '#F9A8D4', alpha: 0.36, cx: '4%', cy: '44%', r: '54%' }, { color: '#86EFAC', alpha: 0.36, cx: '72%', cy: '96%', r: '56%' }],
    radiusCard: 22, radiusChip: 16, radiusButton: 16, radiusHero: 28, radiusBar: 28,
    cardFill: dim ? colors.surface : colors.surface, cardBorder: dim ? colors.border : colors.border,
    shadow: dim ? null : sh(dark ? '#000000' : '#9A3412', dark ? 0.4 : 0.10, 14, 5, 3),
    heroShadow: dim ? null : sh('#EA580C', 0.35, 18, 8, 6),
    heroGrad: dim ? ['#2A2214', '#15130F'] : ['#EA580C', '#DB2777'], ctaGrad: dim ? ['#D6A453', '#BF8F44'] : ['#EA580C', '#DB2777'], drawerGrad: dim ? ['#2A2214', '#15130F'] : ['#EA580C', '#DB2777'],
    barFill: dim ? colors.surface : colors.surface, barBorder: dim ? colors.border : colors.border,
  };
}

/** The list the Settings screen shows. `swatch` = three colours that identify the design at a glance. */
export const DESIGN_INFO: { id: DesignId; bn: string; en: string; hintBn: string; hintEn: string; swatch: [string, string, string] }[] = [
  { id: 'aurora', bn: 'আভা কাচ', en: 'Aurora glass', hintBn: 'রঙিন আভার ওপর কাচের কার্ড', hintEn: 'Glass cards over a soft colour glow', swatch: ['#4F46E5', '#7C3AED', '#F472B6'] },
  { id: 'prime', bn: 'প্রিমিয়াম', en: 'Premium', hintBn: 'গভীর রং, জ্বলজ্বলে গ্রেডিয়েন্ট', hintEn: 'Deep colour with glowing gradients', swatch: ['#4F46E5', '#0891B2', '#F59E0B'] },
  { id: 'warm', bn: 'রঙিন উষ্ণ', en: 'Warm and colourful', hintBn: 'উষ্ণ রং, বড় গোল কার্ড', hintEn: 'Warm colours, big rounded cards', swatch: ['#EA580C', '#DB2777', '#86EFAC'] },
];
