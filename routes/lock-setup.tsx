import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { Card, Field, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { useAppPreferences } from '../src/app/AppPreferences';
import { Page } from '../src/va/Page';
import { SERVER } from '../src/va/config';
import { passkeyRegister } from '../modules/va-bridge';

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

  const [pkBusy, setPkBusy] = useState(false);
  const makePasskey = async () => {
    setPkBusy(true);
    try {
      const r = await passkeyRegister(SERVER);
      if (r.ok) showSnackbar(bn ? 'পাসকি বানানো হয়েছে ✓' : 'Passkey created ✓', 'success');
      else if (!r.cancelled) showSnackbar(r.error || (bn ? 'পাসকি বানানো যায়নি' : 'Could not create the passkey'), 'danger');
    } catch { showSnackbar(bn ? 'পাসকি বানানো যায়নি' : 'Could not create the passkey', 'danger'); } finally { setPkBusy(false); }
  };

  const ok = pin.length >= 4 && pin === again;
  const save = async () => {
    await p.setAppLockPin(pin);
    showSnackbar(bn ? 'অ্যাপ-লক চালু হয়েছে ✓' : 'App lock is on ✓', 'success');
    router.replace('/tour' as never);
  };

  return (
    <Page title={bn ? 'অ্যাপে তালা দিন' : 'Protect the app'} subtitle={bn ? 'আপনার বার্তা শুধু আপনিই দেখতে পাবেন' : 'Only you can see your messages'} bottomPadding={40}>
      <Card title={bn ? 'PIN ঠিক করুন' : 'Set a PIN'}>
        <Text style={{ opacity: 0.75, marginBottom: 6 }}>{bn ? '৬ সংখ্যার একটি PIN দিন (৪ থেকে ৮ সংখ্যাও চলবে)। অ্যাপ খুলতে প্রতিবার এটা লাগবে।' : 'A 4–8 digit PIN, needed each time the app opens.'}</Text>
        <Field label="PIN" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))} keyboardType="numeric" autoFocus />
        <Field label={bn ? 'আবার লিখুন' : 'Repeat'} value={again} onChangeText={(v) => setAgain(v.replace(/\D/g, '').slice(0, 8))} keyboardType="numeric" />
        {again.length > 0 && pin !== again ? <Text style={{ color: '#C13B2E', marginTop: 6 }}>{bn ? 'দুটো মিলছে না' : 'They do not match'}</Text> : null}
      </Card>
      <Card>
        <ToggleRow icon="fingerprint" label={bn ? 'আঙুলের ছাপ বা মুখ দিয়ে খোলা' : 'Open with fingerprint / face'}
          hint={bio === false ? (bn ? 'এই ফোনে আঙুলের ছাপ বা ফেস আনলক সেট করা নেই। আগে ফোনের সেটিংসে গিয়ে সেট করুন।' : 'No fingerprint or face is set up on this phone yet.') : (bn ? 'PIN চালু থাকলে ফোনের আঙুলের ছাপ বা ফেস আনলকও কাজ করবে।' : 'With a PIN on, the phone’s own fingerprint/face works too.')}
          value={bio === true && p.appLockEnabled} onChange={() => { /* biometrics follow the PIN lock automatically */ }} />
      </Card>
      <Card title={bn ? 'পাসকি (ঐচ্ছিক)' : 'Passkey (optional)'}>
        <Text style={{ opacity: 0.75, marginBottom: 8 }}>{bn ? 'এই ফোনে পাসকি বানান (পরের বার আঙুলের ছাপ/ফেস দিয়ে ঢুকবেন)' : 'Create a passkey on this phone (next time you sign in with fingerprint/face)'}</Text>
        <AppButton variant="secondary" icon="fingerprint" loading={pkBusy} label={bn ? 'পাসকি বানান' : 'Create passkey'} accessibilityLabel={bn ? 'এই ফোনে পাসকি বানান' : 'Create a passkey on this phone'} onPress={() => void makePasskey()} />
      </Card>
      <AppButton label={bn ? 'লক চালু করুন' : 'Turn on lock'} icon="shield-lock-outline" disabled={!ok} onPress={() => void save()} />
      <AppButton variant="ghost" label={bn ? 'এখন নয়' : 'Not now'} onPress={() => router.replace('/tour' as never)} />
    </Page>
  );
}
