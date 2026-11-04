// ── Sumon VA · design system · "Intercom structure on Sapphire & Gold" (approved 2026-11-05, see DESIGN.md) ───────────────────────────────
// Direction: premium, calm, Bengali-first. A deep royal-sapphire brand with an antique
// gold secondary accent, set on cool paper in light and deep navy-black in dark.
// Hairline structure; one soft shadow for floating surfaces; glass only on floating
// chrome. `success` is its own green (done ≠ brand). Type: Noto Sans Bengali + Inter.
// This file is the single source of truth — there is no second palette anywhere.

// Font family names as registered in app/_layout.tsx (weight-named — do not rely on fontWeight
// with custom families on Android; pick the family that carries the weight you want).
export const fonts={regular:'NotoSansBengali_400Regular',medium:'NotoSansBengali_500Medium',semibold:'NotoSansBengali_600SemiBold',bold:'NotoSansBengali_700Bold',numRegular:'Inter_400Regular',numMedium:'Inter_500Medium',numSemibold:'Inter_600SemiBold',numBold:'Inter_700Bold'} as const;

// textMuted meets WCAG AA (>=4.5:1) for body text on `surface`/`background` while
// staying visibly lighter than textSecondary so the hierarchy survives.
// `surface` is a whisper-tinted off-white — never a stark #FFF against the cool paper.
//
// `primary` is sampled from the logo file itself (#0C3C85), not picked to look like it.
// It used to be a brighter sapphire that belonged to no other part of the app: the
// launcher icon, the splash, the notification shade and the PDF header were all the deep
// navy while every button inside was two shades lighter — close enough to read as a
// printing error rather than a choice. As a side benefit white-on-navy is ~9:1 against
// white where the old blue was ~6:1, so every primary button got more legible.
//
// The dark palette's `primary` stays a light tint (#7AA2FF) on purpose — #0C3C85 on a
// near-black background is all but invisible. Dark mode carries the brand in its hue,
// not its lightness.
// textMuted, accent, success and warning were each darkened just enough to clear the
// WCAG AA 4.5:1 text-contrast floor against `background` (verified by computing real
// relative-luminance contrast ratios, not eyeballed) — hue kept, lightness trimmed.
export const lightColors={background:'#F5F1EC',surface:'#FFFFFF',surfaceMuted:'#EBE7E1',surfaceSunken:'#E2DDD5',primary:'#1E2B6B',primaryPressed:'#182357',primaryTint:'#E7EAF6',onPrimary:'#FFFFFF',accent:'#7A5614',textPrimary:'#131720',textSecondary:'#464E60',textMuted:'#5A5F6C',border:'#D3CEC6',borderStrong:'#BDB6AA',success:'#1C7E45',warning:'#92660F',danger:'#C13B2E',info:'#2A79BE',overlay:'rgba(16, 20, 30, 0.46)'} as const;
export const darkColors={background:'#0B1030',surface:'#151C42',surfaceMuted:'#1E2755',surfaceSunken:'#0D1233',primary:'#8EA0E6',primaryPressed:'#7A8CD0',primaryTint:'#1F2A63',onPrimary:'#07122A',accent:'#D9B663',textPrimary:'#F2F4FF',textSecondary:'#C3CAEA',textMuted:'#9AA4CF',border:'#2A3470',borderStrong:'#3C4A8C',success:'#46CE86',warning:'#E1A94E',danger:'#F0736A',info:'#5FB2E6',overlay:'rgba(0, 0, 0, 0.66)'} as const;
// Low-light ("dim") mode: near-black warm ground (saves OLED battery), soft warm text, almost no blue light — easy on tired eyes at night.
export const dimColors={background:'#0B0A09',surface:'#15130F',surfaceMuted:'#1E1B16',surfaceSunken:'#0F0D0B',primary:'#D6A453',primaryPressed:'#BF8F44',primaryTint:'#2A2214',onPrimary:'#1A1204',accent:'#D6A453',textPrimary:'#DCD2C0',textSecondary:'#B3A898',textMuted:'#8A8172',border:'#2B2620',borderStrong:'#3A332A',success:'#86BC8E',warning:'#D9A64A',danger:'#E0796B',info:'#86A9C6',overlay:'rgba(0, 0, 0, 0.78)'} as const;
export type ThemeColors=typeof lightColors|typeof darkColors|typeof dimColors;
export type AppThemeMode='light'|'dark'|'dim';
export function getThemeColors(mode:AppThemeMode):ThemeColors{return mode==='dark'?darkColors:mode==='dim'?dimColors:lightColors;}
export const colors=lightColors;

