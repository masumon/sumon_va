import { View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { Card, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { formatBangladeshDateTime, formatBangladeshNumber } from '../src/i18n/date-time';
import { va } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Page, Status } from '../src/va/Page';
import { CHANNEL } from '../src/va/labels';
import { getStatus, setPackages } from '../modules/va-bridge';

// The chat apps the phone can watch. Anyone else can be added by package name later without touching the screen.
const APPS: { pkg: string; bn: string; en: string }[] = [
  { pkg: 'com.whatsapp', bn: 'WhatsApp', en: 'WhatsApp' }, { pkg: 'com.whatsapp.w4b', bn: 'WhatsApp Business', en: 'WhatsApp Business' },
  { pkg: 'com.facebook.orca', bn: 'Messenger', en: 'Messenger' }, { pkg: 'com.instagram.android', bn: 'Instagram', en: 'Instagram' },
  { pkg: 'org.telegram.messenger', bn: 'Telegram', en: 'Telegram' }, { pkg: 'com.imo.android.imoim', bn: 'IMO', en: 'IMO' },
  { pkg: 'com.viber.voip', bn: 'Viber', en: 'Viber' }, { pkg: 'org.thoughtcrime.securesms', bn: 'Signal', en: 'Signal' },
  { pkg: 'jp.naver.line.android', bn: 'LINE', en: 'LINE' }, { pkg: 'com.google.android.gm', bn: 'Gmail', en: 'Gmail' },
];

export default function ChannelsScreen() {
  const { bn, language } = useKit();
  const { showSnackbar } = useAppFeedback();
  const info = useLoad(() => va.channels(), 'channels', 20000);
  const bridge = useLoad(async () => getStatus(), 'bridge', 3000);
  const d = info.data;
  const watched = new Set(bridge.data?.packages ?? getStatus().packages);

  const save = async (patch: Record<string, unknown>) => {
    try { await va.saveConfig(patch); await info.reload(); } catch (e) { showSnackbar(e instanceof Error ? e.message : '', 'danger'); }
  };
  const toggleApp = (pkg: string, on: boolean) => {
    const next = new Set(watched);
    if (on) next.add(pkg); else next.delete(pkg);
    setPackages([...next]);
    void bridge.reload();
  };

  return (
    <Page title={bn ? 'মাধ্যম' : 'Channels'} subtitle={bn ? 'কোথা থেকে বার্তা আসছে, কোথায় উত্তর যাবে' : 'Where messages come from and where replies go'} onRefresh={info.reload} refreshing={info.loading && !!d}>
      <Status loading={info.loading && !d} error={d ? null : info.error} onRetry={info.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {d ? (
        <>
          {d.channels.map((c) => {
            const meta = CHANNEL[c.key];
            return (
              <Card key={c.key}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <AppIcon name={meta.icon} size={26} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700' }}>{bn ? meta.bn : meta.en}</Text>
                    <Text style={{ opacity: 0.7, fontSize: 13 }}>{bn ? `${formatBangladeshNumber(c.messages, language)}টি বার্তা এসেছে` : `${c.messages} messages received`}</Text>
                  </View>
                  <AppBadge tone={c.can_auto ? 'success' : 'neutral'} label={c.can_auto ? (bn ? 'অটো-উত্তর সম্ভব' : 'Can auto-reply') : (bn ? 'শুধু খসড়া' : 'Drafts only')} />
                </View>
              </Card>
            );
          })}

          <Card title="Telegram">
            <Text style={{ marginBottom: 8, opacity: 0.8 }}>
              {!d.telegram.configured ? (bn ? 'বট এখনও সংযুক্ত নয় (অ্যাডমিন থেকে সেটআপ করতে হবে)।' : 'Bot is not connected yet (set up from the admin).')
                : d.telegram.error ? d.telegram.error : bn ? `বট সংযুক্ত: @${d.telegram.bot ?? ''}` : `Bot connected: @${d.telegram.bot ?? ''}`}
            </Text>
            <ToggleRow icon="send" label={bn ? 'Telegram চালু' : 'Telegram on'} value={d.settings.telegram.enabled} onChange={(v) => void save({ channels: { telegram: { enabled: v } } })} />
            <ToggleRow icon="robot-outline" label={bn ? 'Telegram-এ নিজে উত্তর দেবে' : 'Reply by itself on Telegram'} hint={bn ? 'বন্ধ থাকলে শুধু খসড়া।' : 'Off means drafts only.'}
              value={d.settings.telegram.auto} onChange={(v) => void save({ channels: { telegram: { auto: v } } })} />
          </Card>

          <Card title={bn ? 'SMS' : 'SMS'}>
            <ToggleRow icon="message-text-outline" label={bn ? 'SMS-এ নিজে উত্তর দেবে' : 'Reply to SMS by itself'} hint={bn ? 'যেমন মিসড কলে “পরে কল করছি”। পরিবারে কখনও নয়।' : 'E.g. “I’ll call back” after a missed call. Never family.'}
              value={d.settings.device.auto_sms} onChange={(v) => void save({ channels: { device: { auto_sms: v } } })} />
          </Card>

          <Card title={bn ? 'যে অ্যাপগুলোর বার্তা পড়া হবে' : 'Apps whose messages are read'}>
            <Text style={{ marginBottom: 6, opacity: 0.75, fontSize: 13 }}>{bn ? 'এগুলোতে সহকারী নিজে উত্তর পাঠায় না। আপনি অনুমোদন করলে তবেই যায়।' : 'The assistant never replies in these by itself. Only after you approve.'}</Text>
            {APPS.map((a) => <ToggleRow key={a.pkg} label={bn ? a.bn : a.en} value={watched.has(a.pkg)} onChange={(v) => toggleApp(a.pkg, v)} />)}
          </Card>

          <Card title={bn ? 'জোড়া লাগানো ফোন' : 'Paired phones'}>
            {d.devices.length === 0 ? <Text>{bn ? 'কোনো ফোন নেই।' : 'No phones.'}</Text> : d.devices.map((p) => (
              <View key={p.id} style={{ marginBottom: 8 }}>
                <Text style={{ fontWeight: '700' }}>{p.name}{p.revoked ? (bn ? ' (বাতিল)' : ' (revoked)') : ''}</Text>
                <Text style={{ opacity: 0.7, fontSize: 13 }}>{p.last_seen_at ? (bn ? 'শেষ সংযোগ: ' : 'Last seen: ') + formatBangladeshDateTime(p.last_seen_at, language) : (bn ? 'এখনও সংযোগ দেয়নি' : 'Never connected')}</Text>
              </View>
            ))}
            <Text style={{ opacity: 0.7, fontSize: 13 }}>{bn ? 'ফোন বাতিল করতে অ্যাডমিন সাইটে যান।' : 'To revoke a phone, use the admin site.'}</Text>
          </Card>
        </>
      ) : null}
    </Page>
  );
}
