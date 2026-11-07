import { useState } from 'react';
import { View } from 'react-native';
import { AppText as Text, AppTextInput } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { Card, ChipGroup, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { va, errTone } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero } from '../src/va/Hero';
import { Page, Status } from '../src/va/Page';

const SCRIPTS: [string, string, string][] = [
  ['salam_reply', 'সালামের উত্তর', 'কেউ শুধু সালাম দিলে'],
  ['greeting', 'পরিচয় (প্রথম বার্তায়)', '«সহকারীর নাম» নিজে বসে যায়'],
  ['away_notice', '“কল নয়, লিখুন” অনুরোধ', 'আপনি ফ্রি না থাকলে প্রতিটি উত্তরের সঙ্গে যায়'],
  ['ask_intro', 'প্রশ্ন করার শুরুতে', 'প্রথম প্রশ্নের আগে'],
  ['thanks', 'তথ্য নেওয়ার পর ধন্যবাদ', '«তার নাম», «আপনার নাম», «উত্তরের সময়» লিখলে সহকারী নিজে বসিয়ে দেয়'],
  ['urgent_ack', 'জরুরি বার্তা পেলে', 'শুধু এটুকু বলা হয়, আর আপনাকে সাথে সাথে জানানো হয়'],
  ['repeat_ack', 'বারবার জিজ্ঞেস করলে (দুঃখ প্রকাশ করে)', 'কেউ তিনবার লিখেও উত্তর না পেলে'],
  ['call_notice', 'কল করেছিল বললে', '“ফোন দিলাম, ধরলেন না” ধরনের কথায়'],
  ['voice_ack', 'ভয়েস মেসেজ এলে', 'লেখায় বদলাতে না পারলে'],
  ['unknown_ack', 'উত্তর জানা না থাকলে', 'আন্দাজে কিছু বলে না'],
  ['identity_reply', '“আপনি কি মানুষ/বট?” জিজ্ঞেস করলে', 'সব সময় সত্যি উত্তর যায়, বন্ধ করা যায় না'],
  ['note_reply', 'আপনার লেখা নোট জানানো', '«নোট» জায়গায় আপনার নোটের লেখা বসে'],
];

type Lang = 'bn' | 'en';
/** The server's fill-in marks shown as plain words: the owner never sees {owner}; saving turns them back. */
const MARKS: [string, string, string][] = [
  ['{owner}', '«আপনার নাম»', '«your name»'], ['{name}', '«তার নাম»', '«their name»'], ['{assistant}', '«সহকারীর নাম»', '«assistant name»'],
  ['{reply_by}', '«উত্তরের সময়»', '«reply time»'], ['{status}', '«আপনার অবস্থা»', '«your status»'], ['{note}', '«নোট»', '«note»'],
];
const toPlain = (s: string, bn: boolean) => MARKS.reduce((x, [k, b, e]) => x.split(k).join(bn ? b : e), s);
const toMarks = (s: string) => MARKS.reduce((x, [k, b, e]) => x.split(b).join(k).split(e).join(k), s);
type Scripts = Record<Lang, Record<string, string>>;

/** The assistant's ready-made sentences, in Bangla and English. Edit any of them; the assistant fills {name}, {owner}, {reply_by} itself. */
export default function ScriptsScreen() {
  const { bn, colors } = useKit();
  const { showSnackbar } = useAppFeedback();
  const cfg = useLoad(() => va.assistantConfig(), 'assistant-config');
  const [lang, setLang] = useState<Lang>('bn');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const scripts = (cfg.data?.config as unknown as { scripts?: Scripts } | undefined)?.scripts;
  const dirty = Object.keys(edits).length;

  const save = async () => {
    try {
      await va.saveAssistantConfig({ scripts: { [lang]: Object.fromEntries(Object.entries(edits).map(([k, v]) => [k, toMarks(v)])) } });
      setEdits({});
      await cfg.reload();
      showSnackbar(bn ? 'সংরক্ষণ হয়েছে' : 'Saved', 'success');
    } catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
  };

  return (
    <Page title={bn ? 'সহকারীর বাঁধা উত্তর' : 'Ready answers'} subtitle={bn ? 'সহকারী যে কথাগুলো বলে' : 'The sentences the assistant says'} back={bn ? 'নিয়ম' : 'Rules'} onRefresh={cfg.reload} refreshing={cfg.loading && !!scripts}
      footer={scripts ? (<View style={{ gap: 8 }}>
            <AppButton label={bn ? `সংরক্ষণ করুন${dirty ? ` (${dirty}টি বদল)` : ''}` : `Save${dirty ? ` (${dirty} changes)` : ''}`} icon="content-save-outline" disabled={!dirty} onPress={() => void save()} />
            {dirty ? <AppButton variant="ghost" label={bn ? 'বদল বাতিল' : 'Discard changes'} onPress={() => setEdits({})} /> : null}
          </View>) : undefined}>
      <Status loading={cfg.loading && !scripts} error={scripts ? null : cfg.error} onRetry={cfg.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {scripts ? (
        <>
          <Hero icon="text-box-edit-outline" title={bn ? 'নিজের মতো করে লিখুন' : 'Make it sound like you'} subtitle={bn ? '«তার নাম», «আপনার নাম» ধরনের লেখা যেমন আছে রাখুন: সহকারী নিজে আসল নাম বসায়।' : 'Keep words like «their name» as they are: the assistant fills in the real name.'} />
          <ChipGroup<Lang> options={['bn', 'en']} value={lang} labelOf={(l) => (l === 'bn' ? 'বাংলা' : 'English')} onChange={(l) => { if (l) { setLang(l); setEdits({}); } }} />
          {SCRIPTS.map(([key, title, hint]) => (
            <Card key={key} title={title}>
              <Text style={{ opacity: 0.65, fontSize: 12, marginBottom: 6 }}>{hint}</Text>
              <AppTextInput multiline value={edits[key] ?? toPlain(scripts[lang]?.[key] ?? '', bn)} onChangeText={(v) => setEdits((e) => ({ ...e, [key]: v }))}
                editable={key !== 'identity_reply' || true} style={{ minHeight: 70, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, textAlignVertical: 'top' }} />
            </Card>
          ))}
        </>
      ) : null}
    </Page>
  );
}
