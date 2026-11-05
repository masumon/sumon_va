import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { Card, useKit } from '../src/ui/AppKit';
import { va } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero, HeroStat } from '../src/va/Hero';
import { Page, Status } from '../src/va/Page';
import { HERO_BAD, HERO_OK, HERO_WARN, num } from '../src/va/bd';

// A plain-Bangla line under the technical titles the server sends; the technical words stay.
function plainNote(title: string, bn: boolean): string | null {
  const t = title.toLowerCase();
  if (t.includes('phone number id') || t.includes('access token')) return bn ? 'মানে: Meta-র দেওয়া নম্বরের পরিচয় ও গোপন চাবি, যা দিয়ে অ্যাপ আপনার WhatsApp-এ ঢোকে।' : 'In plain words: the ID of your WhatsApp number and its secret key, so the app can use your WhatsApp.';
  if (t.includes('app secret')) return bn ? 'মানে: Meta আসল বার্তা পাঠালে তা চেনার গোপন সংকেত।' : 'In plain words: a secret used to make sure messages really come from Meta.';
  if (t.includes('meta') && (t.includes('সংযোগ') || t.includes('connection'))) return bn ? 'মানে: এখনই Meta-কে জিজ্ঞেস করে দেখা হয়েছে সব সত্যিই চলছে কিনা।' : 'In plain words: we asked Meta right now whether everything really works.';
  return null;
}

/** The WhatsApp business connection, checked live: every item says what is fine or what is wrong. Meta keys themselves are entered in the admin on a computer. */
export default function WaHealthScreen() {
  const { bn, colors } = useKit();
  const h = useLoad(() => va.waHealth(false), 'wa-health', 60000);
  const r = useLoad(() => va.waHealth(true), 'wa-health-remote');
  const d = r.data ?? h.data;
  const [pull, setPull] = useState(false);
  const onPull = () => { setPull(true); void h.reload(); void r.reload(); setTimeout(() => setPull(false), 900); };
  return (
    <Page title={bn ? 'WhatsApp সংযোগ' : 'WhatsApp connection'} subtitle={bn ? 'ব্যবসার WhatsApp ঠিক চলছে কিনা' : 'Is the business WhatsApp healthy'} back={bn ? 'মডিউল' : 'Modules'} onRefresh={onPull} refreshing={pull}>
      <Status loading={h.loading && !d} error={d ? null : h.error} onRetry={h.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {d ? (
        <>
          <Hero grad={d.summary === 'ok' ? HERO_OK : d.summary === 'bad' ? HERO_BAD : HERO_WARN} right={r.loading ? <ActivityIndicator color="#FFFFFF" accessibilityLabel={bn ? 'Meta-তে দেখা হচ্ছে' : 'Checking with Meta'} /> : undefined} icon={d.summary === 'ok' ? 'check-decagram-outline' : 'alert-outline'} title={d.summary === 'ok' ? (bn ? 'সব ঠিক আছে ✓' : 'All good ✓') : d.summary === 'bad' ? (bn ? 'সমস্যা আছে' : 'Problems found') : (bn ? 'কিছু কাজ বাকি' : 'Some steps left')} subtitle={r.loading ? (bn ? 'Meta-তে দেখা হচ্ছে…' : 'Checking with Meta…') : undefined}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <HeroStat value={num(d.ok ?? 0, bn)} label={bn ? 'ঠিক' : 'OK'} /><HeroStat value={num(d.bad ?? 0, bn)} label={bn ? 'সমস্যা' : 'Bad'} /><HeroStat value={num(d.todo ?? 0, bn)} label={bn ? 'বাকি' : 'To do'} />
            </View>
          </Hero>
          {(d.items ?? []).map((i) => (
            <Card key={i.key}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <AppIcon name={i.state === 'ok' ? 'check-circle' : i.state === 'bad' ? 'close-circle' : 'progress-clock'} size={24} color={i.state === 'ok' ? colors.success : i.state === 'bad' ? colors.danger : colors.warning} />
                <Text style={{ flex: 1, fontWeight: '700' }}>{i.title}</Text>
                <AppBadge tone={i.state === 'ok' ? 'success' : i.state === 'bad' ? 'danger' : 'warning'} label={i.state === 'ok' ? (bn ? 'ঠিক' : 'OK') : i.state === 'bad' ? (bn ? 'সমস্যা' : 'Bad') : (bn ? 'বাকি' : 'To do')} />
              </View>
              {plainNote(i.title, bn) ? <Text style={{ marginTop: 4, color: colors.textSecondary, fontSize: 13 }}>{plainNote(i.title, bn)}</Text> : null}
              <Text style={{ marginTop: 6, opacity: 0.85, lineHeight: 21 }}>{i.detail}</Text>
              {i.fix ? <Text style={{ marginTop: 6, color: colors.primary, fontWeight: '700' }}>{i.fix.label}</Text> : null}
            </Card>
          ))}
          <AppButton variant="secondary" icon="refresh" label={bn ? 'এখনই Meta-তে দেখুন' : 'Check with Meta now'} loading={r.loading} onPress={() => void r.reload()} />
        </>
      ) : null}
    </Page>
  );
}
