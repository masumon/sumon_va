import { useState } from 'react';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { Card, Field, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { Page } from '../src/va/Page';
import { pair } from '../modules/va-bridge';
import { SERVER } from '../src/va/config';

export default function PairScreen() {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [code, setCode] = useState('');
  const [name, setName] = useState(bn ? 'আমার ফোন' : 'My phone');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await pair(SERVER, code, name);
      if (r.ok) { showSnackbar(bn ? 'ফোন জোড়া লেগেছে ✓' : 'Phone paired ✓', 'success'); router.replace('/lock-setup' as never); }
      else showSnackbar(r.error ?? (bn ? 'জোড়া লাগেনি' : 'Pairing failed'), 'danger');
    } finally { setBusy(false); }
  };

  return (
    <Page title={bn ? 'কোড দিয়ে জোড়া লাগান' : 'Pair with a code'} subtitle={bn ? 'অ্যাডমিন থেকে পাওয়া কোড' : 'A code from the admin'} back={bn ? 'লগইন' : 'Sign in'} bottomPadding={48}>
      <Card title={bn ? 'কীভাবে কোড পাবেন' : 'How to get the code'}>
        <Text style={{ lineHeight: 24 }}>
          {bn
            ? '১. কম্পিউটার বা অন্য ফোনে আপনার অ্যাডমিনে লগইন করুন।\n২. “সুমনের ভার্চুয়াল সহকারী” পাতায় যান → “ফোন জোড়া লাগান” বোতাম চাপুন।\n৩. যে ৮ অক্ষরের কোড দেখাবে, নিচে লিখুন। কোডটি ১০ মিনিট চলবে, একবারই ব্যবহার হবে।'
            : '1. Sign in to your admin on a computer or another phone.\n2. Open the “Sumon’s Virtual Assistant” page → press “Pair a phone”.\n3. Type the 8-character code below. It works for 10 minutes, once.'}
        </Text>
      </Card>
      <Card>
        <Field label={bn ? 'জোড়া লাগানোর কোড' : 'Pairing code'} value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="ABCD2345" autoFocus />
        <Field label={bn ? 'এই ফোনের নাম' : 'Name for this phone'} value={name} onChangeText={setName} />
      </Card>
      <AppButton label={bn ? 'জোড়া লাগান' : 'Pair'} icon="link-variant" loading={busy} disabled={code.trim().length < 6} onPress={() => void submit()} />
    </Page>
  );
}
