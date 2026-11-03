import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { Card, Field, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { Page } from '../src/va/Page';
import { BrandMark, PoweredBy } from '../src/va/BrandMark';
import { loginPassword, loginRequest, loginVerify } from '../modules/va-bridge';
import { SERVER } from '../src/va/config';

type Step = 'password' | 'totp' | 'mailcode';

/**
 * Sign in with the admin e-mail and password — the same ones as the admin website. Your phone's password manager (Google)
 * can fill and save them. If the admin uses an authenticator app (Google Authenticator) its 6-digit code is asked next.
 * Once signed in the phone is remembered: next time only the app lock (PIN/fingerprint) opens it.
 */
export default function LoginScreen() {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [mailCode, setMailCode] = useState('');
  const [busy, setBusy] = useState(false);
  const fail = (msg?: string) => showSnackbar(msg || (bn ? 'কাজটি হয়নি' : 'That did not work'), 'danger');
  const name = bn ? 'আমার ফোন' : 'My phone';

  const signIn = async () => {
    setBusy(true);
    try {
      const r = await loginPassword(SERVER, email, password, step === 'totp' ? totp : null, name);
      if (r.ok) { router.replace('/lock-setup' as never); return; }
      if (r.needTotp) { setStep('totp'); return; }
      fail(r.error);
    } finally { setBusy(false); }
  };

  const sendMail = async () => {
    setBusy(true);
    try {
      const r = await loginRequest(SERVER, email);
      if (r.ok) { setStep('mailcode'); showSnackbar(bn ? 'কোড পাঠানো হয়েছে — ইমেইল দেখুন' : 'Code sent — check your e-mail', 'success'); } else fail(r.error);
    } finally { setBusy(false); }
  };
  const verifyMail = async () => {
    setBusy(true);
    try {
      const r = await loginVerify(SERVER, email, mailCode, null, name);
      if (r.ok) { router.replace('/lock-setup' as never); return; }
      if (r.needTotp) { setStep('totp'); showSnackbar(bn ? 'এখন পাসওয়ার্ড দিয়েই ঢুকুন' : 'Please sign in with your password', 'info'); return; }
      fail(r.error);
    } finally { setBusy(false); }
  };

  const emailOk = /.+@.+\..+/.test(email.trim());
  return (
    <Page title={bn ? 'স্বাগতম' : 'Welcome'} subtitle={bn ? 'অ্যাডমিনের ইমেইল ও পাসওয়ার্ড দিয়ে ঢুকুন' : 'Sign in with your admin e-mail and password'} bottomPadding={40}>
      <View style={{ alignItems: 'center', marginVertical: 8 }}><BrandMark size={88} /></View>

      {step !== 'mailcode' ? (
        <Card>
          <Field label={bn ? 'ইমেইল' : 'E-mail'} value={email} onChangeText={setEmail} placeholder="you@example.com" autofill="email" />
          <Field label={bn ? 'পাসওয়ার্ড' : 'Password'} value={password} onChangeText={setPassword} secure autofill="password" />
          {step === 'totp' ? (
            <>
              <Text style={{ marginTop: 6, marginBottom: 4 }}>{bn ? 'আপনার অ্যাকাউন্টে Google Authenticator চালু আছে। সেখানকার ৬ সংখ্যার কোডটি দিন।' : 'Your account uses Google Authenticator. Enter its 6-digit code.'}</Text>
              <Field label={bn ? 'অথেনটিকেটর কোড' : 'Authenticator code'} value={totp} onChangeText={(v) => setTotp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="numeric" autofill="otp" autoFocus />
            </>
          ) : (
            <Text style={{ opacity: 0.7, fontSize: 13, marginTop: 6 }}>{bn ? 'এই ফোন একবার ঢুকলে মনে রাখবে। পরের বার শুধু PIN বা আঙুলের ছাপ লাগবে। পাসওয়ার্ড ম্যানেজার (Google) ব্যবহার করলে নিজে ভরে দেবে।' : 'Once signed in, this phone is remembered. Next time only your PIN or fingerprint is needed. Your password manager (Google) can fill this in.'}</Text>
          )}
        </Card>
      ) : (
        <Card>
          <Text style={{ marginBottom: 6 }}>{bn ? `${email} ঠিকানায় কোড পাঠানো হয়েছে।` : `A code was sent to ${email}.`}</Text>
          <Field label={bn ? '৬ সংখ্যার কোড' : '6-digit code'} value={mailCode} onChangeText={(v) => setMailCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="numeric" autofill="otp" autoFocus />
        </Card>
      )}

      {step === 'mailcode' ? (
        <View style={{ gap: 10 }}>
          <AppButton label={bn ? 'ঢুকুন' : 'Sign in'} icon="login" loading={busy} disabled={mailCode.length !== 6} onPress={() => void verifyMail()} />
          <AppButton variant="ghost" label={bn ? 'পাসওয়ার্ড দিয়ে ঢুকি' : 'Use my password instead'} onPress={() => setStep('password')} />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <AppButton label={bn ? 'ঢুকুন' : 'Sign in'} icon="login" loading={busy} disabled={!emailOk || !password || (step === 'totp' && totp.length !== 6)} onPress={() => void signIn()} />
          <AppButton variant="ghost" label={bn ? 'পাসওয়ার্ড ভুলে গেছি — ইমেইলে কোড পাঠান' : 'Forgot password — e-mail me a code'} disabled={!emailOk || busy} onPress={() => void sendMail()} />
          <AppButton variant="ghost" label={bn ? 'অ্যাডমিনের জোড়া-লাগানোর কোড আছে?' : 'Have a pairing code from the admin?'} onPress={() => router.push('/pair' as never)} />
        </View>
      )}
      <PoweredBy />
    </Page>
  );
}