// Ascending 4-pt-ish rhythm. `xxs`/`xs` are a deliberate alias (both 4) kept so call
// sites read intent ("hairline gap" vs "tight gap"); `mdPlus` (20) and `lgPlus` (40) are
// the two in-between steps. Order here is by value, not by name, on purpose.
export const spacing={xxs:4,xs:4,sm:8,smd:12,md:16,mdPlus:20,lg:24,xl:32,lgPlus:40,xxl:48} as const;
export const layout={compactHorizontal:16,regularHorizontal:24,contentMaxWidth:760,expandedNavWidth:104,compactNavHeight:76,minTouchTarget:48,iconButtonSize:48,snackbarMaxWidth:680,dialogMaxWidth:520,readableMaxWidth:420,feedbackZIndex:1000} as const;
export const breakpoints={compactWindow:600,mediumWindow:840,expandedNavigation:840,wideContent:900,largeWindow:1200} as const;
export type WindowSizeClass='compact'|'medium'|'expanded';
export function getWindowSizeClass(width:number):WindowSizeClass{return width<breakpoints.compactWindow?'compact':width<breakpoints.mediumWindow?'medium':'expanded';}

// Type scale — every token carries its own fontFamily so text never falls back to the
// system font. Screens may still add fontWeight; on Android the family wins, which is
// intentional (kills the "everything is 900" heaviness of the old build).
export const typography={
  // Line-heights carry a little extra headroom: Noto Sans Bengali sits taller than the
  // old face, and Bengali needs room above (ref/reph) and below (hasanta, ya-phala).
  label:{fontSize:12,lineHeight:17,letterSpacing:0.3,fontFamily:fonts.semibold},
  caption:{fontSize:12,lineHeight:18,fontFamily:fonts.medium},
  section:{fontSize:11,lineHeight:16,letterSpacing:0.4,fontFamily:fonts.semibold},
  meta:{fontSize:13,lineHeight:19,fontFamily:fonts.medium},
  input:{fontSize:15,lineHeight:23,fontFamily:fonts.regular},
  bodySmall:{fontSize:14,lineHeight:22,fontFamily:fonts.regular},
  body:{fontSize:15,lineHeight:24,fontFamily:fonts.regular},
  callout:{fontSize:14,lineHeight:21,fontFamily:fonts.medium},
  cardTitle:{fontSize:17,lineHeight:25,fontFamily:fonts.semibold},
  heading:{fontSize:20,lineHeight:28,fontFamily:fonts.semibold},
  dialogTitle:{fontSize:19,lineHeight:27,fontFamily:fonts.semibold},
  title:{fontSize:24,lineHeight:32,letterSpacing:-0.2,fontFamily:fonts.bold},
  titleLarge:{fontSize:27,lineHeight:36,letterSpacing:-0.3,fontFamily:fonts.bold},
  display:{fontSize:30,lineHeight:40,letterSpacing:-0.4,fontFamily:fonts.bold},
  numeric:{fontSize:15,lineHeight:20,fontFamily:fonts.numSemibold},
} as const;

export const radius={xs:6,sm:10,md:14,lg:18,xl:24,xxl:30,pill:999,chip:8,button:10,card:12,dialog:18,sheet:20} as const;
export const control={inputHeight:52,buttonHeight:48,rowMinHeight:64,iconSize:22,iconButtonSize:48,smallIconContainer:40,listIconContainer:44,searchHeight:54,textareaMinHeight:200,titleIconSize:48,previewCloseSize:48,chipHeight:36,heroBadge:96} as const;
export const icon={xs:16,sm:18,md:22,lg:28,xl:36} as const;
export const opacity={disabled:0.45,pressed:0.92,muted:0.64,overlay:0.36} as const;
export const border={thin:1,medium:2} as const;
export const motion={fast:120,standard:200,slow:300} as const;

