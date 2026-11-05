import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { Card, EmptyNote, useKit } from '../src/ui/AppKit';
import { formatBangladeshDateTime, formatBangladeshNumber } from '../src/i18n/date-time';
import { useHealth } from '../src/va/useHealth';
import type { Issue } from '../src/va/health';
import { Hero, HeroStat } from '../src/va/Hero';
import { Page } from '../src/va/Page';
import { openAppSettings, startService } from '../modules/va-bridge';

const SEV = { critical: { tone: 'danger' as const, bn: 'গুরুতর', en: 'Serious', icon: 'alert-circle' as const }, warn: { tone: 'warning' as const, bn: 'সতর্কতা', en: 'Warning', icon: 'alert' as const }, info: { tone: 'neutral' as const, bn: 'তথ্য', en: 'Info', icon: 'information-outline' as const } };

/** Everything the app notices, live: what happened, why, and the button that fixes it. */
export default function HealthScreen() {
  const { bn, colors, language } = useKit();
  const { issues, reload, bridge, loading } = useHealth();
  const serious = issues.filter((i) => i.severity === 'critical').length;
  const warn = issues.filter((i) => i.severity === 'warn').length;

  const fix = (i: Issue) => {
    const f = i.fix;
    if (!f) return;
    if (f.route) {
      const [path, query] = f.route.split('?');
      const params = Object.fromEntries(new URLSearchParams(query ?? '').entries());
      router.push((query ? { pathname: path, params } : path) as never);
    }
    else if (f.action === 'restart-sync') { startService(); setTimeout(reload, 1500); }
    else if (f.action === 'app-settings') openAppSettings();
    else reload();
  };

  return (
    <Page title={bn ? 'সমস্যা ও অবস্থা' : 'Problems & health'} subtitle={bn ? 'এখন কী কী ঠিক নেই, নিজে থেকেই নতুন হয়' : 'What is not right — updates by itself'} onRefresh={reload} refreshing={loading}>
      <Hero icon={serious ? 'alert-circle-outline' : warn ? 'alert-outline' : 'check-decagram-outline'} title={serious ? (bn ? 'গুরুতর সমস্যা আছে' : 'Serious problems') : warn ? (bn ? 'কিছু সতর্কতা' : 'Some warnings') : (bn ? 'সব ঠিক আছে ✓' : 'All good ✓')}
        subtitle={bn ? 'অ্যাপ প্রতি ১৫ সেকেন্ডে নিজেই দেখে নেয়, নতুন সমস্যা হলে নোটিফিকেশন দেয়।' : 'The app checks itself every 15 seconds and notifies you of new problems.'}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <HeroStat value={formatBangladeshNumber(serious, language)} label={bn ? 'গুরুতর' : 'Serious'} />
          <HeroStat value={formatBangladeshNumber(warn, language)} label={bn ? 'সতর্কতা' : 'Warnings'} />
          <HeroStat value={bridge.serviceAlive ? (bn ? 'চালু' : 'On') : (bn ? 'বন্ধ' : 'Off')} label={bn ? 'সিঙ্ক' : 'Sync'} />
        </View>
      </Hero>

      {issues.length === 0 ? <EmptyNote icon="check-circle-outline" text={bn ? 'কোনো সমস্যা নেই। বার্তা আসছে, সংযোগ ঠিক আছে, সব অনুমতি দেওয়া আছে, AI চলছে।' : 'No problems. Messages arrive, the connection is fine, permissions are complete, the AI works.'} /> : null}
      {issues.map((i) => {
        const s = SEV[i.severity];
        return (
          <Pressable key={i.key} disabled={!i.fix} accessibilityRole={i.fix ? 'button' : undefined} onPress={() => fix(i)} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <AppIcon name={s.icon} size={26} color={i.severity === 'critical' ? colors.danger : i.severity === 'warn' ? colors.warning : colors.textMuted} />
              <Text style={{ flex: 1, fontWeight: '700' }}>{bn ? i.bn : i.en}</Text>
              <AppBadge tone={s.tone} label={bn ? s.bn : s.en} />
            </View>
            <Text style={{ marginTop: 8, opacity: 0.85, lineHeight: 21 }}>{bn ? i.whyBn : i.whyEn}</Text>
            {i.fix ? <View style={{ marginTop: 10 }}><AppButton label={bn ? i.fix.bn : i.fix.en} onPress={() => fix(i)} /></View> : null}
          </Card>
          </Pressable>
        );
      })}

      <Card title={bn ? 'সংযোগের বিবরণ' : 'Connection details'}>
        <Text>{bn ? 'ব্যাকগ্রাউন্ড সিঙ্ক: ' : 'Background sync: '}{bridge.serviceAlive ? (bn ? 'চালু ✓' : 'running ✓') : (bn ? 'বন্ধ' : 'stopped')}</Text>
        <Text>{bn ? 'শেষবার সংযোগ হয়েছে: ' : 'Last successful sync: '}{bridge.lastOk ? formatBangladeshDateTime(new Date(bridge.lastOk), language) : (bn ? 'এখনও হয়নি' : 'not yet')}</Text>
        <Text>{bn ? 'পাঠাতে বাকি: ' : 'Waiting to upload: '}{formatBangladeshNumber(bridge.queued, language)}</Text>
        <Text>{bn ? 'অ্যাকাউন্ট: ' : 'Account: '}{bridge.accountEmail ?? (bn ? 'অ্যাডমিন কোড দিয়ে জোড়া' : 'Paired by admin code')}</Text>
        {bridge.lastError ? <Text style={{ color: colors.danger }}>{bridge.lastError}</Text> : null}
        <View style={{ marginTop: 10 }}><AppButton variant="secondary" icon="refresh" label={bn ? 'এখনই দেখুন' : 'Check now'} onPress={reload} /></View>
      </Card>
    </Page>
  );
}
