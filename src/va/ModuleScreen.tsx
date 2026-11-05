import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../ui/AppText';
import { AppButton } from '../ui/AppSurface';
import { Card, ChipGroup, EmptyNote, Field, ToggleRow, useKit } from '../ui/AppKit';
import { useAppFeedback } from '../ui/AppFeedback';
import { formatBangladeshNumber } from '../i18n/date-time';
import { getStatus, isInstalled, setPackages } from '../../modules/va-bridge';
import { computeChecks, verdict } from './connect';
import { va, type ChannelsInfo, type Contact, type View as InboxView, errTone } from './api';
import { useLoad } from './hooks';
import { Hero, HeroStat } from './Hero';
import { BrandLogo } from './BrandLogo';
import { Page, Status } from './Page';
import { ContactRow } from './ContactRow';
import type { ModuleDef } from './modules';
import { PlatformSettings } from './PlatformSettings';
import { ConnectGuide } from './ConnectGuide';
import { EmailFilterCard } from './EmailFilterCard';

/** Last known answers, kept while the app runs, so a page never flips back to "not connected" while it re-checks. */
const LAST_RECEIVED = new Map<string, number>();
const LAST: { channels: ChannelsInfo | null } = { channels: null };

const VIEWS: { key: InboxView; bn: string; en: string }[] = [
  { key: 'all', bn: 'সবাই', en: 'Everyone' }, { key: 'urgent', bn: 'জরুরি', en: 'Urgent' }, { key: 'waiting', bn: 'উত্তর বাকি', en: 'Waiting' },
  { key: 'drafts', bn: 'খসড়া', en: 'Drafts' }, { key: 'family', bn: 'পরিবার', en: 'Family' },
];

