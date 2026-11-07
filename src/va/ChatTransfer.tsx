import { useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { AppText as Text } from '../ui/AppText';
import { AppButton } from '../ui/AppSurface';
import { AppConfirmDialog, useAppFeedback } from '../ui/AppFeedback';
import { Card, ChipGroup, useKit } from '../ui/AppKit';
import { errTone, va } from './api';

const MAX_CHARS = 400_000;
const MIN_CHARS = 20;

/** Keep only safe characters of a file name (any script's letters, digits, - _ .); never a path. */
function safeFileName(name: unknown): string {
  const cleaned = String(name ?? '').replace(/\.\.+/g, '.').replace(/[^\p{L}\p{N}\-_.]/gu, '').replace(/^\.+/, '').slice(0, 80);
  return cleaned || 'chat.txt';
}

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
  const [tooLong, setTooLong] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const running = useRef(false);
  const fail = (e: unknown) => {
    // A timeout on the free server does not mean it failed: it may still be reading. Say so, so the owner does not press again at once.
    if (errTone(e) === 'info') { showSnackbar(bn ? 'সার্ভার এখনও কাজ করতে পারে। একটু অপেক্ষা করুন, তারপর কিছুক্ষণ বাদে দেখুন। সঙ্গে সঙ্গে আবার চাপবেন না' : 'The server may still be working. Wait a bit and check again later; do not press again right away', 'info'); return; }
    showSnackbar(e instanceof Error ? e.message : (bn ? 'কাজটি হয়নি' : 'That did not work'), errTone(e));
  };

  const learn = async (chat: string, speaker?: string, allow = consent) => {
    if (running.current) return;
    running.current = true;
    setBusy('import'); setSlow(true);
    try {
      const r = await va.learnChat(contactId, chat, speaker, allow);
      if (r.need_consent) { setAsk(true); return; }
      if (r.need_owner) { setSpeakers(r.speakers ?? []); return; }
      setText(null); setSpeakers([]);
      showSnackbar(bn ? (r.messages ? `চেনা হয়েছে, ${r.messages}টি বার্তা পড়া হয়েছে ✓` : 'চেনা হয়েছে ✓') : (r.messages ? `Learned (${r.messages} messages read) ✓` : 'Learned ✓'), 'success');
      onLearned();
    } catch (e) { fail(e); } finally { running.current = false; setBusy(null); setSlow(false); }
  };

  const pick = async () => {
    if (busy) return;
    setBusy('import');
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['text/plain', 'application/zip', '*/*'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      if (/\.zip$/i.test(asset.name ?? '') || asset.mimeType === 'application/zip') { showSnackbar(bn ? 'এটি ZIP ফাইল। WhatsApp থেকে “মিডিয়া ছাড়া” এক্সপোর্ট করে .txt ফাইলটি বেছে নিন' : 'That is a ZIP. Export from WhatsApp “without media” and pick the .txt file', 'info'); return; }
      if ((asset.size ?? 0) > 3_000_000) { showSnackbar(bn ? 'ফাইলটি অনেক বড় (৩ MB-র বেশি)। ছোট অংশ বেছে নিন' : 'The file is too large (over 3 MB). Pick a smaller part', 'info'); return; }
      const chat = await FileSystem.readAsStringAsync(asset.uri);
      void FileSystem.deleteAsync(asset.uri, { idempotent: true });
      if (chat.trim().length < MIN_CHARS) { showSnackbar(bn ? 'এই ফাইলে পড়ার মতো যথেষ্ট লেখা নেই। WhatsApp থেকে এক্সপোর্ট করা চ্যাটের .txt ফাইল বেছে নিন' : 'This file has too little text to read. Pick the .txt file exported from WhatsApp', 'info'); return; }
      if (chat.length > MAX_CHARS) { setTooLong(chat); return; }
      setText(chat);
      setBusy(null);
      await learn(chat);
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const useLast = () => {
    const chat = tooLong; setTooLong(null);
    if (!chat) return;
    let cut = chat.slice(chat.length - MAX_CHARS);
    const nl = cut.search(/\n/);
    if (nl >= 0 && nl < cut.length - MIN_CHARS) cut = cut.slice(nl + 1);
    setText(cut);
    void learn(cut);
  };

  const exportIt = async () => {
    setBusy('export');
    try {
      const r = await va.exportChat(contactId);
      if (!r.messages) { showSnackbar(bn ? 'এই ব্যক্তির সাথে এখনও কোনো চ্যাট জমা হয়নি' : 'No chat saved with this person yet', 'info'); return; }
      if (isPrivate) {
        const go = await new Promise<boolean>((resolve) => Alert.alert(
          bn ? 'ব্যক্তিগত চ্যাট পাঠাবেন?' : 'Share a private chat?',
          bn ? 'এটি ব্যক্তিগত বা পরিবারের চ্যাট। শেয়ার মেনুতে ভুল মানুষকে চাপলে চ্যাটটি তার কাছে চলে যাবে।' : 'This is a private or family chat. Tapping the wrong person in the share menu sends it to them.',
          [{ text: bn ? 'বাতিল' : 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: bn ? 'চালিয়ে যান' : 'Continue', onPress: () => resolve(true) }],
          { cancelable: true, onDismiss: () => resolve(false) },
        ));
        if (!go) return;
      }
      const path = `${FileSystem.cacheDirectory}${safeFileName(r.filename)}`;
      await FileSystem.writeAsStringAsync(path, r.text);
      try {
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: bn ? 'চ্যাট এক্সপোর্ট' : 'Export chat' });
        else showSnackbar(bn ? 'এই ফোনে শেয়ার করা যাচ্ছে না' : 'Sharing is not available on this phone', 'danger');
      } finally { void FileSystem.deleteAsync(path, { idempotent: true }); }
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  return (
    <Card title={bn ? 'সহকারীকে এই মানুষের কথার ধরন শেখান (চ্যাট ফাইল দিয়ে)' : 'Import and export chat'}>
      <Text style={{ opacity: 0.8, lineHeight: 21, marginBottom: 8 }}>{bn ? 'আগের চ্যাট দিন (WhatsApp, তারপর চ্যাট, ⋮, Export chat)। সহকারী পড়ে বুঝে নেবে এই ব্যক্তি কে, আপনাকে কী বলে ডাকেন, কীভাবে কথা বলতে হবে। পরের বার সেভাবেই উত্তর দেবে। শুধু ছোট একটা পরিচিতি রাখা হয়, চ্যাটের লেখা রাখা হয় না।' : 'Give it an earlier chat (WhatsApp → chat → ⋮ → Export chat) and the assistant learns who this person is, what they call you and how to talk to them, then answers in that style. Only a short profile is kept, never the chat text.'}</Text>
      {speakers.length > 0 && text ? (
        <View style={{ marginBottom: 8 }}>
          <Text style={{ fontWeight: '700', marginBottom: 6 }}>{bn ? 'এই চ্যাটে কোনটি আপনার নাম?' : 'Which name in this chat is you?'}</Text>
          <ChipGroup<string> options={speakers} value={null} labelOf={(s) => s} onChange={(s) => { if (s) void learn(text, s); }} />
        </View>
      ) : null}
      <View style={{ gap: 8 }}>
        <AppButton icon="file-import-outline" label={bn ? 'চ্যাট ইমপোর্ট করুন (ফাইল বাছুন)' : 'Import a chat file'} loading={busy === 'import'} disabled={busy !== null} onPress={() => void pick()} />
        <AppButton variant="secondary" icon="file-export-outline" label={bn ? 'এই ব্যক্তির চ্যাট এক্সপোর্ট করুন' : 'Export this person’s chat'} loading={busy === 'export'} disabled={busy !== null} onPress={() => void exportIt()} />
      </View>
      {slow ? <Text style={{ opacity: 0.75, fontSize: 13, lineHeight: 20, marginTop: 8 }}>{bn ? 'AI পড়ছে, ১ মিনিট পর্যন্ত লাগতে পারে। অ্যাপ বন্ধ করবেন না।' : 'The AI is reading; this can take up to a minute. Please do not close the app.'}</Text> : null}
      {isPrivate ? <Text style={{ opacity: 0.65, fontSize: 12, marginTop: 8 }}>{bn ? 'এটি ব্যক্তিগত বা পরিবারের চ্যাট। AI-কে পড়তে দেওয়ার আগে প্রতিবার আপনার অনুমতি চাওয়া হবে।' : 'This is a private/family chat: you will be asked each time before the AI may read it.'}</Text> : null}
      <AppConfirmDialog visible={ask} icon="shield-account-outline" title={bn ? 'AI-কে এই চ্যাট পড়তে দেবেন?' : 'Let the AI read this chat?'}
        description={bn ? 'এটি ব্যক্তিগত বা পরিবারের চ্যাট। ফোন নম্বর ও ইমেইল মুছে শুধু শেখার জন্য AI-কে পাঠানো হবে, চ্যাট রাখা হবে না। আপনি কি রাজি?' : 'This is a private or family chat. Numbers and e-mails are removed and the text goes to the AI only to learn from; it is not saved. Do you agree?'}
        cancelLabel={bn ? 'না, থাক' : 'No'} confirmLabel={bn ? 'হ্যাঁ, পড়ুক' : 'Yes, read it'}
        onCancel={() => { setAsk(false); setText(null); }} onConfirm={() => { setAsk(false); setConsent(true); if (text) void learn(text, undefined, true); }} />
      <AppConfirmDialog visible={tooLong !== null} icon="file-alert-outline" title={bn ? 'চ্যাটটি অনেক লম্বা' : 'This chat is too long'}
        description={bn ? 'একবারে এত লম্বা চ্যাট পড়ানো যায় না (সর্বোচ্চ ৪ লক্ষ অক্ষর)। শেষের দিকের ৪ লক্ষ অক্ষর (সবচেয়ে নতুন কথা) পড়াবেন?' : 'A chat this long cannot be read in one go (max 400,000 characters). Use the last 400,000 characters (the newest messages)?'}
        cancelLabel={bn ? 'না, থাক' : 'No'} confirmLabel={bn ? 'হ্যাঁ, শেষের অংশ নিন' : 'Yes, use the last part'}
        onCancel={() => setTooLong(null)} onConfirm={useLast} />
    </Card>
  );
}
