import { useState } from 'react';
import { View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { AppText as Text } from '../ui/AppText';
import { AppButton } from '../ui/AppSurface';
import { AppConfirmDialog, useAppFeedback } from '../ui/AppFeedback';
import { Card, ChipGroup, useKit } from '../ui/AppKit';
import { va } from './api';

/**
 * Import a saved chat (WhatsApp "Export chat" .txt) so the assistant learns who this person is and how to talk to them, and
 * export this person's chat as a text file. Only a short summary of the person is kept; the imported text itself is not stored.
 */
export function ChatTransfer({ contactId, isPrivate, onLearned }: { contactId: string; isPrivate: boolean; onLearned: () => void }) {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [busy, setBusy] = useState<'import' | 'export' | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [ask, setAsk] = useState(false);
  const fail = (e: unknown) => showSnackbar(e instanceof Error ? e.message : (bn ? 'কাজটি হয়নি' : 'That did not work'), 'danger');

  const learn = async (chat: string, speaker?: string, allow = consent) => {
    setBusy('import');
    try {
      const r = await va.learnChat(contactId, chat, speaker, allow);
      if (r.need_consent) { setAsk(true); return; }
      if (r.need_owner) { setSpeakers(r.speakers ?? []); return; }
      setText(null); setSpeakers([]);
      showSnackbar(bn ? `চেনা হয়েছে, ${r.messages ?? ''}টি বার্তা পড়া হয়েছে ✓` : `Learned (${r.messages ?? ''} messages read) ✓`, 'success');
      onLearned();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const pick = async () => {
    setBusy('import');
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['text/plain', 'application/zip', '*/*'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const chat = await FileSystem.readAsStringAsync(res.assets[0].uri);
      setText(chat);
      await learn(chat);
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const exportIt = async () => {
    setBusy('export');
    try {
      const r = await va.exportChat(contactId);
      if (!r.messages) { showSnackbar(bn ? 'এই ব্যক্তির সাথে এখনও কোনো চ্যাট জমা হয়নি' : 'No chat saved with this person yet', 'info'); return; }
      const path = `${FileSystem.cacheDirectory}${r.filename}`;
      await FileSystem.writeAsStringAsync(path, r.text);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: bn ? 'চ্যাট এক্সপোর্ট' : 'Export chat' });
      else showSnackbar(bn ? 'এই ফোনে শেয়ার করা যাচ্ছে না' : 'Sharing is not available on this phone', 'danger');
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  return (
    <Card title={bn ? 'চ্যাট ইমপোর্ট ও এক্সপোর্ট' : 'Import and export chat'}>
      <Text style={{ opacity: 0.8, lineHeight: 21, marginBottom: 8 }}>{bn ? 'আগের চ্যাট দিন (WhatsApp, তারপর চ্যাট, ⋮, Export chat)। সহকারী পড়ে বুঝে নেবে এই ব্যক্তি কে, আপনাকে কী বলে ডাকেন, কীভাবে কথা বলতে হবে। পরের বার সেভাবেই উত্তর দেবে। শুধু ছোট একটা পরিচিতি রাখা হয়, চ্যাটের লেখা রাখা হয় না।' : 'Give it an earlier chat (WhatsApp → chat → ⋮ → Export chat) and the assistant learns who this person is, what they call you and how to talk to them, then answers in that style. Only a short profile is kept, never the chat text.'}</Text>
      {speakers.length > 0 && text ? (
        <View style={{ marginBottom: 8 }}>
          <Text style={{ fontWeight: '700', marginBottom: 6 }}>{bn ? 'এই চ্যাটে কোনটি আপনার নাম?' : 'Which name in this chat is you?'}</Text>
          <ChipGroup<string> options={speakers} value={null} labelOf={(s) => s} onChange={(s) => { if (s) void learn(text, s); }} />
        </View>
      ) : null}
      <View style={{ gap: 8 }}>
        <AppButton icon="file-import-outline" label={bn ? 'চ্যাট ইমপোর্ট করুন (ফাইল বাছুন)' : 'Import a chat file'} loading={busy === 'import'} onPress={() => void pick()} />
        <AppButton variant="secondary" icon="file-export-outline" label={bn ? 'এই ব্যক্তির চ্যাট এক্সপোর্ট করুন' : 'Export this person’s chat'} loading={busy === 'export'} onPress={() => void exportIt()} />
      </View>
      {isPrivate ? <Text style={{ opacity: 0.65, fontSize: 12, marginTop: 8 }}>{bn ? 'এটি ব্যক্তিগত বা পরিবারের চ্যাট। AI-কে পড়তে দেওয়ার আগে প্রতিবার আপনার অনুমতি চাওয়া হবে।' : 'This is a private/family chat: you will be asked each time before the AI may read it.'}</Text> : null}
      <AppConfirmDialog visible={ask} icon="shield-account-outline" title={bn ? 'AI-কে এই চ্যাট পড়তে দেবেন?' : 'Let the AI read this chat?'}
        description={bn ? 'এটি ব্যক্তিগত বা পরিবারের চ্যাট। ফোন নম্বর ও ইমেইল মুছে শুধু শেখার জন্য AI-কে পাঠানো হবে, চ্যাট রাখা হবে না। আপনি কি রাজি?' : 'This is a private or family chat. Numbers and e-mails are removed and the text goes to the AI only to learn from; it is not saved. Do you agree?'}
        cancelLabel={bn ? 'না, থাক' : 'No'} confirmLabel={bn ? 'হ্যাঁ, পড়ুক' : 'Yes, read it'}
        onCancel={() => { setAsk(false); setText(null); }} onConfirm={() => { setAsk(false); setConsent(true); if (text) void learn(text, undefined, true); }} />
    </Card>
  );
}