/** One module (WhatsApp, Messenger, Telegram, SMS…): its own summary, its own auto-reply switch, and only its own people with their numbers. */
export function ModuleScreen({ mod }: { mod: ModuleDef }) {
  const { bn, language } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [view, setView] = useState<InboxView>('all');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Contact[]>([]);
  useEffect(() => { const t = setTimeout(() => { setTerm(q); setPage(1); }, 400); return () => clearTimeout(t); }, [q]);

  const list = useLoad(async () => {
    const r = await va.contacts(view, term, page, mod.sources);
    setItems((prev) => (page === 1 ? r.items : [...prev, ...r.items]));
    return r;
  }, `${mod.key}|${view}|${term}|${page}`, 20000);
  const waiting = useLoad(() => va.contacts('waiting', '', 1, mod.sources), `${mod.key}-waiting`, 20000);
  const urgent = useLoad(() => va.contacts('urgent', '', 1, mod.sources), `${mod.key}-urgent`, 20000);
  const info = useLoad(() => va.channels(), 'channels', 30000);
  const everyone = useLoad(() => va.contacts('all', '', 1, mod.sources), `${mod.key}-everyone`, 30000);
  const watched = new Set(getStatus().packages);
  useEffect(() => { if (info.data) LAST.channels = info.data; }, [info.data]);
  useEffect(() => { if (everyone.data) LAST_RECEIVED.set(mod.key, everyone.data.total); }, [everyone.data, mod.key]);
  const d = info.data ?? LAST.channels;
  const receivedAll = everyone.data?.total ?? LAST_RECEIVED.get(mod.key);
  // Until the first answer arrives we do not know: show "checking", never a false cross.
  const checking = receivedAll === undefined || (!d && (mod.auto === 'telegram'));
  const n = (v: number) => formatBangladeshNumber(v, language);

  const save = async (patch: Record<string, unknown>) => {
    try { await va.saveConfig(patch); await info.reload(); showSnackbar(bn ? 'সেভ হয়েছে' : 'Saved', 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
  };
  const toggleApp = (pkg: string, on: boolean) => {
    const next = new Set(getStatus().packages);
    if (on) next.add(pkg); else next.delete(pkg);
    setPackages([...next]);
    void info.reload();
  };

  const total = list.data?.total ?? 0;
  const verdictNow = verdict(computeChecks(mod, { bridge: getStatus(), channels: d ?? null, received: receivedAll ?? 0, installed: isInstalled }));
  const connected = !checking && verdictNow === 'ok';

  return (
    <Page title={bn ? mod.bn : mod.en} subtitle={bn ? mod.hintBn : mod.hintEn} back={bn ? 'মডিউল' : 'Modules'} onRefresh={() => { setPage(1); void list.reload(); void waiting.reload(); void urgent.reload(); }} refreshing={list.loading && items.length > 0}>
      <Hero right={<BrandLogo brand={mod.brand} size={48} />} title={bn ? mod.bn : mod.en} subtitle={checking ? (bn ? 'দেখছি…' : 'Checking…') : connected ? (bn ? '✓ সংযুক্ত, বার্তা আসছে' : '✓ Connected — messages arriving') : verdictNow === 'partial' ? (bn ? 'প্রায় হয়ে গেছে, নিচে পরীক্ষা করুন' : 'Almost there — run the test below') : (bn ? 'এখনও সংযুক্ত নয়, নিচে দেখুন' : 'Not connected yet — see below')}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <HeroStat value={n(waiting.data?.total ?? 0)} label={bn ? 'উত্তর বাকি' : 'Waiting'} />
          <HeroStat value={n(urgent.data?.total ?? 0)} label={bn ? 'জরুরি' : 'Urgent'} />
          <HeroStat value={n(total)} label={bn ? 'এই তালিকায়' : 'In this list'} />
        </View>
      </Hero>

      <ConnectGuide mod={mod} channels={d ?? null} received={receivedAll ?? 0} pending={checking} onTested={() => { void list.reload(); void waiting.reload(); }} />

      {mod.key === 'email' && d ? (
        <Card icon="email-outline" title={bn ? 'ইমেইল চালু করা' : 'Turn on e-mail'}>
          <ToggleRow icon="power" label={bn ? 'ইমেইল চালু' : 'E-mail on'} value={!!d.settings.email?.enabled} onChange={(v) => void save({ channels: { email: { enabled: v } } })} />
          <Text style={{ opacity: 0.8 }}>{d.email?.inbound_configured ? (bn ? 'ইমেইল গ্রহণের গোপন চাবি বসানো আছে ✓' : 'The e-mail intake secret is set ✓') : (bn ? 'এখনও গোপন চাবি বসানো হয়নি। Render-এ EMAIL_INBOUND_SECRET বসান।' : 'The intake secret is not set yet. Add EMAIL_INBOUND_SECRET in Render.')}</Text>
        </Card>
      ) : null}
      {mod.key === 'email' ? <EmailFilterCard /> : null}

      <PlatformSettings platform={mod.key} canAuto={mod.auto !== 'none' || mod.key === 'whatsapp'} phone={!!mod.apps} />

      {mod.auto === 'telegram' && d ? (
        <Card icon="send-outline" title={bn ? 'Telegram বট' : 'Telegram bot'}>
          <Text style={{ marginBottom: 6, opacity: 0.8 }}>{!d.telegram.configured ? (bn ? 'বট এখনও সংযুক্ত নয়। অ্যাডমিনের “মাধ্যম ও ফোন” ট্যাবে ধাপগুলো দেওয়া আছে।' : 'Bot is not connected yet — steps are in the admin “Channels & phone” tab.') : (bn ? `বট সংযুক্ত: @${d.telegram.bot ?? ''}` : `Bot connected: @${d.telegram.bot ?? ''}`)}</Text>
          <ToggleRow icon="send" label={bn ? 'Telegram চালু' : 'Telegram on'} value={d.settings.telegram.enabled} onChange={(v) => void save({ channels: { telegram: { enabled: v } } })} />
          <ToggleRow icon="robot-outline" label={bn ? 'বট নিজে উত্তর দেবে' : 'Bot replies by itself'} hint={bn ? 'বন্ধ থাকলে শুধু খসড়া হবে। পরিবারের কাউকে কখনও নিজে উত্তর দেবে না।' : 'Off = drafts only. Never family.'} value={d.settings.telegram.auto} onChange={(v) => void save({ channels: { telegram: { auto: v } } })} />
        </Card>
      ) : null}
      {mod.auto === 'sms' && d ? (
        <Card icon="message-text-outline" title={bn ? 'SMS ও কল' : 'SMS and calls'}>
          <ToggleRow icon="message-text-outline" label={bn ? 'SMS-এ নিজে উত্তর দেবে' : 'Reply to SMS by itself'} hint={bn ? 'যেমন মিসড কলে “পরে কল করছি”। পরিবারের কাউকে কখনও নিজে উত্তর দেবে না।' : 'E.g. “I’ll call back”. Never family.'} value={d.settings.device.auto_sms} onChange={(v) => void save({ channels: { device: { auto_sms: v } } })} />
          {!getStatus().smsReceive ? <AppButton variant="secondary" label={bn ? 'SMS-এর অনুমতি দিন' : 'Allow SMS'} onPress={() => router.push('/setup' as never)} /> : null}
        </Card>
      ) : null}
      {/* Phone-app platforms: the "reply by itself" switch is in the platform settings card above (off by default). */}
      {mod.apps ? (
        <Card icon="apps" title={bn ? 'যে অ্যাপের বার্তা পড়া হবে' : 'Apps that are read'}>
          {mod.apps.map((a) => <ToggleRow key={a.pkg} label={bn ? a.bn : a.en} value={watched.has(a.pkg)} onChange={(v) => toggleApp(a.pkg, v)} />)}
          {!getStatus().notificationAccess ? <AppButton variant="secondary" label={bn ? 'বার্তা পড়ার অনুমতি দিন' : 'Allow reading messages'} onPress={() => router.push('/setup' as never)} /> : null}
        </Card>
      ) : null}

      <ChipGroup<InboxView> value={view} options={VIEWS.map((v) => v.key)} labelOf={(k) => { const v = VIEWS.find((x) => x.key === k); return v ? (bn ? v.bn : v.en) : k; }} onChange={(v) => { if (v) { setView(v); setPage(1); } }} />
      <Field label={bn ? 'নাম বা নম্বর খুঁজুন' : 'Search name or number'} value={q} onChangeText={setQ} placeholder={bn ? 'নাম বা নম্বর' : 'Name or number'} />
      <Status loading={list.loading && items.length === 0} error={items.length ? null : list.error} onRetry={list.reload} retryLabel={bn ? 'আবার চেষ্টা করুন' : 'Retry'} />
      {!list.loading && !list.error && items.length === 0 ? <EmptyNote icon="inbox-outline" text={bn ? 'এখানে এখনও কেউ লেখেননি। নতুন বার্তা এলে নাম ও নম্বরসহ এখানে দেখা যাবে।' : 'Nobody has written here yet. New messages will show with name and number.'} /> : null}
      <View style={{ gap: 12 }}>
        {items.map((c) => <ContactRow key={c.id} contact={c} onPress={() => router.push({ pathname: '/contact', params: { id: c.id } } as never)} />)}
      </View>
      {items.length < total ? <AppButton variant="secondary" label={bn ? 'আরও দেখুন' : 'Load more'} onPress={() => setPage((p) => p + 1)} /> : null}
    </Page>
  );
}
