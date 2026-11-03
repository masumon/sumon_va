import { useState } from 'react';
import { PermissionsAndroid, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { Card, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { Page } from '../src/va/Page';
import { useLoad } from '../src/va/hooks';
import { getStatus, openBatterySettings, openDndAccess, openNotificationAccess, startService, testAlert } from '../modules/va-bridge';

type Step = { key: string; bn: string; en: string; hintBn: string; hintEn: string; ok: boolean; run: () => void | Promise<void> };

/** Each permission the phone side needs, with the phone's own real answer (never "check it yourself"). */
export default function SetupScreen() {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const status = useLoad(async () => getStatus(), 'bridge', 2000);
  const [busy, setBusy] = useState(false);
  const s = status.data ?? getStatus();
  const ask = async (perms: (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS][]) => {
    setBusy(true);
    try { await PermissionsAndroid.requestMultiple(perms); await status.reload(); } finally { setBusy(false); }
  };
  const P = PermissionsAndroid.PERMISSIONS;

  const steps: Step[] = [
    { key: 'notif', bn: 'নোটিফিকেশন দেখানো', en: 'Show notifications', hintBn: 'জরুরি বার্তা জানাতে।', hintEn: 'To tell you about urgent messages.', ok: s.postNotifications, run: () => ask([P.POST_NOTIFICATIONS]) },
    { key: 'access', bn: 'চ্যাট অ্যাপের বার্তা পড়া', en: 'Read chat-app messages', hintBn: 'WhatsApp, Messenger, IMO, Telegram… থেকে বার্তা ধরতে। খুলে “সুমনের ভার্চুয়াল সহকারী” চালু করুন।', hintEn: 'To catch messages from WhatsApp, Messenger, IMO, Telegram… Turn on “Sumon’s Virtual Assistant” there.', ok: s.notificationAccess, run: () => { openNotificationAccess(); } },
    { key: 'sms', bn: 'SMS পাওয়া ও পাঠানো', en: 'Receive and send SMS', hintBn: 'আসা SMS ধরতে, আর ব্যস্ত থাকলে “পরে কল করছি” পাঠাতে।', hintEn: 'To catch SMS and send “I’ll call back”.', ok: s.smsReceive && s.smsSend, run: () => ask([P.RECEIVE_SMS, P.SEND_SMS]) },
    { key: 'calls', bn: 'মিসড কল ধরা', en: 'Catch missed calls', hintBn: 'কে কল করেছিল জানাতে।', hintEn: 'To tell you who called.', ok: s.phoneState && s.callLog, run: () => ask([P.READ_PHONE_STATE, P.READ_CALL_LOG]) },
    { key: 'battery', bn: 'ব্যাটারি সীমাহীন', en: 'Unrestricted battery', hintBn: 'নইলে ফোন অ্যাপটি ঘুম পাড়িয়ে দেয় আর বার্তা দেরিতে আসে।', hintEn: 'Otherwise the phone puts the app to sleep and messages arrive late.', ok: s.batteryExempt, run: () => { openBatterySettings(); } },
    { key: 'dnd', bn: 'জরুরি অ্যালার্ম (সাইলেন্ট ভেদ)', en: 'Urgent alarm (beats silent mode)', hintBn: '“ডোন্ট ডিস্টার্ব অ্যাক্সেস” দিলে পরিবারের জরুরি বার্তা সাইলেন্টেও বাজবে।', hintEn: 'Grant “Do Not Disturb access” so urgent family messages ring even on silent.', ok: s.dndAccess, run: () => { openDndAccess(); } },
  ];
  const done = steps.filter((x) => x.ok).length;

  return (
    <Page title={bn ? 'সেটআপ' : 'Setup'} subtitle={bn ? `${done}/${steps.length} ধাপ শেষ` : `${done}/${steps.length} steps done`} bottomPadding={48}>
      {steps.map((st) => (
        <Card key={st.key}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <Text style={{ flex: 1, fontWeight: '700' }}>{bn ? st.bn : st.en}</Text>
            <AppBadge tone={st.ok ? 'success' : 'warning'} label={st.ok ? (bn ? 'চালু ✓' : 'On ✓') : (bn ? 'বাকি' : 'Todo')} />
          </View>
          <Text style={{ marginTop: 6, opacity: 0.8, lineHeight: 22 }}>{bn ? st.hintBn : st.hintEn}</Text>
          {!st.ok ? <View style={{ marginTop: 10 }}><AppButton label={bn ? 'চালু করুন' : 'Turn on'} loading={busy} onPress={() => void st.run()} /></View> : null}
        </Card>
      ))}
      <Card title={bn ? 'পরীক্ষা' : 'Test'}>
        <Text style={{ marginBottom: 10, opacity: 0.8 }}>{bn ? 'ফোন সাইলেন্টে রেখে চাপুন — জরুরি অ্যালার্ম বাজা উচিত।' : 'Put the phone on silent and press — the urgent alarm should ring.'}</Text>
        <AppButton variant="secondary" icon="bell-ring-outline" label={bn ? 'জরুরি অ্যালার্ম পরীক্ষা' : 'Test urgent alarm'} onPress={() => { testAlert(); showSnackbar(bn ? 'অ্যালার্ম পাঠানো হয়েছে' : 'Alarm sent', 'info'); }} />
      </Card>
      <AppButton label={bn ? 'শেষ — হোমে যাই' : 'Finish — go Home'} icon="home-variant" onPress={() => { startService(); router.replace('/' as never); }} />
    </Page>
  );
}
