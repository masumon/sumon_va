import { useEffect, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { Card, Field, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { Page } from '../src/va/Page';
import { InfoHint } from '../src/va/InfoHint';
import { BrandMark, PoweredBy } from '../src/va/BrandMark';
import { loginPassword, loginRequest, loginTelegramPoll, loginTelegramRequest, loginVerify, passkeyLogin } from '../modules/va-bridge';
import { SERVER } from '../src/va/config';
import { bd } from '../src/va/bd';

type Step = 'choose' | 'telegram' | 'mail' | 'mailcode' | 'password' | 'totp' | 'phone' | 'phonecode' | 'phonetotp';

/** Bangla digits to Latin, so a number typed as ০১৭… is read like 017…. */
const latin = (v: string) => v.replace(/[০-৯]/gu, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
const BD_PHONE = /^(?:\+?88)?01[3-9]\d{8}$/;
type TgState = 'asking' | 'waiting' | 'denied' | 'expired' | 'error';

/**
 * Sign in. The owner picks the way he likes best; every way ends the same: this phone gets its OWN key and is remembered, so the
 * next time only the app lock (PIN / fingerprint) opens it.
 *   1. Telegram: one tap in his own bot (no password).   2. A pairing code made in the admin website.
 *   3. Google passkey (coming).   4. A 6-digit code by e-mail.   5. E-mail and password (+ authenticator code if the admin uses one).
 */
export default function LoginScreen() {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [step, setStep] = useState<Step>('choose');
  const db = useSQLiteContext();
  const [email, setEmail] = useState('');
  // The e-mail used last time is remembered on this phone, so a later sign-in only needs the password (or its autofill).
  useEffect(() => {
    let alive = true;
    db.getFirstAsync<{ value: string }>("SELECT value FROM app_preferences WHERE key = 'lastLoginEmail'")
      .then((row) => { if (alive && row?.value) setEmail((cur) => cur || row.value); }).catch(() => {});
    return () => { alive = false; };
  }, [db]);
  const rememberEmail = () => { void db.runAsync("INSERT INTO app_preferences (key, value) VALUES ('lastLoginEmail', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", email.trim()).catch(() => {}); };
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [mailCode, setMailCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [pkNone, setPkNone] = useState(false);
  const fail = (msg?: string) => showSnackbar(msg || (bn ? 'কাজটি হয়নি' : 'That did not work'), 'danger');
  const name = bn ? 'আমার ফোন' : 'My phone';

  // ── Telegram approval ──
  const [tgState, setTgState] = useState<TgState>('asking');
  const [tgId, setTgId] = useState('');
  const [tgCode, setTgCode] = useState('');
  const [tgLeft, setTgLeft] = useState(120);
  const [tgError, setTgError] = useState('');
  const startTelegram = async () => {
    setStep('telegram'); setTgState('asking'); setTgError(''); setTgId(''); setTgCode('');
    try {
      const r = await loginTelegramRequest(SERVER, name);
      if (!r.ok || !r.requestId) { setTgError(r.error ?? ''); setTgState('error'); return; }
      setTgId(r.requestId); setTgCode(r.code ?? ''); setTgLeft(r.expiresIn ?? 120); setTgState('waiting');
    } catch {
      const msg = bn ? 'সংযোগ হয়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন, অথবা অন্যভাবে ঢুকুন' : 'Could not connect. Check the internet and try again, or use another way';
      setTgError(msg); setTgState('error'); showSnackbar(msg, 'danger');
    }
  };
  useEffect(() => {
    if (step !== 'telegram' || tgState !== 'waiting' || !tgId) return undefined;
    let stop = false;
    const tick = async () => {
      let r: Awaited<ReturnType<typeof loginTelegramPoll>>;
      try { r = await loginTelegramPoll(SERVER, tgId); } catch {
        if (stop) return;
        stop = true;
        const msg = bn ? 'অনুমোদনের খবর আনা যায়নি। আবার চেষ্টা করুন' : 'Could not check the approval. Please try again';
        setTgError(msg); setTgState('error'); showSnackbar(msg, 'danger');
        return;
      }
      if (stop) return;
      if (r.status === 'approved') { stop = true; router.replace('/lock-setup' as never); return; }
      if (r.status === 'denied') { setTgState('denied'); return; }
      if (r.status === 'expired' || r.status === 'used') { setTgState('expired'); return; }
      // pending, or a short network blip: keep waiting, count the time down
      setTgLeft((n) => { if (n <= 2) { setTgState('expired'); return 0; } return n - 2; });
    };
    const id = setInterval(() => { void tick(); }, 2000);
    return () => { stop = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, tgState, tgId]);

  // ── e-mail and password ──
  const signIn = async () => {
    setBusy(true);
    try {
      const r = await loginPassword(SERVER, email, password, step === 'totp' ? totp : null, name);
      if (r.ok) { rememberEmail(); router.replace('/lock-setup' as never); return; }
      if (r.needTotp) { setStep('totp'); return; }
      fail(r.error);
    } finally { setBusy(false); }
  };

  // ── e-mail code ──
  const sendMail = async () => {
    setBusy(true);
    try {
      const r = await loginRequest(SERVER, email);
      if (r.ok) { setStep('mailcode'); showSnackbar(bn ? 'কোড পাঠানো হয়েছে, ইমেইল দেখুন' : 'Code sent — check your e-mail', 'success'); } else fail(r.error);
    } finally { setBusy(false); }
  };
  const verifyMail = async () => {
    setBusy(true);
    try {
      const r = await loginVerify(SERVER, email, mailCode, null, name);
      if (r.ok) { rememberEmail(); router.replace('/lock-setup' as never); return; }
      if (r.needTotp) { setStep('totp'); showSnackbar(bn ? 'এবার পাসওয়ার্ড দিয়ে ঢুকুন' : 'Please sign in with your password', 'info'); return; }
      fail(r.error);
    } finally { setBusy(false); }
  };

  // ── passkey / fingerprint ──
  const signInPasskey = async () => {
    setBusy(true); setPkNone(false);
    try {
      const r = await passkeyLogin(SERVER, name);
      if (r.ok) { router.replace('/lock-setup' as never); return; }
      if (r.cancelled) return;
      if (/no passkey|no credential|not registered|not found|পাসকি নেই|কোনো পাসকি|NoCredential/i.test(r.error ?? '')) setPkNone(true);
      fail(r.error);
    } catch { fail(); } finally { setBusy(false); }
  };

  // ── phone number: the 6-digit code goes to the owner's e-mail and Telegram ──
  const phoneClean = latin(phone).replace(/[\s-]/g, '');
  const phoneOk = BD_PHONE.test(phoneClean);
  const sendPhone = async () => {
    setBusy(true);
    try {
      const r = await loginRequest(SERVER, phoneClean);
      if (r.ok) { setStep('phonecode'); showSnackbar(bn ? 'কোড পাঠানো হয়েছে, ইমেইল ও Telegram দেখুন' : 'Code sent — check your e-mail and Telegram', 'success'); } else fail(r.error);
    } catch { fail(); } finally { setBusy(false); }
  };
  const verifyPhone = async () => {
    setBusy(true);
    try {
      const r = await loginVerify(SERVER, phoneClean, mailCode, step === 'phonetotp' ? totp : null, name);
      if (r.ok) { router.replace('/lock-setup' as never); return; }
      if (r.needTotp && step !== 'phonetotp') { setStep('phonetotp'); showSnackbar(bn ? 'এবার অথেনটিকেটর কোড দিন' : 'Now enter your authenticator code', 'info'); return; }
      fail(r.error);
    } catch { fail(); } finally { setBusy(false); }
  };

  const isEmail = /.+@.+\..+/.test(email.trim());
  const isPhone = !isEmail && email.replace(/\D/g, '').length >= 10;
  const back = <AppButton variant="ghost" icon="arrow-left" label={bn ? 'অন্যভাবে ঢুকুন' : 'Choose another way'} onPress={() => { setStep('choose'); setMailCode(''); setTotp(''); }} />;
  const emailField = <Field label={bn ? 'ইমেইল বা ফোন নম্বর' : 'E-mail or phone number'} value={email} onChangeText={setEmail} placeholder="you@example.com / 01XXXXXXXXX" autofill="email" />;

  return (
    <Page title={bn ? 'স্বাগতম' : 'Welcome'} subtitle={step === 'choose' ? (bn ? 'যেভাবে সহজ মনে হয়, সেভাবে ঢুকুন' : 'Sign in the way you like') : (bn ? 'আপনার ফোন চালু করুন' : 'Switch this phone on')} bottomPadding={40}>
      <View style={{ alignItems: 'center', marginVertical: 8 }}><BrandMark size={88} /></View>

      {step === 'choose' ? (
        <View style={{ gap: 10 }}>
          <AppButton label={bn ? 'Telegram-এ অনুমোদন (পাসওয়ার্ড ছাড়া)' : 'Approve in Telegram (no password)'} icon="send" onPress={() => void startTelegram()} />
          <View style={{ gap: 6 }}>
            <AppButton variant="secondary" loading={busy} label={bn ? 'Google পাসকি / আঙুলের ছাপ' : 'Google passkey / fingerprint'} icon="fingerprint" accessibilityLabel={bn ? 'Google পাসকি বা আঙুলের ছাপ দিয়ে ঢুকুন' : 'Sign in with Google passkey or fingerprint'} onPress={() => void signInPasskey()} />
            {pkNone ? <Text style={{ opacity: 0.8, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>প্রথমবার? অন্যভাবে ঢুকে “পাসকি বানান” চাপুন (লক-সেটআপ পাতায় বা সেটিংসে)</Text> : null}
          </View>
          <AppButton variant="secondary" label={bn ? 'ফোন নম্বর দিয়ে ঢুকুন' : 'Sign in with phone number'} icon="phone-outline" accessibilityLabel={bn ? 'ফোন নম্বর দিয়ে ঢুকুন' : 'Sign in with phone number'} onPress={() => setStep('phone')} />
          <AppButton variant="secondary" label={bn ? 'জোড়া লাগানোর কোড (অ্যাডমিন সাইট থেকে)' : 'Pairing code (from the admin site)'} icon="link-variant" onPress={() => router.push('/pair' as never)} />
          <AppButton variant="secondary" label={bn ? 'ইমেইল ও পাসওয়ার্ড' : 'E-mail and password'} icon="lock-outline" onPress={() => setStep('password')} />
          <InfoHint text={bn ? 'একবার ঢুকলে এই ফোন মনে রাখবে। পরের বার শুধু PIN বা আঙুলের ছাপ লাগবে। ফোন হারালে অ্যাডমিন সাইট থেকে এক চাপে এর ঢোকা বন্ধ করা যায়।' : 'Once signed in, this phone is remembered; next time only your PIN or fingerprint is needed. If the phone is lost, you can cut it off from the admin site with one tap.'} />
        </View>
      ) : null}

      {step === 'telegram' ? (
        <View style={{ gap: 10 }}>
          <Card>
            {tgState === 'asking' ? <Text>{bn ? 'আপনার Telegram বটকে জানাচ্ছি…' : 'Telling your Telegram bot…'}</Text> : null}
            {tgState === 'waiting' ? (
              <>
                <Text style={{ lineHeight: 24 }}>{bn ? 'Telegram খুলে আপনার বটের বার্তায় এই কোড মিলিয়ে ✅ চাপুন:' : 'Open Telegram and tap ✅ on your bot’s message with this code:'}</Text>
                <Text style={{ fontSize: 44, fontWeight: '800', letterSpacing: 10, textAlign: 'center', marginVertical: 10 }}>{tgCode}</Text>
                <Text style={{ opacity: 0.7, textAlign: 'center' }}>{bn ? `অপেক্ষা করছি… ${tgLeft} সেকেন্ড বাকি` : `Waiting… ${tgLeft} s left`}</Text>
              </>
            ) : null}
            {tgState === 'denied' ? <Text style={{ lineHeight: 24 }}>{bn ? '❌ আপনি “না” চেপেছেন, তাই ঢোকা হয়নি।' : '❌ You pressed “No”, so this phone was not let in.'}</Text> : null}
            {tgState === 'expired' ? <Text style={{ lineHeight: 24 }}>{bn ? '⏱ সময় শেষ হয়ে গেছে। আবার চেষ্টা করুন।' : '⏱ Time ran out. Please try again.'}</Text> : null}
            {tgState === 'error' ? <Text style={{ lineHeight: 24 }}>{tgError || (bn ? 'অনুরোধ যায়নি। অন্য পথে ঢুকুন।' : 'The request did not go. Use another way.')}</Text> : null}
          </Card>
          {tgState === 'denied' || tgState === 'expired' || tgState === 'error' ? <AppButton icon="refresh" label={bn ? 'আবার চেষ্টা করুন' : 'Try again'} onPress={() => void startTelegram()} /> : null}
          {back}
        </View>
      ) : null}

      {step === 'mail' ? (
        <View style={{ gap: 10 }}>
          <Card>
            {emailField}
            <View style={{ marginTop: 6 }}><InfoHint text={bn ? 'অ্যাডমিনের ইমেইলে একটা ৬ সংখ্যার কোড যাবে। পাসওয়ার্ড লাগবে না।' : 'A 6-digit code is sent to the admin e-mail. No password needed.'} /></View>
          </Card>
          <AppButton label={bn ? 'কোড পাঠান' : 'Send the code'} icon="email-fast-outline" loading={busy} disabled={!isEmail} onPress={() => void sendMail()} />
          {back}
        </View>
      ) : null}

      {step === 'mailcode' ? (
        <View style={{ gap: 10 }}>
          <Card>
            <Text style={{ marginBottom: 6 }}>{bn ? `${email} ঠিকানায় কোড পাঠানো হয়েছে।` : `A code was sent to ${email}.`}</Text>
            <Field label={bn ? '৬ সংখ্যার কোড' : '6-digit code'} value={mailCode} onChangeText={(v) => setMailCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="numeric" autofill="otp" autoFocus />
          </Card>
          <AppButton label={bn ? 'ঢুকুন' : 'Sign in'} icon="login" loading={busy} disabled={mailCode.length !== 6} onPress={() => void verifyMail()} />
          {back}
        </View>
      ) : null}

      {step === 'phone' ? (
        <View style={{ gap: 10 }}>
          <Card>
            <Field label={bn ? 'আপনার সেভ করা মোবাইল নম্বর' : 'Your saved mobile number'} value={phone} onChangeText={setPhone} placeholder="01XXXXXXXXX" keyboardType="numeric" autoFocus />
            {phone.length > 0 && !phoneOk ? <Text style={{ color: '#C13B2E', marginTop: 6 }}>{bn ? 'নম্বরটি ১১ সংখ্যার হতে হবে, যেমন ০১৭XXXXXXXX' : 'It must be an 11-digit number like 017XXXXXXXX'}</Text> : null}
            <View style={{ marginTop: 6 }}><InfoHint text={bn ? 'মালিকের ইমেইল ও Telegram-এ একটা ৬ সংখ্যার কোড যাবে। পাসওয়ার্ড লাগবে না।' : 'A 6-digit code is sent to the owner’s e-mail and Telegram. No password needed.'} /></View>
          </Card>
          <AppButton label={bn ? 'কোড পাঠান' : 'Send the code'} icon="message-text-outline" accessibilityLabel={bn ? 'ফোন নম্বরে কোড পাঠান' : 'Send the code for this phone number'} loading={busy} disabled={!phoneOk} onPress={() => void sendPhone()} />
          {back}
        </View>
      ) : null}

      {step === 'phonecode' || step === 'phonetotp' ? (
        <View style={{ gap: 10 }}>
          <Card>
            <Text style={{ marginBottom: 6 }}>{bn ? `${bd(phoneClean)} নম্বরের কোড মালিকের ইমেইল ও Telegram-এ পাঠানো হয়েছে।` : `The code for ${phoneClean} was sent to the owner’s e-mail and Telegram.`}</Text>
            <Field label={bn ? '৬ সংখ্যার কোড' : '6-digit code'} value={mailCode} onChangeText={(v) => setMailCode(latin(v).replace(/\D/g, '').slice(0, 6))} keyboardType="numeric" autofill="otp" autoFocus={step === 'phonecode'} />
            {step === 'phonetotp' ? (
              <>
                <Text style={{ marginTop: 6, marginBottom: 4 }}>{bn ? 'আপনার অ্যাকাউন্টে Google Authenticator চালু আছে। সেখানকার ৬ সংখ্যার কোডটি লিখুন।' : 'Your account uses Google Authenticator. Enter its 6-digit code.'}</Text>
                <Field label={bn ? 'অথেনটিকেটর কোড' : 'Authenticator code'} value={totp} onChangeText={(v) => setTotp(latin(v).replace(/\D/g, '').slice(0, 6))} keyboardType="numeric" autofill="otp" autoFocus />
              </>
            ) : null}
          </Card>
          <AppButton label={bn ? 'ঢুকুন' : 'Sign in'} icon="login" accessibilityLabel={bn ? 'কোড দিয়ে ঢুকুন' : 'Sign in with the code'} loading={busy} disabled={mailCode.length !== 6 || (step === 'phonetotp' && totp.length !== 6)} onPress={() => void verifyPhone()} />
          {back}
        </View>
      ) : null}

      {step === 'password' || step === 'totp' ? (
        <View style={{ gap: 10 }}>
          <Card>
            {emailField}
            <Field label={bn ? 'পাসওয়ার্ড' : 'Password'} value={password} onChangeText={setPassword} secure autofill="password" />
            {step === 'totp' ? (
              <>
                <Text style={{ marginTop: 6, marginBottom: 4 }}>{bn ? 'আপনার অ্যাকাউন্টে Google Authenticator চালু আছে। সেখানকার ৬ সংখ্যার কোডটি লিখুন।' : 'Your account uses Google Authenticator. Enter its 6-digit code.'}</Text>
                <Field label={bn ? 'অথেনটিকেটর কোড' : 'Authenticator code'} value={totp} onChangeText={(v) => setTotp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="numeric" autofill="otp" autoFocus />
              </>
            ) : null}
          </Card>
          <AppButton label={bn ? 'ঢুকুন' : 'Sign in'} icon="login" loading={busy} disabled={!(isEmail || isPhone) || !password || (step === 'totp' && totp.length !== 6)} onPress={() => void signIn()} />
          {back}
        </View>
      ) : null}

      <PoweredBy />
    </Page>
  );
}
