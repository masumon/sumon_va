import { useRef, useState } from 'react';
import { View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { AppText as Text } from '../ui/AppText';
import { AppButton } from '../ui/AppSurface';
import { AppConfirmDialog, useAppFeedback } from '../ui/AppFeedback';
import { Card, ChipGroup, useKit } from '../ui/AppKit';
import { errTone, va, type HistoryReport } from './api';
import { readChatFile } from '../../modules/va-bridge';
import { num } from './bd';

const DAYS = ['1', '3', '5', '7', '15', '30', '0'] as const;
type Days = (typeof DAYS)[number];
const MAX_CHARS = 1_900_000;

/**
 * Keep an earlier chat as CONTEXT only (dated, no duplicates, safe to run again). The assistant never answers it and never raises an
 * alert from it. This is the owner's own exported file, so it is only what the file holds, never the "whole history".
 */
export function HistoryImport({ contactId, isPrivate }: { contactId: string; isPrivate: boolean }) {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [days, setDays] = useState<Days>('7');
  const [text, setText] = useState<string | null>(null);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [report, setReport] = useState<HistoryReport | null>(null);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = async (chat: string, speaker?: string, allow = false) => {
    if (running.current) return;
    running.current = true; setBusy(true); setReport(null);
    try {
      const r = await va.importHistory(contactId, chat, speaker, Number(days), allow);
      if (r.need_consent) { setAsk(true); return; }
      if (r.need_owner) { setSpeakers(r.speakers ?? []); return; }
      setText(null); setSpeakers([]); setReport(r);
      showSnackbar(bn ? `${num(r.imported ?? 0, true)}টি নতুন বার্তা ইতিহাসে রাখা হলো` : `${r.imported ?? 0} new messages kept as history`, 'success');
    } catch (e) {
      showSnackbar(errTone(e) === 'info' ? (bn ? 'সার্ভার এখনও কাজ করতে পারে। একটু পরে দেখুন, সঙ্গে সঙ্গে আবার চাপবেন না' : 'The server may still be working. Check later; do not press again right away') : (e instanceof Error ? e.message : ''), errTone(e));
    } finally { running.current = false; setBusy(false); }
  };

  const pick = async () => {
    if (busy) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['text/plain', 'application/zip', '*/*'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      let chat = '';
      if (/\.zip$/i.test(asset.name ?? '') || asset.mimeType === 'application/zip') {
        const r = await readChatFile(asset.uri);
        if (!r.ok || !r.text) { showSnackbar(r.error || (bn ? 'ZIP ফাইল থেকে চ্যাট পড়া যায়নি' : 'Could not read chat from ZIP'), 'info'); return; }
        chat = r.text;
      } else {
        try { chat = await FileSystem.readAsStringAsync(asset.uri); }
        catch {
          const r = await readChatFile(asset.uri);
          if (!r.ok || !r.text) { showSnackbar(r.error || (bn ? 'ফাইলটি পড়া যায়নি' : 'Could not read file'), 'info'); return; }
          chat = r.text;
        }
      }
      void FileSystem.deleteAsync(asset.uri, { idempotent: true });
      if (chat.trim().length < 20) { showSnackbar(bn ? 'ফাইলে পড়ার মতো লেখা নেই' : 'The file has too little text', 'info'); return; }
      const use = chat.length > MAX_CHARS ? chat.slice(chat.length - MAX_CHARS) : chat;  // the newest part
      setText(use);
      await run(use);
    } catch (e) { showSnackbar(e instanceof Error ? e.message : '', 'danger'); }
  };

  return (
    <Card title={bn ? 'পুরোনো চ্যাট এখানে রাখুন (শুধু দেখার জন্য, কাউকে কিছু যায় না)' : 'Keep an earlier chat as history'}>
      <Text style={{ opacity: 0.8, lineHeight: 21, marginBottom: 8 }}>{bn ? 'নিজের এক্সপোর্ট করা চ্যাট ফাইল দিন। সহকারী এটা শুধু প্রসঙ্গ হিসেবে মনে রাখবে। এই পুরোনো বার্তার কোনো উত্তর দেবে না, কোনো অ্যালার্টও দেবে না। দুবার দিলেও বার্তা দ্বিগুণ হয় না।' : 'Give your own exported chat file. It is kept only as context: no replies and no alerts from old messages, and running it twice adds nothing.'}</Text>
      <ChipGroup<Days> label={bn ? 'কত দিনের বার্তা' : 'How many days'} options={DAYS} value={days} labelOf={(d) => (d === '0' ? (bn ? 'সব' : 'All') : num(d, bn))} onChange={(d) => { if (d) setDays(d); }} />
      {speakers.length > 0 && text ? (
        <View style={{ marginVertical: 8 }}>
          <Text style={{ fontWeight: '600', marginBottom: 6 }}>{bn ? 'এই চ্যাটে কোনটি আপনার নাম?' : 'Which name in this chat is you?'}</Text>
          <ChipGroup<string> options={speakers} value={null} labelOf={(s) => s} onChange={(s) => { if (s) void run(text, s); }} />
        </View>
      ) : null}
      <AppButton icon="history" label={bn ? 'ফাইল বেছে ইতিহাস রাখুন' : 'Pick a file and keep it'} loading={busy} disabled={busy} onPress={() => void pick()} />
      {report ? (
        <View style={{ marginTop: 10, gap: 2 }}>
          <Text style={{ fontWeight: '600' }}>{bn ? 'ফল' : 'Result'}</Text>
          <Text>{bn ? `ফাইলে পাওয়া: ${num(report.found, true)}, নতুন রাখা: ${num(report.imported, true)}, আগেই ছিল: ${num(report.duplicates, true)}` : `Found ${report.found}, kept ${report.imported}, already there ${report.duplicates}`}</Text>
          {report.skipped_old || report.skipped_period ? <Text style={{ opacity: 0.75 }}>{bn ? `বাদ: ${num((report.skipped_old ?? 0) + (report.skipped_period ?? 0), true)}টি (সময়ের বাইরে)` : `Skipped ${(report.skipped_old ?? 0) + (report.skipped_period ?? 0)} (outside the period)`}</Text> : null}
          {report.truncated ? <Text style={{ opacity: 0.75 }}>{bn ? 'একবারে সীমার বেশি ছিল, আবার চালালে বাকিটা আসবে।' : 'Over the per-run limit; run again for the rest.'}</Text> : null}
          {report.note ? <Text style={{ opacity: 0.65, fontSize: 12 }}>{report.note}</Text> : null}
        </View>
      ) : null}
      <AppConfirmDialog visible={ask} icon="shield-account-outline" title={bn ? 'ব্যক্তিগত চ্যাটের ইতিহাস রাখবেন?' : 'Keep a private chat as history?'}
        description={isPrivate ? (bn ? 'এটি ব্যক্তিগত বা পরিবারের চ্যাট। বার্তাগুলো এনক্রিপ্ট করে রাখা হবে, AI-তে যাবে না। আপনি কি রাজি?' : 'This is a private/family chat. The messages are stored encrypted and never go to the AI. Do you agree?') : ''}
        cancelLabel={bn ? 'না, থাক' : 'No'} confirmLabel={bn ? 'হ্যাঁ, রাখুন' : 'Yes, keep it'}
        onCancel={() => { setAsk(false); setText(null); }} onConfirm={() => { setAsk(false); if (text) void run(text, undefined, true); }} />
    </Card>
  );
}
