import { useState } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { Card, Field, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { va } from '../src/va/api';
import { Hero } from '../src/va/Hero';
import { Page } from '../src/va/Page';
import { PRIORITY } from '../src/va/labels';

type Result = Awaited<ReturnType<typeof va.simulate>>;

/** Try the assistant safely: write a message as if a person sent it and see what it would do. Nothing is sent to anyone. */
export default function SimulateScreen() {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [ai, setAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const pr = r ? (PRIORITY[r.priority] ?? PRIORITY[5]!) : null;

  const run = async () => {
    setBusy(true);
    try { setR(await va.simulate(text.trim(), name.trim(), ai)); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', 'danger'); }
    finally { setBusy(false); }
  };

  return (
    <Page title={bn ? 'পরীক্ষা' : 'Test'} subtitle={bn ? 'সহকারী কী করত — কাউকে কিছু পাঠানো হয় না' : 'What the assistant would do — nothing is sent'} back={bn ? 'নিয়ম' : 'Rules'}>
      <Hero icon="flask-outline" title={bn ? 'নিরাপদে পরীক্ষা করুন' : 'Try it safely'} subtitle={bn ? 'কেউ আপনাকে কিছু লিখলে সহকারী কী উত্তর দিত, দেখে নিন' : 'See how the assistant would answer a message'} />
      <Card>
        <Field label={bn ? 'যিনি লিখছেন (ঐচ্ছিক নাম)' : 'Who is writing (optional name)'} value={name} onChangeText={setName} />
        <Field label={bn ? 'বার্তা' : 'Message'} value={text} onChangeText={setText} multiline placeholder={bn ? 'যেমন: ভাই, একটা ওয়েবসাইট বানাতে কত খরচ পড়বে?' : 'e.g. How much for a website?'} />
        <ToggleRow icon="brain" label={bn ? 'AI দিয়ে বোঝা' : 'Understand with AI'} value={ai} onChange={setAi} />
        <View style={{ marginTop: 8 }}><AppButton label={bn ? 'দেখি কী হয়' : 'Show me'} icon="play" loading={busy} disabled={!text.trim()} onPress={() => void run()} /></View>
      </Card>
      {r && pr ? (
        <Card title={bn ? 'সহকারীর সিদ্ধান্ত' : "The assistant's decision"}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <AppBadge tone={pr.tone} label={bn ? pr.bn : pr.en} />
            <AppBadge tone={r.action === 'send' ? 'success' : r.action === 'draft' ? 'warning' : 'neutral'} label={r.action === 'send' ? (bn ? 'নিজে পাঠাত' : 'Would send') : r.action === 'draft' ? (bn ? 'খসড়া করত' : 'Would draft') : (bn ? 'চুপ থাকত' : 'Would stay silent')} />
            {r.notify ? <AppBadge tone="danger" label={bn ? 'আপনাকে জানাত' : 'Would alert you'} /> : null}
            {r.ai_used ? <AppBadge tone="primary" label="AI" /> : null}
          </View>
          {r.reply ? <Text style={{ lineHeight: 23, fontWeight: '600' }}>{r.reply}</Text> : <Text style={{ opacity: 0.7 }}>{bn ? 'কোনো উত্তর লিখত না।' : 'It would write no reply.'}</Text>}
          {r.summary ? <Text style={{ marginTop: 8, opacity: 0.8 }}>{bn ? 'সারাংশ: ' : 'Summary: '}{r.summary}</Text> : null}
          {r.note ? <Text style={{ marginTop: 4, opacity: 0.7, fontSize: 12 }}>{r.note}</Text> : null}
        </Card>
      ) : null}
    </Page>
  );
}
