---
version: alpha
name: Sumon-VA-design-system
description: "Calm, Bengali-first message console. Warm cream canvas, white hairline cards with no drop shadows, one navy action colour, gold reserved for AI and urgent, restrained glass only on floating chrome. Intercom's structure carried on Sumon VA's own Sapphire and Gold palette."

colors:
  # day
  canvas: "#F5F1EC"
  surface: "#FFFFFF"
  surface-muted: "#EBE7E1"
  surface-sunken: "#E2DDD5"
  hairline: "#D3CEC6"
  hairline-soft: "#EBE7E1"
  ink: "#131720"
  ink-secondary: "#464E60"
  ink-muted: "#5A5F6C"
  primary: "#1E2B6B"
  primary-pressed: "#182357"
  primary-tint: "#E7EAF6"
  on-primary: "#FFFFFF"
  gold: "#8E6724"
  gold-text: "#7A5614"
  gold-tint: "#F3ECDA"
  success: "#1C7E45"
  warning: "#92660F"
  danger: "#C13B2E"
  info: "#2A79BE"
  overlay: "rgba(16, 20, 30, 0.46)"
  # night (unchanged from the current app)
  night-canvas: "#0B1030"
  night-surface: "#151C42"
  night-surface-muted: "#1E2755"
  night-hairline: "#2A3470"
  night-ink: "#F2F4FF"
  night-ink-muted: "#9AA4CF"
  night-primary: "#8EA0E6"
  night-on-primary: "#07122A"
  night-gold: "#D9B663"
  # dim (unchanged: near-black warm, low blue light)
  dim-canvas: "#0B0A09"
  dim-surface: "#15130F"
  dim-primary: "#D6A453"

typography:
  family-text: "Noto Sans Bengali"
  family-numeric: "Inter"
  weights: "400 body, 500 labels and metadata, 600 card titles, 700 page titles only. Never lighter than 400 (Bengali conjuncts thin out)."
  display: {size: 30, line: 40, weight: 700, tracking: -0.4}
  title: {size: 24, line: 32, weight: 700}
  heading: {size: 20, line: 28, weight: 600}
  card-title: {size: 17, line: 25, weight: 600}
  body: {size: 15, line: 24, weight: 400}
  body-small: {size: 14, line: 22, weight: 400}
  meta: {size: 13, line: 19, weight: 500}
  label: {size: 12, line: 17, weight: 600}
  note: "Line-heights keep extra headroom for Bengali reph and hasanta. Digits follow the language: Bangla digits when the UI is Bangla."

spacing: {xxs: 4, xs: 4, sm: 8, smd: 12, md: 16, mdPlus: 20, lg: 24, xl: 32, lgPlus: 40, xxl: 48}
rounded: {chip: 8, button: 10, card: 12, dialog: 18, sheet-top: 20, avatar: full}
control: {input-height: 52, button-height: 48, row-min-height: 64, min-touch-target: 48, chip-height: 36}
motion: {fast: 120, standard: 200, slow: 300, reduce-motion: "respect the OS and the in-app switch"}

glass:
  rule: "Floating chrome only: bottom navigation, dialogs, bottom sheets. Never on cards, lists, forms or long text."
  bottom-nav: {opacity: 0.62, blur-intensity: 24, border: "1px hairline"}
  dialog-sheet: {opacity: 0.80, scrim: "overlay"}
  android: "blur only on Android 12 and newer (expo-blur blurMethod dimezisBlurViewSdk31Plus with a BlurTargetView); otherwise a solid surface. Always keep the solid fallback."
---

# Sumon VA — Design System

## 1. Visual theme and atmosphere
A calm, warm, editorial console for one person who is busy and easily annoyed by noise. Cream canvas (the same family as the launcher-icon cream), white cards lifted from it, thin warm hairlines, charcoal-navy ink, one navy action colour. Gold appears only where the assistant (AI) speaks or something is urgent. No decorative colour, no gradients except one brand hero.

## 2. Colour roles
`canvas` page ground · `surface` cards, inputs, dialogs · `surface-muted` chips, quiet fills · `hairline` all borders and dividers · `ink` text · `ink-muted` secondary text (never lighter) · `primary` the single action colour (filled button, selected chip, active tab) · `gold` fill for AI or urgent badges only; `gold-text` for gold-coloured words on cream · semantic colours (`success`, `warning`, `danger`, `info`) only with their meaning, never for decoration. Night and dim keep their own palettes with the same roles.
Contrast rules (measured): ink on canvas 15.95:1, primary on canvas 11.58:1, white on primary 13.02:1, ink-muted `#5A5F6C` on canvas 5.68:1, gold-text `#7A5614` on canvas 5.89:1, white on gold `#8E6724` 5.10:1. Minimum 4.5:1 for text, 3:1 for icons and borders.

## 3. Typography rules
Noto Sans Bengali carries all Bengali and most UI text; Inter only for Latin text and numerals where used. Use the family that carries the weight (weight-named families on Android). Scale above. Two weights per card at most. No all-caps tracked eyebrows. Titles may wrap to two lines at large font sizes; never truncate a page title.

## 4. Components
- **Card**: surface, 12 radius, 1px hairline, no shadow; lifts from canvas by colour, not shadow.
- **Chip**: 8 radius, 36 high, `surface-muted`; selected = `primary` fill with `on-primary` text. Not pill-shaped.
- **Button**: 48 high, 10 radius; at most ONE filled `primary` button per screen section; others are hairline-outline or text buttons. No pill CTAs.
- **Badge**: 8 radius; gold only for AI or urgent; otherwise `primary-tint` or semantic tint.
- **Input**: 52 high, surface, hairline, 12 radius; label above; error text below in `danger`.
- **List row**: min 64 high, hairline divider, avatar 34–44, 14–15 text, 12–13 meta.
- **Hero**: the only gradient (flat navy to deep navy); one per screen at most.
- **Bottom navigation**: 4 destinations, monochrome icons (active `primary`, inactive `ink-muted`), glass per rules.
- **Dialog / sheet**: 18 radius (sheet top 20), glass 0.80 over scrim, solid fallback.
- **Snackbar**: solid surface with the floating shadow.
- **Status states**: loading = skeleton plus a calm "free server is waking up" note when slow; empty = quiet icon + one action; error = hairline-red card with reason and retry.

## 5. Layout principles
4-point spacing; 16 side gutter on phones, 24 on wide; content max width 760; cards stack with 10–12 gap; headings 24 above section content. Portrait phone is the target; layouts must survive 1.5× system font.

## 6. Depth and elevation
Hairlines do structure. Shadows only on floating things (dialog, snackbar, glass bar edge). Glass only on floating chrome (see front matter).

## 7. Do and don't
Do: keep gold rare; use the Bengali digit style in Bengali UI; keep every tap target at 48 dp; give every icon-only button a Bangla accessibility label; show the real reason for any failure. Don't: use light font weights; add a second accent colour; put shadows on cards; blur content; show two different truths about the same status.

## 8. Responsive behaviour
Phone portrait first (compact < 600). Medium/expanded use the existing size classes; max content width 760; side navigation rail at 840+. Test at 1.0× and 1.5× system font, light/night/dim.

## 9. Agent prompt guide
"Use only tokens from `src/theme/index.ts`. Cream canvas, white hairline cards, no shadows, one navy action colour, gold only for AI/urgent, weights 400/500/600 (700 for page titles), 48 dp targets, glass only on bottom nav and dialogs with a solid fallback. Keep Bangla text in Noto Sans Bengali. Do not change business logic, API calls, navigation behaviour or data. Structural UX changes need the owner's separate approval."
