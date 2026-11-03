import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton, AppSectionHeader } from '../src/ui/AppSurface';
import { Card, EmptyNote, Stat, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { va, type Contact } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Page, Status } from '../src/va/Page';
import { ContactRow } from '../src/va/ContactRow';
import { getStatus } from '../modules/va-bridge';
import { formatBangladeshNumber } from '../src/i18n/date-time';

export default function HomeScreen() {
  const { bn, accents, language } = useKit();
  const { showSnackbar } = useAppFeedback();
  const overview = useLoad(() => va.overview(), 'overview', 15000);
  const urgent = useLoad(() => va.contacts('urgent'), 'urgent', 15000);
  const [busy, setBusy] = useState(false);
  const bridge = getStatus();
  const n = (v: number) => formatBangladeshNumber(v, language);
  const o = overview.data;
  const auto = o ? o.mode === 'auto' && o.enabled : false;
  const setupNeeded = !bridge.notificationAccess || !bridge.smsReceive || !bridge.phoneState || !bridge.batteryExempt;

  const toggleAuto = async (next: boolean) => {
    setBusy(true);
    try {
      await va.killSwitch(!next);
      await overview.reload();
      showSnackbar(next ? (bn ? 'অটো-উত্তর চালু' : 'Auto-reply on') : (bn ? 'সব অটো-উত্তর বন্ধ — শুধু খসড়া হবে' : 'All auto-replies off — drafts only'), 'success');
    } catch (e) {
      showSnackbar(e instanceof Error ? e.message : '', 'danger');
    } finally { setBusy(false); }
  };

  return (
    <Page title={bn ? 'সুমনের ভার্চুয়াল সহকারী' : "Sumon's Virtual Assistant"} subtitle={bn ? 'সব মাধ্যমের বার্তা, এক জায়গায়' : 'Every channel, one place'}
      onRefresh={() => { void overview.reload(); void urgent.reload(); }} refreshing={overview.loading && !!o}>
      <Status loading={overview.loading && !o} error={o ? null : overview.error} onRetry={overview.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />

      {setupNeeded ? (
        <Card title={bn ? '⚠️ সেটআপ বাকি' : '⚠️ Setup unfinished'}>
          <Text style={{ marginBottom: 8 }}>{bn ? 'কিছু অনুমতি দেওয়া হয়নি, তাই সব বার্তা ধরা পড়ছে না।' : 'Some permissions are missing, so not every message is caught.'}</Text>
          <AppButton label={bn ? 'এখনই ঠিক করি' : 'Fix it now'} icon="cog-play-outline" onPress={() => router.push('/setup' as never)} />
        </Card>
      ) : null}

      {o ? (
        <>
          <Card title={bn ? 'সহকারীর অবস্থা' : 'Assistant status'}>
            <ToggleRow icon="robot-outline" label={bn ? 'নিজে নিজে উত্তর দেবে' : 'Reply by itself'}
              hint={auto ? (bn ? 'চালু — শুধু অনুমোদিত মাধ্যমে ও অচেনা/ব্যবসার বার্তায়। পরিবারে কখনও নয়।' : 'On — approved channels and business/unknown senders only. Never family.') : (bn ? 'বন্ধ — সহকারী শুধু খসড়া বানাচ্ছে, আপনি অনুমোদন করলে যাবে।' : 'Off — only drafts; nothing is sent until you approve.')}
              value={auto} onChange={(next) => { if (!busy) void toggleAuto(next); }} />
          </Card>

          <Card title={bn ? 'এক নজরে' : 'At a glance'}>
            <Stat label={bn ? 'উত্তর বাকি' : 'Waiting for you'} value={n(o.waiting)} tone={o.waiting ? accents.orange : undefined} />
            <Stat label={bn ? 'জরুরি' : 'Urgent'} value={n(o.urgent)} tone={o.urgent ? accents.red : undefined} />
            <Stat label={bn ? 'খসড়া — অনুমোদনের অপেক্ষায়' : 'Drafts to approve'} value={n(o.drafts)} />
            {o.failed_24h ? <Stat label={bn ? 'গত ২৪ ঘণ্টায় পাঠানো যায়নি' : 'Failed to send (24h)'} value={n(o.failed_24h)} tone={accents.red} /> : null}
          </Card>
        </>
      ) : null}

      <AppSectionHeader title={bn ? 'এখন দেখা দরকার' : 'Needs you now'} actionLabel={bn ? 'সব দেখুন' : 'See all'} onAction={() => router.push('/inbox' as never)} />
      {urgent.data && urgent.data.items.length === 0 ? <EmptyNote icon="check-circle-outline" text={bn ? 'জরুরি কিছু নেই। সব ঠিক আছে ✓' : 'Nothing urgent. All clear ✓'} /> : null}
      <View style={{ gap: 12 }}>
        {(urgent.data?.items ?? []).slice(0, 5).map((c: Contact) => <ContactRow key={c.id} contact={c} onPress={() => router.push({ pathname: '/contact', params: { id: c.id } } as never)} />)}
      </View>
      {bridge.lastError ? <AppBadge tone="warning" label={bridge.lastError} /> : null}
    </Page>
  );
}
