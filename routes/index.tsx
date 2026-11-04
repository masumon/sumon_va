import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton, AppSectionHeader } from '../src/ui/AppSurface';
import { Card, ChipGroup, EmptyNote, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { formatBangladeshNumber, formatBangladeshWeekdayDate } from '../src/i18n/date-time';
import { va, type Contact, type Task } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero, HeroStat } from '../src/va/Hero';
import { Page, Status } from '../src/va/Page';
import { ContactRow } from '../src/va/ContactRow';
import { StatTile, TileGrid } from '../src/va/StatTile';
import { MODULES } from '../src/va/modules';
import { PRESENCE } from '../src/va/labels';
import { getStatus, testAlert } from '../modules/va-bridge';

type Lens = 'personal' | 'business';
const FOR = [{ k: '', bn: 'যতক্ষণ না বদলাই', en: 'Until I change it', min: 0 }, { k: '30', bn: '৩০ মিনিট', en: '30 min', min: 30 }, { k: '60', bn: '১ ঘণ্টা', en: '1 hour', min: 60 }, { k: '120', bn: '২ ঘণ্টা', en: '2 hours', min: 120 }];

function greeting(bn: boolean): string {
  const h = new Date().getHours();
  return bn ? (h < 5 ? 'শুভ রাত' : h < 12 ? 'শুভ সকাল' : h < 16 ? 'শুভ দুপুর' : h < 19 ? 'শুভ বিকাল' : 'শুভ সন্ধ্যা') : (h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
}

/** The home screen: a personal view (family, friends, your promises) and a business view (orders, bookings, leads), one tap apart. */
export default function DashboardScreen() {
  const { bn, accents, language, colors } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [lens, setLens] = useState<Lens>('personal');
  const overview = useLoad(() => va.overview(), 'overview', 20000);
  const family = useLoad(() => va.contacts('family'), 'family', 20000);
  const urgent = useLoad(() => va.contacts('urgent'), 'urgent', 20000);
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
  const setupNeeded = !bridge.notificationAccess || !bridge.smsReceive || !bridge.phoneState || !bridge.batteryExempt;
  const status = c?.statuses.find((s) => s.key === c.status.key);
  const first = (bridge.accountName ?? '').split(' ')[0];
  const welcome = bn ? `${greeting(true)}${first ? `, ${first} ভাই` : ''}` : `${greeting(false)}${first ? `, ${first}` : ''}`;
  const summary = !o ? (bn ? 'আপনার বার্তাগুলো দেখে নিচ্ছি…' : 'Checking your messages…')
    : o.urgent > 0 ? (bn ? `${n(o.urgent)}টি জরুরি বার্তা আপনার অপেক্ষায় আছে` : `${o.urgent} urgent message${o.urgent > 1 ? 's' : ''} waiting for you`)
    : o.waiting > 0 ? (bn ? `${n(o.waiting)}টি বার্তার উত্তর বাকি আছে` : `${o.waiting} message${o.waiting > 1 ? 's' : ''} still need a reply`)
    : (bn ? 'এখন সব শান্ত। কারও উত্তর বাকি নেই' : 'All quiet. Nobody is waiting for you');
  const familyWaiting = (family.data?.items ?? []).filter((x) => x.unread > 0);
  const go = (href: string, params?: Record<string, string>) => router.push((params ? { pathname: href, params } : href) as never);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); await Promise.all([overview.reload(), cfg.reload()]); if (ok) showSnackbar(ok, 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', 'danger'); }
    finally { setBusy(false); }
  };
  const setStatus = (key: string) => {
    const mins = FOR.find((f) => f.k === forKey)?.min ?? 0;
    const until = key === 'free' || !mins ? null : new Date(Date.now() + mins * 60_000).toISOString();
    void run(() => va.saveAssistantConfig({ status: { key, until, custom: '' } }), bn ? 'অবস্থা বদলানো হয়েছে' : 'Status updated');
  };
  const reloadAll = () => { void overview.reload(); void family.reload(); void urgent.reload(); void work.reload(); void biz.reload(); void tasks.reload(); void cfg.reload(); };

  return (
    <Page title={bn ? 'ড্যাশবোর্ড' : 'Dashboard'} subtitle={formatBangladeshWeekdayDate(new Date(), language)} onRefresh={reloadAll} refreshing={overview.loading && !!o}>
      <Status loading={overview.loading && !o} error={o ? null : overview.error} onRetry={overview.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />

      <Hero eyebrow={bn ? 'সুমনের ভার্চুয়াল জগতে স্বাগতম' : 'Welcome to Sumon’s virtual world'} title={welcome} subtitle={summary}>
        {o ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {lens === 'personal' ? (
              <>
                <HeroStat value={n(familyWaiting.length)} label={bn ? 'পরিবারের বার্তা' : 'Family waiting'} />
                <HeroStat value={n(o.urgent)} label={bn ? 'জরুরি' : 'Urgent'} />
                <HeroStat value={n(o.tasks_open)} label={bn ? 'কাজ বাকি' : 'Open tasks'} />
              </>
            ) : (
              <>
                <HeroStat value={n(biz.data?.pending_orders ?? 0)} label={bn ? 'অর্ডার' : 'Orders'} />
                <HeroStat value={n(biz.data?.pending_bookings ?? 0)} label={bn ? 'বুকিং' : 'Bookings'} />
                <HeroStat value={n(biz.data?.new_leads ?? 0)} label={bn ? 'নতুন লিড' : 'New leads'} />
              </>
            )}
          </View>
        ) : null}
      </Hero>
      <ChipGroup<Lens> options={['personal', 'business']} value={lens} labelOf={(l) => (l === 'personal' ? (bn ? 'ব্যক্তিগত' : 'Personal') : (bn ? 'ব্যবসায়িক' : 'Business'))} onChange={(l) => { if (l) setLens(l); }} />

      {o?.presence && o.presence.state !== 'unknown' ? (
        <Text style={{ opacity: 0.7, fontSize: 12, textAlign: 'center' }}>{bn ? PRESENCE[o.presence.state].bn : PRESENCE[o.presence.state].en}</Text>
      ) : null}

      {setupNeeded ? (
        <Card icon="alert-outline" title={bn ? 'সেটআপ বাকি' : 'Setup unfinished'}>
          <Text style={{ marginBottom: 8 }}>{bn ? 'কিছু অনুমতি দেওয়া হয়নি, তাই সব বার্তা আসছে না।' : 'Some permissions are missing, so not every message is caught.'}</Text>
          <AppButton label={bn ? 'অনুমতি ঠিক করুন' : 'Fix permissions'} icon="shield-check-outline" onPress={() => go('/setup')} />
        </Card>
      ) : null}

      {o ? (
        <Card icon="account-clock-outline" title={bn ? 'আমার অবস্থা' : 'Right now I am…'}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AppBadge tone={status && status.key !== 'free' ? 'warning' : 'success'} label={status?.label ?? (bn ? 'ফ্রি আছি' : 'Free')} />
            <Text style={{ flex: 1, opacity: 0.7, fontSize: 13 }}>{bn ? 'সহকারী মানুষকে এটাই বলে।' : 'This is what the assistant tells people.'}</Text>
          </View>
          {c ? (
            <>
              <ChipGroup<string> options={c.statuses.map((s) => s.key)} value={c.status.key} labelOf={(k) => c.statuses.find((s) => s.key === k)?.label ?? k} onChange={(k) => { if (k && !busy) setStatus(k); }} />
              <ChipGroup<string> label={bn ? 'কতক্ষণের জন্য' : 'For how long'} options={FOR.map((f) => f.k)} value={forKey} labelOf={(k) => { const f = FOR.find((x) => x.k === k); return f ? (bn ? f.bn : f.en) : k; }} onChange={(k) => setForKey(k ?? '')} />
            </>
          ) : null}
          <View style={{ marginTop: 8 }}>
            <ToggleRow icon="robot-outline" label={bn ? 'নিজে নিজে উত্তর দেবে' : 'Reply by itself'} hint={auto ? (bn ? 'চালু। পরিবারকে কখনও নয়।' : 'On — never to family.') : (bn ? 'বন্ধ। শুধু খসড়া করবে।' : 'Off — drafts only.')}
              value={auto} onChange={(next) => { if (!busy) void run(() => va.killSwitch(!next), next ? (bn ? 'নিজে-নিজে উত্তর চালু' : 'Auto-reply on') : (bn ? 'সব নিজে-নিজে উত্তর বন্ধ' : 'All auto-replies off')); }} />
          </View>
        </Card>
      ) : null}

      {o && lens === 'personal' ? (
        <>
          <TileGrid>
            <StatTile icon="account-heart-outline" label={bn ? 'পরিবার' : 'Family'} value={n(familyWaiting.length)} tone={familyWaiting.length ? accents.orange : undefined} onPress={() => go('/inbox', { view: 'family' })} />
            <StatTile icon="alert-octagon-outline" label={bn ? 'জরুরি' : 'Urgent'} value={n(o.urgent)} tone={o.urgent ? accents.red : undefined} onPress={() => go('/inbox', { view: 'urgent' })} />
            <StatTile icon="message-reply-text-outline" label={bn ? 'উত্তর বাকি' : 'Waiting'} value={n(o.waiting)} onPress={() => go('/inbox', { view: 'waiting' })} />
            <StatTile icon="file-document-edit-outline" label={bn ? 'খসড়া দেখে দিতে হবে' : 'Drafts to approve'} value={n(o.drafts)} onPress={() => go('/inbox', { view: 'drafts' })} />
          </TileGrid>
          <AppSectionHeader title={bn ? 'পরিবার ও জরুরি' : 'Family and urgent'} actionLabel={bn ? 'সব' : 'All'} onAction={() => go('/inbox', { view: 'urgent' })} />
          {familyWaiting.length === 0 && (urgent.data?.items.length ?? 0) === 0 ? <EmptyNote icon="check-circle-outline" text={bn ? 'পরিবারের বা জরুরি কিছু বাকি নেই ✓' : 'No family or urgent messages waiting ✓'} /> : null}
          <View style={{ gap: 12 }}>
            {[...familyWaiting, ...(urgent.data?.items ?? []).filter((x) => !x.is_family)].slice(0, 4).map((x: Contact) => <ContactRow key={x.id} contact={x} onPress={() => go('/contact', { id: x.id })} />)}
          </View>
        </>
      ) : null}

      {o && lens === 'business' ? (
        <>
          <TileGrid>
            <StatTile icon="cart-outline" label={bn ? 'বাকি অর্ডার' : 'Pending orders'} value={n(biz.data?.pending_orders ?? 0)} tone={biz.data?.pending_orders ? accents.orange : undefined} />
            <StatTile icon="briefcase-outline" label={bn ? 'বাকি বুকিং' : 'Pending bookings'} value={n(biz.data?.pending_bookings ?? 0)} tone={biz.data?.pending_bookings ? accents.orange : undefined} />
            <StatTile icon="account-star-outline" label={bn ? 'নতুন লিড' : 'New leads'} value={n(biz.data?.new_leads ?? 0)} tone={biz.data?.new_leads ? accents.green : undefined} />
            <StatTile icon="file-account-outline" label={bn ? 'চাকরির আবেদন' : 'Applications'} value={n(biz.data?.new_applications ?? 0)} />
          </TileGrid>
          <AppSectionHeader title={bn ? 'নতুন কাজের খোঁজ' : 'New work enquiries'} actionLabel={bn ? 'সব' : 'All'} onAction={() => go('/inbox', { view: 'work' })} />
          {work.data && work.data.items.length === 0 ? <EmptyNote icon="briefcase-check-outline" text={bn ? 'নতুন কাজের খোঁজ নেই' : 'No new work enquiries'} /> : null}
          <View style={{ gap: 12 }}>{(work.data?.items ?? []).slice(0, 4).map((x: Contact) => <ContactRow key={x.id} contact={x} onPress={() => go('/contact', { id: x.id })} />)}</View>
        </>
      ) : null}

      <AppSectionHeader title={bn ? 'মডিউল' : 'Modules'} actionLabel={bn ? 'সব' : 'All'} onAction={() => go('/channels')} />
      <TileGrid>
        {MODULES.slice(0, 6).map((m) => <StatTile key={m.key} icon={m.icon} label={bn ? m.bn : m.en} value="›" onPress={() => go('/m/[key]', { key: m.key })} />)}
      </TileGrid>

      <AppSectionHeader title={bn ? 'আজকের কাজ' : 'To do'} actionLabel={bn ? 'সব' : 'All'} onAction={() => go('/tasks')} />
      {tasks.data && tasks.data.length === 0 ? <EmptyNote icon="check-all" text={bn ? 'কোনো কাজ বাকি নেই' : 'No open tasks'} /> : null}
      {(tasks.data ?? []).slice(0, 3).map((t: Task) => (
        <Pressable key={t.id} onPress={() => go('/tasks')} style={{ padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
          <Text style={{ fontWeight: '600' }}>{t.title}</Text>
          {t.contact_name || t.contact_phone ? <Text style={{ opacity: 0.65, fontSize: 12 }}>{t.contact_name || t.contact_phone}</Text> : null}
        </Pressable>
      ))}

      <AppSectionHeader title={bn ? 'দ্রুত কাজ' : 'Quick actions'} />
      <TileGrid>
        <StatTile icon="plus-circle-outline" label={bn ? 'নতুন কাজ যোগ' : 'Add a task'} value="নতুন" onPress={() => go('/tasks')} />
        <StatTile icon="brain" label={bn ? 'AI সংযোগ' : 'AI connections'} value="খুলুন" onPress={() => go('/ai')} />
        <StatTile icon="bell-ring-outline" label={bn ? 'জরুরি অ্যালার্ম পরীক্ষা' : 'Test urgent alarm'} value="বাজান" onPress={() => { testAlert(); showSnackbar(bn ? 'অ্যালার্ম বাজানো হয়েছে' : 'Alarm sent', 'info'); }} />
        <StatTile icon="robot-outline" label={bn ? 'সহকারীর নিয়ম' : 'Assistant rules'} value="দেখুন" onPress={() => go('/rules')} />
      </TileGrid>
    </Page>
  );
}
