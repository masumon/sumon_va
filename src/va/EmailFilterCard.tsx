import { useState } from 'react';
import { AppText as Text } from '../ui/AppText';
import { AppButton } from '../ui/AppSurface';
import { Card, Field, ToggleRow, useKit } from '../ui/AppKit';
import { useAppFeedback } from '../ui/AppFeedback';
import { va } from './api';
import { useLoad } from './hooks';

const split = (v: string) => v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 40);

/** Which e-mails come in. Promotions and automatic mail are dropped before they are saved, so the free server is never filled with offers. */
export function EmailFilterCard() {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const f = useLoad(() => va.emailFilter(), 'email-filter', 60000);
  const [allow, setAllow] = useState<string | null>(null);
  const [block, setBlock] = useState<string | null>(null);
  const d = f.data;
  const save = async (patch: Record<string, unknown>) => {
    try { await va.saveConfig({ email_filter: patch }); await f.reload(); showSnackbar(bn ? 'সেভ হয়েছে' : 'Saved', 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', 'danger'); }
  };
  if (!d) return null;
  return (
    <Card title={bn ? 'কোন ইমেইল আসবে' : 'Which e-mails come in'}>
      <Text style={{ opacity: 0.8, lineHeight: 21, marginBottom: 6 }}>{bn ? 'প্রচার, নিউজলেটার, অফার আর অটো-ইমেইল জমা হওয়ার আগেই বাদ যায়। জরুরি, টাকা-পয়সা, আইনি, মিটিং, অর্ডার, চেনা মানুষ আর চলতি কথোপকথনের ইমেইল আসে।' : 'Promotions, newsletters, offers and automatic mail are dropped before they are stored. Urgent, money, legal, meeting, order mail, people you know and ongoing conversations come in.'}</Text>
      <ToggleRow icon="filter-check-outline" label={bn ? 'শুধু গুরুত্বপূর্ণ ইমেইল আসুক' : 'Bring only important e-mails'} hint={d.mode === 'important' ? (bn ? 'চালু। আজ ' + d.dropped_today + 'টি প্রচার বা অটো-ইমেইল বাদ গেছে' : `On — ${d.dropped_today} promo/auto mails filtered today`) : (bn ? 'বন্ধ, সব ইমেইল আসছে' : 'Off — everything comes in')}
        value={d.mode === 'important'} onChange={(v) => void save({ mode: v ? 'important' : 'all' })} />
      {d.mode === 'important' ? (
        <>
          <Field label={bn ? 'সবসময় আসুক (ঠিকানা বা শব্দ, কমা দিয়ে)' : 'Always bring (addresses or words, comma separated)'} value={allow ?? d.allow.join(', ')} onChangeText={setAllow} placeholder="client@company.com, ইনভয়েস" />
          <Field label={bn ? 'কখনও আসবে না (ঠিকানা বা শব্দ)' : 'Never bring (addresses or words)'} value={block ?? d.block.join(', ')} onChangeText={setBlock} placeholder="shop@offers.com" />
          <AppButton label={bn ? 'তালিকা সেভ করুন' : 'Save lists'} icon="content-save-outline" disabled={allow === null && block === null} onPress={() => void save({ allow: split(allow ?? d.allow.join(',')), block: split(block ?? d.block.join(',')) }).then(() => { setAllow(null); setBlock(null); })} />
        </>
      ) : null}
    </Card>
  );
}
