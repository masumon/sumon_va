import { useState } from 'react';
import { View } from 'react-native';
import { AppText as Text, AppTextInput } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { Card, ChipGroup, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { va } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero } from '../src/va/Hero';
import { Page, Status } from '../src/va/Page';

const SCRIPTS: [string, string, string][] = [
  ['salam_reply', 'সালামের উত্তর', 'কেউ শুধু সালাম দিলে'],
  ['greeting', 'পরিচয় (প্রথম বার্তায়)', '{assistant} বসে যাবে'],
  ['away_notice', '“কল নয়, লিখুন” অনুরোধ', 'আপনি ফ্রি না থাকলে প্রতিটি উত্তরের সঙ্গে যায়'],
  ['ask_intro', 'প্রশ্ন করার শুরুতে', 'প্রথম প্রশ্নের আগে'],
  ['thanks', 'তথ্য নেওয়ার পর ধন্যবাদ', '{name} {owner} {reply_by} ব্যবহার করা যায়'],
  ['urgent_ack', 'জরুরি বার্তা পেলে', 'শুধু এটুকু বলা হয়, আর আপনাকে সাথে সাথে জানানো হয়'],
  ['repeat_ack', 'বারবার জিজ্ঞেস করলে (দুঃখ প্রকাশ করে)', 'কেউ তিনবার লিখেও উত্তর না পেলে'],
  ['call_notice', 'কল করেছিল বললে', '“ফোন দিলাম, ধরলেন না” ধরনের কথায়'],
  ['voice_ack', 'ভয়েস মেসেজ এলে', 'লেখায় বদলাতে না পারলে'],
  ['unknown_ack', 'উত্তর জানা না থাকলে', 'আন্দাজে কিছু বলে না'],
  ['identity_reply', '“আপনি কি মানুষ/বট?” জিজ্ঞেস করলে', 'সব সময় সত্যি উত্তর যায়, বন্ধ করা যায় না'],
  ['note_reply', 'আপনার লেখা নোট জানানো', '{note} = নোটের লেখা'],
];

type Lang = 'bn' | 'en';
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
      await va.saveAssistantConfig({ scripts: { [lang]: edits } });
      setEdits({});
      await cfg.reload();
      showSnackbar(bn ? 'সংরক্ষণ হয়েছে' : 'Saved', 'success');
    } catch (e) { showSnackbar(e instanceof Error ? e.message : '', 'danger'); }
  };

  return (
    <Page title={bn ? 'উত্তরের লেখা' : 'Reply wording'} subtitle={bn ? 'সহকারী যে কথাগুলো বলে' : 'The sentences the assistant says'} back={bn ? 'নিয়ম' : 'Rules'} onRefresh={cfg.reload} refreshing={cfg.loading && !!scripts}>
      <Status loading={cfg.loading && !scripts} error={scripts ? null : cfg.error} onRetry={cfg.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {scripts ? (
        <>
          <Hero icon="text-box-edit-outline" title={bn ? 'নিজের মতো করে লিখুন' : 'Make it sound like you'} subtitle={bn ? '{name} = ব্যক্তির নাম, {owner} = আপনার নাম, {reply_by} = কখন উত্তর পাবেন' : '{name} = their name, {owner} = your name, {reply_by} = when you will reply'} />
          <ChipGroup<Lang> options={['bn', 'en']} value={lang} labelOf={(l) => (l === 'bn' ? 'বাংলা' : 'English')} onChange={(l) => { if (l) { setLang(l); setEdits({}); } }} />
          {SCRIPTS.map(([key, title, hint]) => (
            <Card key={key} title={title}>
              <Text style={{ opacity: 0.65, fontSize: 12, marginBottom: 6 }}>{hint}</Text>
              <AppTextInput multiline value={edits[key] ?? scripts[lang]?.[key] ?? ''} onChangeText={(v) => setEdits((e) => ({ ...e, [key]: v }))}
                editable={key !== 'identity_reply' || true} style={{ minHeight: 70, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, textAlignVertical: 'top' }} />
            </Card>
          ))}
          <View style={{ gap: 8 }}>
            <AppButton label={bn ? `সংরক্ষণ করুন${dirty ? ` (${dirty}টি বদল)` : ''}` : `Save${dirty ? ` (${dirty} changes)` : ''}`} icon="content-save-outline" disabled={!dirty} onPress={() => void save()} />
            {dirty ? <AppButton variant="ghost" label={bn ? 'বদল বাতিল' : 'Discard changes'} onPress={() => setEdits({})} /> : null}
          </View>
        </>
      ) : null}
    </Page>
  );
}
