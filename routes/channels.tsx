import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { Card, ChipGroup, useKit } from '../src/ui/AppKit';
import { ConnectGuide } from '../src/va/ConnectGuide';
import { formatBangladeshNumber } from '../src/i18n/date-time';
import { va } from '../src/va/api';
import { useLoad, useAppActive } from '../src/va/hooks';
import { Hero, HeroStat } from '../src/va/Hero';
import { Page } from '../src/va/Page';
import { MODULES, notOnPhone } from '../src/va/modules';
import { BrandLogo } from '../src/va/BrandLogo';
import { getStatus, isInstalled } from '../modules/va-bridge';
import { computeChecks, verdict } from '../src/va/connect';

/** The modules overview: one card per way people reach you, with its own waiting/urgent counts. Tap to open that module. */
export default function ModulesScreen() {
  const { bn, colors, language } = useKit();
  const n = (v: number) => formatBangladeshNumber(v, language);
  const overview = useLoad(() => va.overview(), 'overview', 20000);
  // One small request per module for its own counts (cheap: the server only counts).
  const counts = useLoad(async () => Promise.all(MODULES.map(async (m) => {
    const [w, u] = await Promise.all([va.contacts('waiting', '', 1, m.sources), va.contacts('urgent', '', 1, m.sources)]);
    const all = await va.contacts('all', '', 1, m.sources);
    return { key: m.key, waiting: w.total, urgent: u.total, total: all.total };
  })), 'module-counts', 60000); // 30 small requests: once a minute is plenty (new messages also refresh it at once)
  const chans = useLoad(() => va.channels(), 'channels', 30000);
  const active = useAppActive(); // asked again every time the app comes back, so installing/removing an app shows at once
  const missing = useMemo(() => (active ? notOnPhone(MODULES, isInstalled) : new Set<string>()), [active]);
  const [pick, setPick] = useState<string | null>(null);
  const by = new Map((counts.data ?? []).map((c) => [c.key, c]));

  return (
    <Page title={bn ? 'আমার অ্যাপগুলো' : 'My apps'} subtitle={bn ? 'প্রতিটি মাধ্যম আলাদা। কোন নম্বর বা কে পাঠিয়েছে, দেখা যায়' : 'Each channel apart — see which number or who wrote'} onRefresh={() => { void counts.reload(); void overview.reload(); }} refreshing={counts.loading && !!counts.data}>
      <Hero icon="apps" title={bn ? 'আমার অ্যাপগুলো' : 'My apps'} subtitle={bn ? 'যে অ্যাপ যুক্ত, সেটা ওপরে; নতুন অ্যাপ নিচ থেকে যুক্ত করুন' : 'Connected apps on top; connect more below'}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <HeroStat value={n(overview.data?.waiting ?? 0)} label={bn ? 'উত্তর বাকি' : 'Waiting'} />
          <HeroStat value={n(overview.data?.urgent ?? 0)} label={bn ? 'জরুরি' : 'Urgent'} />
          <HeroStat value={n(overview.data?.drafts ?? 0)} label={bn ? 'খসড়া' : 'Drafts'} />
        </View>
      </Hero>

      {(() => {
        // Like the AI keys page: what is connected comes first, with its state; everything else is offered below to connect.
        const rows = MODULES.map((m) => {
          const c = by.get(m.key);
          const vd = verdict(computeChecks(m, { bridge: getStatus(), channels: chans.data ?? null, received: c ? c.total : 0, installed: isInstalled }));
          return { m, c, vd };
        });
        const on = rows.filter((r) => r.vd !== 'off');
        const off = rows.filter((r) => r.vd === 'off').sort((a, b) => Number(missing.has(a.m.key)) - Number(missing.has(b.m.key)));
        const row = ({ m, c, vd }: (typeof rows)[number], add: boolean) => (
          <Pressable key={m.key} accessibilityRole="button" accessibilityLabel={(bn ? m.bn : m.en) + (add ? (bn ? ', যুক্ত করুন' : ', connect') : '')}
            onPress={() => router.push({ pathname: '/m/[key]', params: { key: m.key } } as never)}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, minHeight: 64 }, pressed && { opacity: 0.92 }]}>
            <BrandLogo brand={m.brand} size={add ? 40 : 48} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontWeight: '600', fontSize: 16 }}>{bn ? m.bn : m.en}</Text>
              <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 13 }}>{bn ? m.hintBn : m.hintEn}</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                {add ? (
                  <AppBadge tone="neutral" label={missing.has(m.key) ? (bn ? 'ফোনে নেই' : 'Not on this phone') : (bn ? 'চাপুন: কীভাবে যুক্ত করবেন' : 'Tap: how to connect')} />
                ) : !counts.data ? <AppBadge tone="neutral" label={bn ? 'দেখছি…' : 'Checking…'} /> : (
                  <AppBadge tone={vd === 'ok' ? 'success' : 'warning'} label={vd === 'ok' ? (bn ? 'চলছে ✓' : 'Working ✓') : (bn ? 'যুক্ত, এখনো বার্তা আসেনি' : 'Connected, no message yet')} />
                )}
                {!add && c && c.urgent ? <AppBadge tone="danger" label={bn ? `${n(c.urgent)} জরুরি` : `${c.urgent} urgent`} /> : null}
                {!add && c && c.waiting ? <AppBadge tone="warning" label={bn ? `${n(c.waiting)} বাকি` : `${c.waiting} waiting`} /> : null}
              </View>
            </View>
            <AppIcon name={add ? 'plus-circle-outline' : 'chevron-right'} size={22} color={colors.textMuted} />
          </Pressable>
        );
        return (
          <>
            <Text style={{ fontWeight: '600', fontSize: 17, marginTop: 4 }}>{bn ? `যুক্ত অ্যাপ (${n(on.length)})` : `Connected apps (${on.length})`}</Text>
            {on.length ? on.map((r) => row(r, false)) : <Text style={{ color: colors.textSecondary }}>{bn ? 'এখনো কোনো অ্যাপ যুক্ত হয়নি। নিচ থেকে একটা বাছুন।' : 'No app connected yet. Pick one below.'}</Text>}
            {off.length ? (
              <Card title={bn ? 'নতুন অ্যাপ যুক্ত করুন' : 'Connect another app'}>
                <Text style={{ color: colors.textSecondary, marginBottom: 8 }}>{bn ? 'কোন অ্যাপ যুক্ত করবেন, বাছুন: ধাপে ধাপে নির্দেশনা আসবে। যুক্ত হয়ে গেলে অ্যাপটা ওপরের তালিকায় চলে যাবে।' : 'Pick an app: step-by-step guidance follows. Once connected it moves to the list above.'}</Text>
                <ChipGroup<string> options={off.map((r) => r.m.key)} value={pick} labelOf={(k) => { const m = MODULES.find((x) => x.key === k); return (m ? (bn ? m.bn : m.en) : k) + (missing.has(k) ? (bn ? ' (ফোনে নেই)' : ' (not on phone)') : ''); }} onChange={(k) => setPick(k ?? null)} />
                {(() => {
                  const r = off.find((x) => x.m.key === pick);
                  return r ? (
                    <View style={{ marginTop: 12, gap: 10 }}>
                      <ConnectGuide mod={r.m} channels={chans.data ?? null} received={r.c ? r.c.total : 0} onTested={() => { void counts.reload(); void chans.reload(); }} />
                      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/m/[key]', params: { key: r.m.key } } as never)} style={{ minHeight: 48, justifyContent: 'center' }}>
                        <Text style={{ color: colors.primary, fontWeight: '600' }}>{bn ? `${r.m.bn}-এর পুরো পাতা খুলুন ›` : `Open the ${r.m.en} page ›`}</Text>
                      </Pressable>
                    </View>
                  ) : null;
                })()}
              </Card>
            ) : null}
          </>
        );
      })()}
    </Page>
  );
}