// Elevation — hairline borders do the structural work; shadows stay subtle and are only
// meaningful on genuinely floating surfaces (dialog, snackbar, quick-capture, primary CTA).
export const elevation={
  soft:{shadowColor:'#131A2E',shadowOpacity:0.06,shadowRadius:10,shadowOffset:{width:0,height:2},elevation:1},
  card:{shadowColor:'#131A2E',shadowOpacity:0.09,shadowRadius:14,shadowOffset:{width:0,height:4},elevation:2},
  raised:{shadowColor:'#131A2E',shadowOpacity:0.12,shadowRadius:20,shadowOffset:{width:0,height:8},elevation:4},
  floating:{shadowColor:'#0B1220',shadowOpacity:0.13,shadowRadius:26,shadowOffset:{width:0,height:14},elevation:10},
} as const;

// ── Accent families ────────────────────────────────────────────────────────────────────
// Retuned to low-chroma, sophisticated hues (no candy). Same shape in both modes so
// `ThemeAccents` can be indexed safely. base → emphasis · soft → container tint ·
// on → readable text/icon on `soft` · border → gentle container border.
export const lightAccents={
  green:{base:'#1E874A',soft:'#DFF1E7',on:'#0F5E31',border:'#C4E4D1'},
  blue:{base:'#2A79BE',soft:'#E1EEF9',on:'#1C5992',border:'#C9E0F1'},
  orange:{base:'#B5691E',soft:'#F5E9DC',on:'#824A12',border:'#E8D7C1'},
  yellow:{base:'#B4832E',soft:'#F3ECDA',on:'#7C5A1E',border:'#E6DBBC'},
  red:{base:'#C13B2E',soft:'#F8E6E3',on:'#8E2A20',border:'#EDCFCB'},
  purple:{base:'#6455A6',soft:'#EBE9F5',on:'#463B79',border:'#D7D1EA'},
} as const;
export const darkAccents={
  green:{base:'#46CE86',soft:'#102A1E',on:'#BFEAD2',border:'#264C39'},
  blue:{base:'#5FB2E6',soft:'#0F2436',on:'#C6E2F6',border:'#264860'},
  orange:{base:'#E2A94E',soft:'#2C2416',on:'#F1D7A9',border:'#4C3F24'},
  yellow:{base:'#D9B663',soft:'#292317',on:'#EEE1B7',border:'#463F26'},
  red:{base:'#F0736A',soft:'#301C1A',on:'#F6C9C3',border:'#523330'},
  purple:{base:'#AB9AE2',soft:'#1E1B33',on:'#DCD3F3',border:'#3A2F5E'},
} as const;
export type AccentName=keyof typeof lightAccents;
export type AccentRole={base:string;soft:string;on:string;border:string};
export type ThemeAccents=typeof lightAccents|typeof darkAccents;
function warmDim(hex:string):string{const n=parseInt(hex.slice(1),16);const r=(n>>16)&255,g=(n>>8)&255,b=n&255;const k=0.78;const w=(v:number,t:number)=>Math.round(Math.min(255,(v*k)*0.85+t*0.15));return '#'+[w(r,216),w(g,176),w(b,128)].map((v)=>v.toString(16).padStart(2,'0')).join('');}
export const dimAccents=Object.fromEntries(Object.entries(darkAccents).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([kk,vv])=>[kk,typeof vv==='string'&&vv.startsWith('#')?warmDim(vv):vv]))])) as unknown as typeof darkAccents;
export function getThemeAccents(mode:AppThemeMode):ThemeAccents{return mode==='dark'?darkAccents:mode==='dim'?dimAccents:lightAccents;}
export const accents=lightAccents;

