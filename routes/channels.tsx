import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { useKit } from '../src/ui/AppKit';
import { formatBangladeshNumber } from '../src/i18n/date-time';
import { va } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero, HeroStat } from '../src/va/Hero';
import { Page } from '../src/va/Page';
import { MODULES } from '../src/va/modules';
import { BrandLogo } from '../src/va/BrandLogo';
import { getStatus } from '../modules/va-bridge';

/** The modules overview: one card per way people reach you, with its own waiting/urgent counts. Tap to open that module. */
export default function ModulesScreen() {
  const { bn, colors, language } = useKit();
  const n = (v: number) => formatBangladeshNumber(v, language);
  const overview = useLoad(() => va.overview(), 'overview', 20000);
  // One small request per module for its own counts (cheap: the server only counts).
  const counts = useLoad(async () => Promise.all(MODULES.map(async (m) => {
    const [w, u] = await Promise.all([va.contacts('waiting', '', 1, m.sources), va.contacts('urgent', '', 1, m.sources)]);
    return { key: m.key, waiting: w.total, urgent: u.total };
  })), 'module-counts', 25000);
  const watched = new Set(getStatus().packages);
  const by = new Map((counts.data ?? []).map((c) => [c.key, c]));

  return (
    <Page title={bn ? 'মডিউল' : 'Modules'} subtitle={bn ? 'প্রতিটি মাধ্যম আলাদা — কোন নম্বর বা কে পাঠিয়েছে দেখা যায়' : 'Each channel apart — see which number or who wrote'} onRefresh={() => { void counts.reload(); void overview.reload(); }} refreshing={counts.loading && !!counts.data}>
      <Hero icon="apps" title={bn ? 'সব মাধ্যম' : 'All channels'} subtitle={bn ? 'একটা মডিউল খুলে তার নিজস্ব সেটিং ও মানুষজন দেখুন' : 'Open a module for its own settings and people'}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <HeroStat value={n(overview.data?.waiting ?? 0)} label={bn ? 'উত্তর বাকি' : 'Waiting'} />
          <HeroStat value={n(overview.data?.urgent ?? 0)} label={bn ? 'জরুরি' : 'Urgent'} />
          <HeroStat value={n(overview.data?.drafts ?? 0)} label={bn ? 'খসড়া' : 'Drafts'} />
        </View>
      </Hero>

      {MODULES.map((m) => {
        const c = by.get(m.key);
        const live = m.apps ? m.apps.some((a) => watched.has(a.pkg)) || m.sources.includes('whatsapp') : m.key === 'sms' ? getStatus().smsReceive : true;
        return (
          <Pressable key={m.key} accessibilityRole="button" onPress={() => router.push({ pathname: '/m/[key]', params: { key: m.key } } as never)}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, pressed && { opacity: 0.92 }]}>
            <BrandLogo brand={m.brand} size={48} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontWeight: '700', fontSize: 16 }}>{bn ? m.bn : m.en}</Text>
              <Text numberOfLines={1} style={{ opacity: 0.65, fontSize: 12 }}>{bn ? m.hintBn : m.hintEn}</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <AppBadge tone={live ? 'success' : 'warning'} label={live ? (bn ? 'চালু' : 'On') : (bn ? 'অ্যাপ বন্ধ' : 'App off')} />
                {c && c.urgent ? <AppBadge tone="danger" label={bn ? `${n(c.urgent)} জরুরি` : `${c.urgent} urgent`} /> : null}
                {c && c.waiting ? <AppBadge tone="warning" label={bn ? `${n(c.waiting)} বাকি` : `${c.waiting} waiting`} /> : null}
                <AppBadge tone={m.auto === 'none' ? 'neutral' : 'primary'} label={m.auto === 'none' ? (bn ? 'শুধু খসড়া' : 'Drafts only') : (bn ? 'অটো-উত্তর সম্ভব' : 'Can auto-reply')} />
              </View>
            </View>
            <AppIcon name="chevron-right" size={22} color={colors.textMuted} />
          </Pressable>
        );
      })}
    </Page>
  );
}
