import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton, AppSectionHeader } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { Card, ChipGroup, EmptyNote, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { useAppPreferences } from '../src/app/AppPreferences';
import { formatBangladeshNumber } from '../src/i18n/date-time';
import { va, type Contact, type Task, errTone } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Page, Status } from '../src/va/Page';
import { ContactRow } from '../src/va/ContactRow';
import { StatTile, TileGrid } from '../src/va/StatTile';
import { MODULES } from '../src/va/modules';
import { PRESENCE } from '../src/va/labels';
import { getStatus, testAlert } from '../modules/va-bridge';

type Lens = 'personal' | 'business';
type HomeTab = 'urgent' | 'drafts' | 'tasks';
const FOR = [
  { k: '', bn: 'যতক্ষণ না বদলাই', en: 'Until changed', min: 0 },
  { k: '30', bn: '৩০ মিনিট', en: '30 min', min: 30 },
  { k: '60', bn: '১ ঘণ্টা', en: '1 hour', min: 60 },
  { k: '120', bn: '২ ঘণ্টা', en: '2 hours', min: 120 },
];

function greeting(bn: boolean): string {
  const h = new Date().getHours();
  return bn
    ? (h >= 20 || h < 5 ? 'শুভ রাত্রি' : h < 12 ? 'শুভ সকাল' : h < 16 ? 'শুভ দুপুর' : h < 18 ? 'শুভ বিকাল' : 'শুভ সন্ধ্যা')
    : (h >= 20 || h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
}

/** Executive Home Cockpit: 1-tap status & master switch in hero, 4 non-duplicate counters, AI omnibox, and 3 segmented action tabs. */
export default function DashboardScreen() {
  const { bn, accents, language, colors } = useKit();
  const { themeMode, design } = useAppPreferences();
  const { showSnackbar } = useAppFeedback();
  const [lens, setLens] = useState<Lens>('personal');
  const [homeTab, setHomeTab] = useState<HomeTab>('urgent');
  const [statusOpen, setStatusOpen] = useState(false);
  const overview = useLoad(() => va.overview(), 'overview', 20000);
  const family = useLoad(() => va.contacts('family'), 'family', 20000);
  const urgent = useLoad(() => va.contacts('urgent'), 'urgent', 20000);
  const drafts = useLoad(() => va.contacts('drafts'), 'drafts-home', 20000);
  const work = useLoad(() => va.contacts('work'), 'work', 20000);
  const biz = useLoad(() => va.business(), 'business', 30000);
  const tasks = useLoad(() => va.tasks('open'), 'tasks-open', 30000);
  const cfg = useLoad(() => va.assistantConfig(), 'assistant-config', 60000);
  const [busy, setBusy] = useState(false);
  const [forKey, setForKey] = useState('');
  const bridge = getStatus();
  const n = (v: number) => formatBangladeshNumber(v, language);
  const o = overview.data;
  const c = cfg.data?.config;
  const auto = o ? o.mode === 'auto' && o.enabled : false;
  const setupNeeded = !bridge.notificationAccess || !bridge.smsReceive || !bridge.phoneState || !bridge.batteryExempt || !bridge.fullScreen;
  const status = c?.statuses.find((s) => s.key === c.status.key);
  const rawName = (c?.owner_name || bridge.accountName || '').trim();
  const first = /^admin$/i.test(rawName) ? '' : rawName.split(' ')[0];
  const welcome = bn ? `${greeting(true)}${first ? `, ${first} ভাই` : ''}` : `${greeting(false)}${first ? `, ${first}` : ''}`;
  const summary = !o
    ? (bn ? 'আপনার বার্তাগুলো দেখে নিচ্ছি…' : 'Checking your messages…')
    : o.urgent > 0 || o.drafts > 0
      ? (bn ? `${n(o.urgent)}টি জরুরি বার্তা ও ${n(o.drafts)}টি খসড়া অপেক্ষায়` : `${o.urgent} urgent & ${o.drafts} drafts waiting`)
      : o.waiting > 0
        ? (bn ? `${n(o.waiting)}টি বার্তার উত্তর বাকি আছে` : `${o.waiting} messages need a reply`)
        : (bn ? 'এখন সব শান্ত। কারও উত্তর বাকি নেই ✓' : 'All quiet. Nobody is waiting ✓');
  const familyWaiting = (family.data?.items ?? []).filter((x) => x.unread > 0);
  const urgentCombined = [...familyWaiting, ...(urgent.data?.items ?? []).filter((x) => !x.is_family)];
  const draftItems = drafts.data?.items ?? [];
  const openTasks = tasks.data ?? [];
  const go = (href: string, params?: Record<string, string>) => router.push((params ? { pathname: href, params } : href) as never);

  const reloadAll = () => {
    void overview.reload();
    void family.reload();
    void urgent.reload();
    void drafts.reload();
    void work.reload();
    void biz.reload();
    void tasks.reload();
    void cfg.reload();
  };

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      await Promise.all([overview.reload(), cfg.reload(), drafts.reload(), tasks.reload(), urgent.reload()]);
      if (ok) showSnackbar(ok, 'success');
    } catch (e) {
      showSnackbar(e instanceof Error ? e.message : '', errTone(e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (key: string) => {
    const mins = FOR.find((f) => f.k === forKey)?.min ?? 0;
    setStatusOpen(false);
    void run(async () => {
      const until = key === 'free' || !mins ? null : new Date(Date.now() + mins * 60_000).toISOString();
      await va.saveAssistantConfig({ status: { key, until, custom: '' } });
    }, bn ? '✓ আপনার অবস্থা বদলানো হয়েছে' : '✓ Status updated');
  };

  const heroGrad = design.heroGrad;
  const heroInk = themeMode === 'dim' ? colors.textPrimary : '#FFFFFF';
  const heroSoft = themeMode === 'dim' ? colors.textSecondary : 'rgba(255,255,255,0.92)';

  return (
    <Page
      title={bn ? 'হোম' : 'Home'}
      hideHeader
      onRefresh={reloadAll}
      refreshing={!!o && (overview.loading || family.loading || urgent.loading || drafts.loading || tasks.loading)}
    >
      <Status loading={overview.loading && !o} error={o ? null : overview.error} onRetry={overview.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />

      {/* 1. All-in-One Executive Hero Cockpit */}
      <LinearGradient colors={heroGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: design.radiusHero, padding: 14, gap: 10 }, design.heroShadow ?? undefined]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: heroSoft, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>
              {c?.custom_roles?.find((r) => r.id === c.active_role)?.name || (bn ? 'ব্যক্তিগত সহকারী' : 'Personal Assistant')}
            </Text>
            <Text style={{ color: heroInk, fontSize: 19, fontWeight: '800', marginTop: 2 }}>{welcome}</Text>
            <Text style={{ color: heroSoft, fontSize: 12.5, marginTop: 2 }}>{summary}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => go('/f0')}
                style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center' }}
              >
                <Text style={{ color: '#0F172A', fontSize: 12, fontWeight: '800' }}>{bn ? '🎤 সহকারীকে বলুন' : '🎤 Voice AI'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void run(() => va.sendOwnerReport(), bn ? '✓ রিপোর্ট ২য় WhatsApp-এ পাঠানো হয়েছে' : '✓ Report sent')}
                style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center' }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{bn ? '📊 ২য় WA রিপোর্ট' : '📊 2nd WA Report'}</Text>
              </Pressable>
            </View>
          </View>
          {/* 1-Tap Live Status Dropdown Pill right in the Hero */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'অবস্থা ও সুইচ বদলান' : 'Change status and switches'}
            onPress={() => setStatusOpen((v) => !v)}
            style={{
              paddingHorizontal: 11,
              paddingVertical: 7,
              borderRadius: 12,
              backgroundColor: 'rgba(0,0,0,0.28)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.25)',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>
              ⏱ {status?.label ?? (bn ? 'ফ্রি আছি' : 'Free')} {statusOpen ? '▴' : '▾'}
            </Text>
          </Pressable>
        </View>

        {/* Expandable 1-Tap Status & Master Switch Drawer inside Hero */}
        {statusOpen ? (
          <View style={{ padding: 10, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.38)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', gap: 8 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 11.5, fontWeight: '700' }}>
              {bn ? '১ ট্যাপে আপনার বর্তমান অবস্থা বদলান (সহকারী সবাইকে এটাই বলবে):' : 'Change your current status in 1 tap:'}
            </Text>
            {c ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {c.statuses.map((s) => {
                  const active = c.status.key === s.key;
                  return (
                    <Pressable
                      key={s.key}
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => setStatus(s.key)}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 10,
                        backgroundColor: active ? '#FFFFFF' : 'rgba(255,255,255,0.16)',
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '800', color: active ? '#0F172A' : '#FFFFFF' }}>
                        {active ? '✓ ' : ''}{s.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {FOR.map((f) => {
                const on = forKey === f.k;
                return (
                  <Pressable
                    key={f.k}
                    accessibilityRole="button"
                    onPress={() => setForKey(f.k)}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 8,
                      backgroundColor: on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.12)',
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '700', color: on ? '#0F172A' : '#FFFFFF' }}>
                      {bn ? f.bn : f.en}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {o ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.16)', gap: 8 }}>
                <Text style={{ color: '#FFFFFF', fontSize: 11.5, fontWeight: '700' }}>{bn ? 'মাস্টার নিয়ন্ত্রণ:' : 'Master controls:'}</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: o.enabled }}
                    disabled={busy}
                    onPress={() => void run(() => va.saveAssistantConfig({ enabled: !o.enabled }), !o.enabled ? (bn ? '✓ সহকারী চালু হয়েছে' : '✓ Assistant on') : (bn ? 'সহকারী বন্ধ করা হয়েছে' : 'Assistant off'))}
                    style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: o.enabled ? '#10B981' : '#F43F5E' }}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 11.5, fontWeight: '800' }}>
                      {o.enabled ? (bn ? '● সহকারী চালু' : '● On') : (bn ? '○ বন্ধ' : '○ Off')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: auto }}
                    disabled={busy}
                    onPress={() => void run(async () => {
                      if (!auto && !o.enabled) await va.saveAssistantConfig({ enabled: true });
                      await va.killSwitch(auto);
                    }, !auto ? (bn ? '✓ অটো-উত্তর চালু' : '✓ Auto-reply on') : (bn ? 'শুধু খসড়া মোড চালু' : 'Drafts only'))}
                    style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: auto ? '#FFFFFF' : 'rgba(255,255,255,0.2)' }}
                  >
                    <Text style={{ color: auto ? '#0F172A' : '#FFFFFF', fontSize: 11.5, fontWeight: '800' }}>
                      {auto ? (bn ? '⚡ অটো-উত্তর' : '⚡ Auto') : (bn ? '✍ শুধু খসড়া' : '✍ Drafts')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* 4 Non-Duplicate Actionable Counter Boxes */}
        {o ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${bn ? 'জরুরি' : 'Urgent'}: ${n(o.urgent)}`}
              onPress={() => go('/inbox', { view: 'urgent' })}
              style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center' }}
            >
              <Text style={{ color: '#FDA4AF', fontSize: 18, fontWeight: '800' }}>{n(o.urgent)}</Text>
              <Text style={{ color: heroSoft, fontSize: 11, fontWeight: '600' }}>{bn ? 'জরুরি' : 'Urgent'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${bn ? 'উত্তর বাকি' : 'Waiting'}: ${n(o.waiting)}`}
              onPress={() => go('/inbox', { view: 'waiting' })}
              style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center' }}
            >
              <Text style={{ color: heroInk, fontSize: 18, fontWeight: '800' }}>{n(o.waiting)}</Text>
              <Text style={{ color: heroSoft, fontSize: 11, fontWeight: '600' }}>{bn ? 'উত্তর বাকি' : 'Waiting'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${bn ? 'খসড়া রেডি' : 'Drafts'}: ${n(o.drafts)}`}
              onPress={() => setHomeTab('drafts')}
              style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center' }}
            >
              <Text style={{ color: '#FDE68A', fontSize: 18, fontWeight: '800' }}>{n(o.drafts)}</Text>
              <Text style={{ color: heroSoft, fontSize: 11, fontWeight: '600' }}>{bn ? 'খসড়া রেডি' : 'Drafts'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${bn ? 'বাকি কাজ' : 'Tasks'}: ${n(o.tasks_open)}`}
              onPress={() => setHomeTab('tasks')}
              style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center' }}
            >
              <Text style={{ color: '#A7F3D0', fontSize: 18, fontWeight: '800' }}>{n(o.tasks_open)}</Text>
              <Text style={{ color: heroSoft, fontSize: 11, fontWeight: '600' }}>{bn ? 'বাকি কাজ' : 'Tasks'}</Text>
            </Pressable>
          </View>
        ) : null}
      </LinearGradient>

      {setupNeeded ? (
        <Card icon="shield-alert-outline" title={bn ? 'অনুমতি বাকি আছে' : 'Permissions needed'}>
          <Text style={{ marginBottom: 8 }}>{bn ? 'ফোনের কিছু অনুমতি দেওয়া হয়নি, তাই সব বার্তা বা কল আসছে না।' : 'Some phone permissions are missing.'}</Text>
          <AppButton label={bn ? 'এখনই ঠিক করুন' : 'Fix permissions'} icon="shield-check-outline" onPress={() => go('/setup')} />
        </Card>
      ) : null}

      {/* 2. Home AI Secretary Omnibox */}
      <View style={{ padding: 10, borderRadius: design.radiusCard, borderWidth: 1, borderColor: design.cardBorder, backgroundColor: colors.surface, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'সহকারীকে বলুন বা প্রশ্ন করুন' : 'Ask the assistant'}
            onPress={() => go('/f0')}
            style={{ flex: 1, minHeight: 40, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <AppIcon name="auto-fix" size={18} color={colors.primary} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: colors.textSecondary }}>
              {bn ? 'সহকারীকে বলুন বা ভয়েস/ছবি/ভিডিও দিন…' : 'Ask assistant or share voice/photo/video…'}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'ভয়েস বিশ্লেষণ' : 'Voice analysis'} onPress={() => go('/f0', { pick: 'audio' })}
            style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name="microphone-outline" size={19} color={colors.primary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'ছবি বা রসিদ বিশ্লেষণ' : 'Photo analysis'} onPress={() => go('/f0', { pick: 'image' })}
            style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name="image-outline" size={19} color={colors.primary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'ভিডিও বিশ্লেষণ' : 'Video analysis'} onPress={() => go('/f0', { pick: 'video' })}
            style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name="video-outline" size={19} color={colors.primary} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {[
            { bn: '📞 মিসড কল', en: '📞 Missed calls', cmd: 'মিসড কল' },
            { bn: '⏳ কার উত্তর বাকি', en: '⏳ Who is waiting', cmd: 'কার উত্তর বাকি' },
            { bn: '📋 আমার কাজ', en: '📋 My tasks', cmd: 'আমার কাজ' },
            { bn: '🚨 জরুরি', en: '🚨 Urgent', cmd: 'জরুরি' },
          ].map((q) => (
            <Pressable
              key={q.cmd}
              accessibilityRole="button"
              onPress={() => go('/f0', { cmd: q.cmd })}
              style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.surfaceMuted }}
            >
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.textPrimary }}>{bn ? q.bn : q.en}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {o?.alerts_held && o.alerts_held.count > 0 ? (
        <Card icon="bell-sleep-outline" title={bn ? 'আটকে থাকা অ্যালার্ট' : 'Held-back alerts'}>
          <Text>{bn ? `${n(o.alerts_held.count)}টি জরুরি অ্যালার্ট নীরব সময় বা দৈনিক সীমার কারণে আটকে ছিল (হারায়নি)।` : `${o.alerts_held.count} urgent alert(s) were held back.`}</Text>
          <Text style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>{[...new Set(o.alerts_held.items.map((i) => i.who))].join(', ')}</Text>
          <View style={{ marginTop: 8 }}><AppButton variant="secondary" label={bn ? 'জরুরিগুলো দেখুন' : 'See urgent'} onPress={() => go('/inbox', { view: 'urgent' })} /></View>
        </Card>
      ) : null}

      {/* 3. Segmented 3-Tab Home Action Feed */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          { k: 'urgent' as HomeTab, bn: `🚨 জরুরি (${n(urgentCombined.length)})`, en: `🚨 Urgent (${urgentCombined.length})` },
          { k: 'drafts' as HomeTab, bn: `✍ খসড়া (${n(o?.drafts ?? draftItems.length)})`, en: `✍ Drafts (${o?.drafts ?? draftItems.length})` },
          { k: 'tasks' as HomeTab, bn: `✅ কাজ (${n(openTasks.length)})`, en: `✅ Tasks (${openTasks.length})` },
        ].map((t) => {
          const active = homeTab === t.k;
          return (
            <Pressable
              key={t.k}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setHomeTab(t.k)}
              style={{
                flex: 1,
                minHeight: 40,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.primary : colors.surface,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '800', color: active ? colors.onPrimary : colors.textPrimary }}>
                {bn ? t.bn : t.en}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Tab 1: Urgent & Family (+ Personal/Business lens) */}
      {homeTab === 'urgent' ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <ChipGroup<Lens>
              options={['personal', 'business']}
              value={lens}
              labelOf={(l) => (l === 'personal' ? (bn ? 'পরিবার ও জরুরি' : 'Family & Urgent') : (bn ? 'ব্যবসায়িক খোঁজ' : 'Business'))}
              onChange={(l) => { if (l) setLens(l); }}
            />
            <Pressable accessibilityRole="button" onPress={() => go('/inbox', { view: lens === 'personal' ? 'urgent' : 'work' })}>
              <Text style={{ fontSize: 12.5, fontWeight: '800', color: colors.primary }}>{bn ? 'সব দেখুন ›' : 'See all ›'}</Text>
            </Pressable>
          </View>
          {lens === 'personal' ? (
            <>
              {urgentCombined.length === 0 ? (
                <EmptyNote icon="check-circle-outline" text={bn ? 'পরিবারের বা জরুরি কোনো বার্তা বাকি নেই ✓' : 'No family or urgent messages waiting ✓'} />
              ) : (
                <View style={{ gap: 8 }}>
                  {urgentCombined.slice(0, 5).map((x: Contact) => (
                    <ContactRow key={x.id} contact={x} onPress={() => go('/contact', { id: x.id })} onChanged={reloadAll} />
                  ))}
                </View>
              )}
            </>
          ) : (
            <>
              {biz.data?.available ? (
                <TileGrid>
                  <StatTile icon="cart-outline" label={bn ? 'বাকি অর্ডার' : 'Orders'} value={n(biz.data?.pending_orders ?? 0)} tone={biz.data?.pending_orders ? accents.orange : undefined} />
                  <StatTile icon="briefcase-outline" label={bn ? 'বাকি বুকিং' : 'Bookings'} value={n(biz.data?.pending_bookings ?? 0)} tone={biz.data?.pending_bookings ? accents.orange : undefined} />
                  <StatTile icon="account-star-outline" label={bn ? 'নতুন লিড' : 'New leads'} value={n(biz.data?.new_leads ?? 0)} tone={biz.data?.new_leads ? accents.green : undefined} onPress={() => go('/inbox', { view: 'work' })} />
                  <StatTile icon="file-account-outline" label={bn ? 'আবেদন' : 'Applications'} value={n(biz.data?.new_applications ?? 0)} />
                </TileGrid>
              ) : null}
              {(work.data?.items ?? []).length === 0 ? (
                <EmptyNote icon="briefcase-check-outline" text={bn ? 'নতুন কাজের খোঁজ নেই' : 'No new work enquiries'} />
              ) : (
                <View style={{ gap: 8 }}>
                  {(work.data?.items ?? []).slice(0, 5).map((x: Contact) => (
                    <ContactRow key={x.id} contact={x} onPress={() => go('/contact', { id: x.id })} onChanged={reloadAll} />
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      ) : null}

      {/* Tab 2: 1-Tap Draft Approval directly from Home */}
      {homeTab === 'drafts' ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: colors.textPrimary }}>
              {bn ? 'সহকারীর তৈরি খসড়া (১ ট্যাপে পাঠান)' : 'Ready drafts (send in 1 tap)'}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => go('/inbox', { view: 'drafts' })}>
              <Text style={{ fontSize: 12.5, fontWeight: '800', color: colors.primary }}>{bn ? 'ইনবক্সে খুলুন ›' : 'Open in Inbox ›'}</Text>
            </Pressable>
          </View>
          {draftItems.length === 0 ? (
            <EmptyNote icon="check-circle-outline" text={bn ? 'কোনো খসড়া অপেক্ষায় নেই ✓' : 'No drafts waiting ✓'} />
          ) : (
            draftItems.slice(0, 6).map((x: Contact) => (
              <ContactRow key={x.id} contact={x} onPress={() => go('/contact', { id: x.id })} onChanged={reloadAll} />
            ))
          )}
        </View>
      ) : null}

      {/* Tab 3: Open & Proposed Tasks + Connected Apps */}
      {homeTab === 'tasks' ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: colors.textPrimary }}>
              {bn ? 'আজকের ও প্রস্তাবিত কাজ' : 'Open & proposed tasks'}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => go('/tasks')}>
              <Text style={{ fontSize: 12.5, fontWeight: '800', color: colors.primary }}>{bn ? 'সব কাজ ›' : 'All tasks ›'}</Text>
            </Pressable>
          </View>
          {openTasks.length === 0 ? (
            <EmptyNote icon="check-all" text={bn ? 'কোনো কাজ বাকি নেই ✓' : 'No open tasks ✓'} />
          ) : (
            openTasks.slice(0, 6).map((t: Task) => (
              <View
                key={t.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                }}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <View style={{ paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 6, backgroundColor: t.proposed ? 'rgba(245,158,11,0.18)' : 'rgba(16,185,129,0.18)' }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: t.proposed ? colors.warning : colors.success }}>
                        {t.proposed ? (bn ? 'প্রস্তাবিত' : 'Proposed') : (bn ? 'নিশ্চিত' : 'Confirmed')}
                      </Text>
                    </View>
                    {t.contact_name || t.contact_phone ? (
                      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 11.5, color: colors.textMuted }}>{t.contact_name || t.contact_phone}</Text>
                    ) : null}
                  </View>
                  <Text style={{ fontWeight: '700', fontSize: 13.5, color: colors.textPrimary }}>{t.title}</Text>
                </View>
                {t.proposed ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void run(() => va.confirmTask(t.id), bn ? '✓ কাজটি নিশ্চিত করা হয়েছে' : '✓ Task confirmed')}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.primary }}
                  >
                    <Text style={{ fontSize: 11.5, fontWeight: '800', color: colors.onPrimary }}>{bn ? '✓ নিশ্চিত' : '✓ Confirm'}</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void run(() => va.toggleTask(t.id), bn ? '✓ কাজটি সম্পন্ন হয়েছে' : '✓ Task done')}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.surfaceMuted }}
                  >
                    <Text style={{ fontSize: 11.5, fontWeight: '800', color: colors.textPrimary }}>{bn ? '✓ শেষ' : '✓ Done'}</Text>
                  </Pressable>
                )}
              </View>
            ))
          )}
        </View>
      ) : null}

      {/* Compact Live Sensor & Second WhatsApp Relay Status Bar */}
      <Pressable
        accessibilityRole="button"
        onPress={() => go('/rules')}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 14,
          backgroundColor: colors.surfaceMuted,
          borderWidth: 1,
          borderColor: colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: colors.textSecondary }}>
          📱 {bn ? `সেন্সর খসড়া: ${(c?.presence_draft_when_active ?? true) ? 'চালু ✓' : 'বন্ধ'} · কল উত্তর: ${(c?.call_tactical_reply ?? true) ? 'চালু ✓' : 'বন্ধ'}` : 'Sensor & call tactical active'}
          {o?.presence && o.presence.state !== 'unknown' ? ` · ${bn ? PRESENCE[o.presence.state].bn : PRESENCE[o.presence.state].en}` : ''}
        </Text>
        <Text style={{ fontSize: 11.5, fontWeight: '800', color: colors.primary }}>
          {c?.owner_whatsapp ? `২য় WA: ${c.owner_whatsapp}` : (bn ? '২য় WA সেট করুন ›' : 'Set 2nd WA ›')}
        </Text>
      </Pressable>

      {/* Quick Shortcuts & Apps */}
      <AppSectionHeader title={bn ? 'দ্রুত কাজ ও সংযুক্ত অ্যাপ' : 'Quick actions & apps'} actionLabel={bn ? 'সব অ্যাপ' : 'All apps'} onAction={() => go('/channels')} />
      <TileGrid>
        <StatTile icon="plus-circle-outline" label={bn ? 'নতুন কাজ যোগ' : 'Add a task'} value={bn ? 'নতুন' : 'New'} onPress={() => go('/tasks')} />
        <StatTile icon="brain" label={bn ? 'AI সংযোগ' : 'AI connections'} value={bn ? 'খুলুন' : 'Open'} onPress={() => go('/ai')} />
        <StatTile icon="bell-ring-outline" label={bn ? 'জরুরি অ্যালার্ম পরীক্ষা' : 'Test urgent alarm'} value={bn ? 'বাজান' : 'Play'} onPress={() => { testAlert(); showSnackbar(bn ? 'অ্যালার্ম বাজানো হয়েছে' : 'Alarm sent', 'info'); }} />
        <StatTile icon="robot-outline" label={bn ? 'সহকারীর নিয়ম' : 'Assistant rules'} value={bn ? 'দেখুন' : 'View'} onPress={() => go('/rules')} />
        {MODULES.slice(0, 4).map((m) => <StatTile key={m.key} icon={m.icon} label={bn ? m.bn : m.en} value="›" onPress={() => go('/m/[key]', { key: m.key })} />)}
      </TileGrid>
    </Page>
  );
}