// ── Glass surfaces ─────────────────────────────────────────────────────────────────────
// Used ONLY on floating chrome (nav bar, dialog, snackbar) via expo-blur, always over an
// opaque scrim so text contrast never depends on what scrolls underneath. Never on
// content, editors, lists, or long-form text.
// `navSolid` is a near-opaque tinted surface for the Android bottom nav — it must never
// vanish or read as stark white (translucent Views over scrolling content can do both
// on aggressive OEMs). `navScrim` stays for the iOS BlurView's light tint.
export type GlassTokens={ tint:'light'|'dark'; intensity:number; scrim:string; navScrim:string; navSolid:string; dialog:string; border:string; highlight:string };
// Lower scrim so the blur is actually visible; a 1px top highlight sells the "glass" edge.
// navScrim is lighter still — the bottom bar reads as genuinely translucent, with the
// bumped BlurView intensity keeping labels legible over scrolling content.
// The bottom nav is intentionally the most translucent surface — a low scrim with a
// stronger blur so it reads as real glass while its solid-colour labels stay legible.
export const lightGlass:GlassTokens={ tint:'light', intensity:24, scrim:'rgba(255,255,255,0.56)', navScrim:'rgba(255,255,255,0.62)', navSolid:'rgba(255,255,255,0.96)', dialog:'rgba(255,255,255,0.80)', border:'rgba(19,23,32,0.08)', highlight:'rgba(255,255,255,0.5)' };
export const darkGlass:GlassTokens={ tint:'dark', intensity:28, scrim:'rgba(18,22,33,0.46)', navScrim:'rgba(21,28,66,0.62)', navSolid:'rgba(15,19,29,0.95)', dialog:'rgba(21,28,66,0.80)', border:'rgba(255,255,255,0.08)', highlight:'rgba(255,255,255,0.1)' };
export function getGlassTokens(mode:AppThemeMode):GlassTokens{return mode==='light'?lightGlass:darkGlass;}

// Gradient stop pairs (from→to) — plain colour arrays; stop [0] is a safe solid fallback.
// Both brand gradients now *start* on the logo's own navy, so the hero card and the logo
// above it are the same colour at the point where they meet. `heroBrand` still drifts
// (navy → royal → indigo → deep navy) rather than sitting flat: four near-identical blues
// read as a rendering glitch, and the drift is what makes the card look lit. White text
// stays AA-legible on every stop — the lightest, #3A4C9E, is ~5.6:1.
export const gradients={brand:['#1E2B6B','#35479B'],heroBrand:['#131C45','#1E2B6B','#35479B','#182357'],hero:['#F5F1EC','#EBE7E1'],sky:['#E1EEF9','#EBE9F5'],warmth:['#F3ECDA','#F5E9DC'],surfaceLight:['#FFFFFF','#F5F1EC'],surfaceDark:['#141A29','#0C1019']} as const;
export type GradientName=keyof typeof gradients;

// Domain → colour mappings, centralized so screens stop re-implementing them.
export type PriorityToken='URGENT'|'HIGH'|'MEDIUM'|'LOW';
export type MemoryKindToken='NOTE'|'FACT'|'PREFERENCE'|'EVENT'|'REFLECTION';
export function priorityColor(colors:ThemeColors,priority:PriorityToken):string{return priority==='URGENT'?colors.danger:priority==='HIGH'?colors.warning:priority==='LOW'?colors.textMuted:colors.primary;}
export function priorityAccentName(priority:PriorityToken):AccentName{return priority==='URGENT'?'red':priority==='HIGH'?'orange':priority==='MEDIUM'?'blue':'green';}
export function memoryKindAccentName(kind:MemoryKindToken):AccentName{return kind==='FACT'?'blue':kind==='PREFERENCE'?'purple':kind==='EVENT'?'orange':kind==='REFLECTION'?'yellow':'green';}
// One refined icon per memory kind — used EVERYWHERE a memory is shown, so the crude
// generic "brain" glyph never appears. `MemoryLike` accepts a nullable kind for the
// places (assistant answer sources, unified search) that don't carry one.
export type MemoryKindIcon='note-text-outline'|'lightbulb-on-outline'|'heart-outline'|'calendar-star'|'thought-bubble-outline'|'bookmark-outline';
export function memoryKindIcon(kind:MemoryKindToken|null|undefined):MemoryKindIcon{
  switch(kind){
    case 'FACT':return 'lightbulb-on-outline';
    case 'PREFERENCE':return 'heart-outline';
    case 'EVENT':return 'calendar-star';
    case 'REFLECTION':return 'thought-bubble-outline';
    case 'NOTE':return 'note-text-outline';
    default:return 'bookmark-outline';
  }
}
