import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { Card, Field, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { Page } from '../src/va/Page';
import { BrandMark, PoweredBy } from '../src/va/BrandMark';
import { loginRequest, loginVerify } from '../modules/va-bridge';
import { SERVER } from '../src/va/config';

type Step = 'email' | 'code' | 'totp';

/** Sign in with an e-mail code: type your admin e-mail, type the 6-digit code that arrives, done. */
export default function LoginScreen() {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  // "Send again" unlocks after a minute, matching the server's own limit.
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const fail = (msg?: string) => showSnackbar(msg || (bn ? 'কাজটি হয়নি' : 'That did not work'), 'danger');

  const sendCode = async () => {
    setBusy(true);
    try {
      const r = await loginRequest(SERVER, email);
      if (r.ok) { setStep('code'); setWait(60); showSnackbar(bn ? 'কোড পাঠানো হয়েছে — ইমেইল দেখুন' : 'Code sent — check your e-mail', 'success'); }
      else fail(r.error);
    } finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true);
    try {
      const r = await loginVerify(SERVER, email, code, step === 'totp' ? totp : null, bn ? 'আমার ফোন' : 'My phone');
      if (r.ok) { router.replace('/lock-setup' as never); return; }
      if (r.needTotp) { setStep('totp'); return; }
      fail(r.error);
    } finally { setBusy(false); }
  };

  return (
    <Page title={bn ? 'স্বাগতম' : 'Welcome'} subtitle={bn ? 'আপনার অ্যাডমিন ইমেইল দিয়ে ঢুকুন' : 'Sign in with your admin e-mail'} bottomPadding={40}>
      <View style={{ alignItems: 'center', marginVertical: 8 }}><BrandMark size={88} /></View>

      <Card>
        {step === 'email' ? (
          <>
            <Field label={bn ? 'ইমেইল' : 'E-mail'} value={email} onChangeText={setEmail} placeholder="you@example.com" />
            <Text style={{ opacity: 0.7, fontSize: 13, marginTop: 6 }}>{bn ? 'এই ইমেইলে ৬ সংখ্যার একটি কোড পাঠানো হবে। শুধু অ্যাডমিন (মালিক) ঢুকতে পারেন।' : 'A 6-digit code will be e-mailed to you. Only the admin (owner) can sign in.'}</Text>
          </>
        ) : null}
        {step === 'code' ? (
          <>
            <Text style={{ marginBottom: 6 }}>{bn ? `${email} ঠিকানায় কোড পাঠানো হয়েছে।` : `A code was sent to ${email}.`}</Text>
            <Field label={bn ? '৬ সংখ্যার কোড' : '6-digit code'} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="numeric" autoFocus />
          </>
        ) : null}
        {step === 'totp' ? (
          <>
            <Text style={{ marginBottom: 6 }}>{bn ? 'আপনার অ্যাকাউন্টে অথেনটিকেটর অ্যাপ চালু আছে। সেখানকার ৬ সংখ্যার কোডটি দিন।' : 'Your account uses an authenticator app. Enter its 6-digit code.'}</Text>
            <Field label={bn ? 'অথেনটিকেটর কোড' : 'Authenticator code'} value={totp} onChangeText={(v) => setTotp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="numeric" autoFocus />
          </>
        ) : null}
      </Card>

      {step === 'email' ? (
        <AppButton label={bn ? 'কোড পাঠান' : 'Send code'} icon="email-fast-outline" loading={busy} disabled={!/.+@.+\..+/.test(email.trim())} onPress={() => void sendCode()} />
      ) : (
        <View style={{ gap: 10 }}>
          <AppButton label={bn ? 'ঢুকুন' : 'Sign in'} icon="login" loading={busy} disabled={step === 'code' ? code.length !== 6 : totp.length !== 6} onPress={() => void verify()} />
          <AppButton variant="secondary" label={wait > 0 ? (bn ? `আবার কোড পাঠান (${wait}s)` : `Send again (${wait}s)`) : (bn ? 'আবার কোড পাঠান' : 'Send again')} disabled={wait > 0 || busy} onPress={() => void sendCode()} />
          <AppButton variant="ghost" label={bn ? 'ইমেইল বদলান' : 'Change e-mail'} onPress={() => { setStep('email'); setCode(''); setTotp(''); }} />
        </View>
      )}

      <AppButton variant="ghost" label={bn ? 'অ্যাডমিনের জোড়া-লাগানোর কোড আছে?' : 'Have a pairing code from the admin?'} onPress={() => router.push('/pair' as never)} />
      <PoweredBy />
    </Page>
  );
}
