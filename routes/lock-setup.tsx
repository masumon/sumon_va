import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { Card, Field, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { useAppPreferences } from '../src/app/AppPreferences';
import { Page } from '../src/va/Page';

/** Right after sign-in: lock the app with a PIN (and the fingerprint/face the phone already has). Skippable, but recommended. */
export default function LockSetupScreen() {
  const { bn } = useKit();
  const p = useAppPreferences();
  const { showSnackbar } = useAppFeedback();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [bio, setBio] = useState<boolean | null>(null);
  useEffect(() => {
    void (async () => setBio((await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())))();
  }, []);

  const ok = pin.length >= 4 && pin === again;
  const save = async () => {
    await p.setAppLockPin(pin);
    showSnackbar(bn ? 'অ্যাপ-লক চালু হয়েছে ✓' : 'App lock is on ✓', 'success');
    router.replace('/setup' as never);
  };

  return (
    <Page title={bn ? 'অ্যাপ সুরক্ষিত করুন' : 'Protect the app'} subtitle={bn ? 'আপনার বার্তা শুধু আপনিই দেখবেন' : 'Only you can see your messages'} bottomPadding={40}>
      <Card title={bn ? 'PIN দিন' : 'Set a PIN'}>
        <Text style={{ opacity: 0.75, marginBottom: 6 }}>{bn ? '৪ থেকে ৮ সংখ্যার একটি PIN। অ্যাপ খুলতে এটা লাগবে।' : 'A 4–8 digit PIN, needed each time the app opens.'}</Text>
        <Field label="PIN" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))} keyboardType="numeric" autoFocus />
        <Field label={bn ? 'আবার লিখুন' : 'Repeat'} value={again} onChangeText={(v) => setAgain(v.replace(/\D/g, '').slice(0, 8))} keyboardType="numeric" />
        {again.length > 0 && pin !== again ? <Text style={{ color: '#C13B2E', marginTop: 6 }}>{bn ? 'দুটো মিলছে না' : 'They do not match'}</Text> : null}
      </Card>
      <Card>
        <ToggleRow icon="fingerprint" label={bn ? 'আঙুলের ছাপ / মুখ দিয়ে খোলা' : 'Open with fingerprint / face'}
          hint={bio === false ? (bn ? 'এই ফোনে আঙুলের ছাপ বা মুখ-চেনা সেট করা নেই — ফোনের সেটিংসে আগে সেট করুন।' : 'No fingerprint or face is set up on this phone yet.') : (bn ? 'PIN চালু থাকলে ফোনের নিজস্ব আঙুলের ছাপ/মুখ-চেনাও কাজ করবে।' : 'With a PIN on, the phone’s own fingerprint/face works too.')}
          value={bio === true && p.appLockEnabled} onChange={() => { /* biometrics follow the PIN lock automatically */ }} />
      </Card>
      <AppButton label={bn ? 'লক চালু করুন' : 'Turn on lock'} icon="shield-lock-outline" disabled={!ok} onPress={() => void save()} />
      <AppButton variant="ghost" label={bn ? 'এখন নয়' : 'Not now'} onPress={() => router.replace('/setup' as never)} />
    </Page>
  );
}
