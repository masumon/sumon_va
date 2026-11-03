import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

// A small home-screen widget: the app name and two buttons that deep-link straight into
// the task / memory editor. Rendering happens in a headless JS context (see
// widget-task-handler), so this component must stay self-contained — no hooks, no
// context, no data access of its own; `widget-task-handler` reads the app's actual theme
// and language from SQLite and passes them in as plain props instead.
//
// The scheme here has to be the app's own. It said `offlinememory://` while the app
// answers to `apon://`, so every tap fired an intent nothing on the phone could handle
// and the widget sat there looking broken. It is the app's identity, not a detail.
const SCHEME = 'apon';

// The same tokens `src/theme/index.ts` defines for `lightColors`/`darkColors`, plus a
// second gradient stop so the card reads as the same "navy card, gold accent" surface as
// the app's own Home header rather than a flat rectangle — this file cannot import that
// module (it pulls in React Native component code the RemoteViews renderer cannot host),
// so the handful of tokens this widget needs are restated here. F-096: these used to be
// the only choice, regardless of the app's own light/dark setting.
const LIGHT = { from: '#0C3C85', to: '#153E7A', surface: '#1B4BB0', gold: '#E8C15A', onBrand: '#FFFFFF', subtext: '#C7D6FF' } as const;
const DARK = { from: '#161C2B', to: '#0F1420', surface: '#1F2637', gold: '#D9B663', onBrand: '#EFF2FA', subtext: '#B2BBCD' } as const;

// A crisp, resolution-independent plus mark — the fullwidth "＋" character it replaces
// (F-096) did not match `AppIcon`'s stroke-based glyphs anywhere else in the app and read
// as a stray keyboard symbol rather than a button. Filled squarely inside a translucent
// disc so it reads as one glyph — a button's icon — rather than a lone mark floating in
// its own padding.
const plusSvg = (color: string, disc: string) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="11" fill="${disc}"/>
  <path d="M12 7v10M7 12h10" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>
</svg>`.trim();

// The app's own mark, not a Bengali letter — the earlier "আ" badge read fine when the
// app's language was Bengali and made no sense when it was set to English, on a surface
// that otherwise switches its wording correctly. A glyph has no language to disagree with.
const sparkSvg = (color: string) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M12 2c.8 5.4 1.8 7.8 7 9.2-5.2 1.4-6.2 3.8-7 9.2-.8-5.4-1.8-7.8-7-9.2 5.2-1.4 6.2-3.8 7-9.2Z" fill="${color}"/>
</svg>`.trim();

export interface QuickAddWidgetProps {
  language: 'bn' | 'en';
  dark: boolean;
}

export function QuickAddWidget({ language, dark }: QuickAddWidgetProps) {
  const bn = language === 'bn';
  const t = dark ? DARK : LIGHT;
  const copy = {
    tagline: bn ? 'যা কিছু আপনার' : 'Everything of yours',
    task: bn ? 'কাজ' : 'Task',
    memory: bn ? 'মেমোরি' : 'Memory',
  };

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundGradient: { from: t.from, to: t.to, orientation: 'TL_BR' },
        borderRadius: 20,
        padding: 10,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
      clickAction="OPEN_URI"
      clickActionData={{ uri: `${SCHEME}://` }}
    >
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        <FlexWidget style={{ width: 18, height: 18, marginRight: 6 }}>
          <SvgWidget svg={sparkSvg(t.gold)} style={{ width: 18, height: 18 }} />
        </FlexWidget>
        <FlexWidget style={{ flexDirection: 'column' }}>
          <TextWidget text="আপন" style={{ fontSize: 13, fontWeight: 'bold', color: t.gold }} />
          <TextWidget text={copy.tagline} style={{ fontSize: 9.5, color: t.subtext }} />
        </FlexWidget>
      </FlexWidget>
      {/* Each tile is one compact icon badge with its label riding just underneath the
          glyph, inside the same rounded tile — a smaller footprint than a wide icon+text
          pill row, and the icon still reads as the tile's dominant mark rather than a
          decoration next to a run of text. */}
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent' }}>
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: `${SCHEME}://task-editor` }}
          style={{ flex: 1, marginRight: 5, paddingVertical: 7, borderRadius: 14, backgroundColor: t.gold, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
        >
          <FlexWidget style={{ width: 16, height: 16, marginBottom: 2 }}>
            <SvgWidget svg={plusSvg('#07122A', 'rgba(7, 18, 42, 0.14)')} style={{ width: 16, height: 16 }} />
          </FlexWidget>
          <TextWidget text={copy.task} style={{ fontSize: 11, fontWeight: 'bold', color: '#07122A' }} />
        </FlexWidget>
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: `${SCHEME}://memory-editor` }}
          style={{ flex: 1, marginLeft: 5, paddingVertical: 7, borderRadius: 14, backgroundColor: t.surface, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
        >
          <FlexWidget style={{ width: 16, height: 16, marginBottom: 2 }}>
            <SvgWidget svg={plusSvg(t.onBrand, 'rgba(255, 255, 255, 0.16)')} style={{ width: 16, height: 16 }} />
          </FlexWidget>
          <TextWidget text={copy.memory} style={{ fontSize: 11, fontWeight: 'bold', color: t.onBrand }} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
