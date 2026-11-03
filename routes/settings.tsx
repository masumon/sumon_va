import { useState } from 'react';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { Card, ChipGroup, Field, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppPreferences } from '../src/app/AppPreferences';
import { va, type Limits } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Page } from '../src/va/Page';
import { THEME_OPTIONS, type ThemeChoice } from '../src/va/labels';
import { unpair } from '../modules/va-bridge';
import { APP_VERSION } from '../src/va/config';

type Lang = 'bn' | 'en';
const SIZES = ['0.9', '1', '1.1', '1.2'] as const;
const CAPS = ['3', '5', '8', '12'] as const;
const FROM = ['21:00', '22:00', '23:00', '00:00'] as const;
const TO = ['05:00', '06:00', '07:00', '08:00'] as const;

export default function SettingsScreen() {
  const { bn } = useKit();
  const p = useAppPreferences();
  const { showSnackbar } = useAppFeedback();
  const channels = useLoad(() => va.channels(), 'channels');
  const limits = channels.data?.limits;
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState(false);

  const saveLimits = async (patch: Partial<Limits>) => {
    try { await va.saveConfig({ limits: patch }); await channels.reload(); showSnackbar(bn ? 'সংরক্ষিত' : 'Saved', 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', 'danger'); }
  };

  return (
    <Page title={bn ? 'সেটিংস' : 'Settings'} subtitle={bn ? 'চেহারা, নিরাপত্তা ও সীমা' : 'Look, security and limits'}>
      <Card title={bn ? 'ভাষা' : 'Language'}>
        <ChipGroup<Lang> options={['bn', 'en']} value={p.language} labelOf={(l) => (l === 'bn' ? 'বাংলা' : 'English')} onChange={(l) => { if (l) void p.setLanguage(l); }} />
      </Card>

      <Card title={bn ? 'চেহারা' : 'Appearance'}>
        <ChipGroup<ThemeChoice> label={bn ? 'রং' : 'Theme'} options={THEME_OPTIONS.map((t) => t.value)} value={p.themeSetting} labelOf={(v) => { const t = THEME_OPTIONS.find((x) => x.value === v); return t ? (bn ? t.bn : t.en) : v; }} onChange={(t) => { if (t) void p.setThemeMode(t); }} />
        <ChipGroup<(typeof SIZES)[number]> label={bn ? 'লেখার মাপ' : 'Text size'} options={SIZES} value={String(p.textScale) as (typeof SIZES)[number]}
          labelOf={(s) => (s === '0.9' ? (bn ? 'ছোট' : 'Small') : s === '1' ? (bn ? 'স্বাভাবিক' : 'Normal') : s === '1.1' ? (bn ? 'বড়' : 'Large') : (bn ? 'আরও বড়' : 'Larger'))} onChange={(s) => { if (s) void p.setTextScale(Number(s)); }} />
        <ToggleRow icon="motion-pause-outline" label={bn ? 'কম অ্যানিমেশন' : 'Reduce motion'} value={p.reduceMotion} onChange={(v) => void p.setReduceMotion(v)} />
      </Card>

      <Card title={bn ? 'নিরাপত্তা' : 'Security'}>
        <ToggleRow icon="cellphone-lock" label={bn ? 'স্ক্রিনশট ও রিসেন্ট-অ্যাপে লুকান' : 'Hide from screenshots and recents'} hint={bn ? 'আপনার চ্যাট কেউ স্ক্রিনশটে বা রিসেন্ট অ্যাপের ছবিতে দেখতে পাবে না।' : 'Nobody can capture your chats.'}
          value={p.blockScreenshots} onChange={(v) => void p.setBlockScreenshots(v)} />
        <Text style={{ marginTop: 12, fontWeight: '700' }}>{p.appLockEnabled ? (bn ? 'অ্যাপ-লক চালু (PIN ও আঙুলের ছাপ)' : 'App lock on (PIN and fingerprint)') : (bn ? 'অ্যাপ-লক বন্ধ' : 'App lock off')}</Text>
        <Field label={bn ? 'নতুন PIN (৪–৮ সংখ্যা)' : 'New PIN (4–8 digits)'} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))} keyboardType="numeric" />
        <AppButton label={p.appLockEnabled ? (bn ? 'PIN বদলান' : 'Change PIN') : (bn ? 'অ্যাপ-লক চালু করুন' : 'Turn on app lock')} disabled={pin.length < 4}
          onPress={() => { void p.setAppLockPin(pin).then(() => { setPin(''); showSnackbar(bn ? 'অ্যাপ-লক চালু' : 'App lock on', 'success'); }); }} />
        {p.appLockEnabled ? <AppButton variant="secondary" label={bn ? 'অ্যাপ-লক বন্ধ করুন' : 'Turn off app lock'} onPress={() => void p.setAppLockPin(null)} /> : null}
      </Card>

      <Card title={bn ? 'জরুরি অ্যালার্টের সীমা' : 'Urgent alert limits'}>
        {limits ? (
          <>
            <ChipGroup<(typeof CAPS)[number]> label={bn ? 'দিনে সর্বোচ্চ জরুরি অ্যালার্ট' : 'Max urgent alerts a day'} options={CAPS} value={String(limits.urgent_per_day) as (typeof CAPS)[number]} labelOf={(c) => c} onChange={(c) => { if (c) void saveLimits({ urgent_per_day: Number(c) }); }} />
            <ChipGroup<(typeof FROM)[number]> label={bn ? 'রাতের শান্ত সময় শুরু' : 'Quiet time starts'} options={FROM} value={limits.quiet_from as (typeof FROM)[number]} labelOf={(c) => c} onChange={(c) => { if (c) void saveLimits({ quiet_from: c }); }} />
            <ChipGroup<(typeof TO)[number]> label={bn ? 'শান্ত সময় শেষ' : 'Quiet time ends'} options={TO} value={limits.quiet_to as (typeof TO)[number]} labelOf={(c) => c} onChange={(c) => { if (c) void saveLimits({ quiet_to: c }); }} />
            <ToggleRow label={bn ? 'শান্ত সময়ে শুধু সবচেয়ে জরুরি' : 'Only the most urgent in quiet time'} value={limits.quiet_urgent_only} onChange={(v) => void saveLimits({ quiet_urgent_only: v })} />
          </>
        ) : <Text>{channels.error ?? '…'}</Text>}
      </Card>

      <Card>
        <AppButton variant="secondary" icon="information-outline" label={bn ? 'অ্যাপ সম্পর্কে ও ক্রেডিট' : 'About and credits'} onPress={() => router.push('/about' as never)} />
      </Card>

      <Card title={bn ? 'এই ফোন' : 'This phone'}>
        <AppButton variant="danger" icon="link-off" label={bn ? 'এই ফোনের সংযোগ বিচ্ছিন্ন করুন' : 'Unpair this phone'} onPress={() => setConfirm(true)} />
        <Text style={{ marginTop: 10, opacity: 0.7, fontSize: 13 }}>{bn ? 'সংস্করণ' : 'Version'} {APP_VERSION}</Text>
      </Card>

      <AppConfirmDialog visible={confirm} danger icon="link-off" title={bn ? 'সংযোগ বিচ্ছিন্ন করবেন?' : 'Unpair this phone?'}
        description={bn ? 'এই ফোন আর বার্তা পাঠাবে না, জরুরি অ্যালার্টও আসবে না। আবার জোড়া লাগাতে নতুন কোড লাগবে।' : 'This phone will stop sending messages and will not get urgent alerts. You need a new code to pair again.'}
        cancelLabel={bn ? 'না' : 'No'} confirmLabel={bn ? 'বিচ্ছিন্ন করুন' : 'Unpair'} onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); unpair(); router.replace('/login' as never); }} />
    </Page>
  );
}
