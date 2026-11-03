import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { AppBadge, AppButton } from '../ui/AppSurface';
import { AppIcon } from '../ui/AppIcon';
import { Card, Field, ToggleRow, useKit } from '../ui/AppKit';
import type { Tag } from './api';

/** Quick labels you can tap; anything else can be typed. */
const QUICK = [
  { bn: 'ক্লায়েন্ট', en: 'Client', important: true }, { bn: 'মামলা', en: 'Case', important: true }, { bn: 'NID', en: 'NID', important: false },
  { bn: 'আত্মীয়', en: 'Relative', important: false }, { bn: 'বাকি টাকা', en: 'Owes money', important: true }, { bn: 'গুরুত্বপূর্ণ', en: 'Important', important: true },
];

/** Notes about a person that you write yourself — "ক্লায়েন্ট", "মামলা: ১২/২৪", "NID: …". Important ones are shown first and make the assistant tell you about this person. */
export function TagEditor({ tags, onSave }: { tags: Tag[]; onSave: (tags: Tag[]) => void | Promise<unknown> }) {
  const { bn, colors } = useKit();
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [important, setImportant] = useState(false);
  const add = (t: Tag) => { if (t.label.trim() && !tags.some((x) => x.label === t.label.trim())) void onSave([...tags, { ...t, label: t.label.trim(), value: t.value.trim() }]); setLabel(''); setValue(''); setImportant(false); };
  const remove = (l: string) => void onSave(tags.filter((t) => t.label !== l));
  const flip = (l: string) => void onSave(tags.map((t) => (t.label === l ? { ...t, important: !t.important } : t)));
  return (
    <Card title={bn ? 'এই ব্যক্তির ট্যাগ ও নোট' : 'Notes and tags for this person'}>
      <Text style={{ opacity: 0.75, marginBottom: 8, fontSize: 13 }}>{bn ? 'ক্লায়েন্ট, মামলা, NID, যা খুশি লিখে রাখুন। ★ দেওয়াগুলো আপনাকে আগে দেখানো হবে।' : 'Client, case, NID — write anything. Starred ones are shown to you first.'}</Text>
      {tags.length === 0 ? <Text style={{ opacity: 0.6 }}>{bn ? 'এখনও কোনো ট্যাগ নেই।' : 'No tags yet.'}</Text> : null}
      {[...tags].sort((a, b) => Number(b.important) - Number(a.important)).map((t) => (
        <View key={t.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'গুরুত্ব বদলান' : 'Toggle important'} onPress={() => flip(t.label)} hitSlop={8}>
            <AppIcon name={t.important ? 'star' : 'star-outline'} size={24} color={t.important ? colors.warning : colors.textMuted} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>{t.label}</Text>
            {t.value ? <Text style={{ opacity: 0.8 }}>{t.value}</Text> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'মুছুন' : 'Delete'} onPress={() => remove(t.label)} hitSlop={8}><AppIcon name="close-circle-outline" size={22} color={colors.textMuted} /></Pressable>
        </View>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 }}>
        {QUICK.filter((q) => !tags.some((t) => t.label === (bn ? q.bn : q.en))).map((q) => (
          <Pressable key={q.en} accessibilityRole="button" onPress={() => add({ label: bn ? q.bn : q.en, value: '', important: q.important })}><AppBadge tone="primary" label={`＋ ${bn ? q.bn : q.en}`} /></Pressable>
        ))}
      </View>
      <Field label={bn ? 'নিজের লেখা ট্যাগ' : 'Your own tag'} value={label} onChangeText={setLabel} placeholder={bn ? 'যেমন: মামলা, NID, ঠিকাদার' : 'e.g. Case, NID, Contractor'} />
      <Field label={bn ? 'পাশে কিছু লিখবেন? (না লিখলেও চলবে)' : 'Note beside it (optional)'} value={value} onChangeText={setValue} placeholder={bn ? 'যেমন: ১২৩৪ ৫৬৭৮ ৯০' : 'e.g. 1234 5678 90'} />
      <ToggleRow icon="star-outline" label={bn ? 'গুরুত্বপূর্ণ (আমাকে আগে দেখান)' : 'Important (show me first)'} value={important} onChange={setImportant} />
      <View style={{ marginTop: 8 }}><AppButton label={bn ? 'সেভ করুন' : 'Save'} icon="content-save-outline" disabled={!label.trim()} onPress={() => add({ label, value, important })} /></View>
    </Card>
  );
}
