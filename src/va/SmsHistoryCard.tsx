import { useState } from 'react';
import { PermissionsAndroid } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { AppButton } from '../ui/AppSurface';
import { useAppFeedback } from '../ui/AppFeedback';
import { Card, ChipGroup, useKit } from '../ui/AppKit';
import { smsHistory } from '../../modules/va-bridge';
import { errTone, va } from './api';

const DAYS = ['1', '3', '7', '15', '30', '0'] as const;
type Days = (typeof DAYS)[number];

/** Bring the phone's earlier SMS in as HISTORY (context only: never answered, never alerted; promotions left out; codes masked). */
export function SmsHistoryCard() {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [days, setDays] = useState<Days>('7');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setResult(null);
    try {
      const ok = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS);
      if (ok !== PermissionsAndroid.RESULTS.GRANTED) { showSnackbar(bn ? 'পুরোনো SMS পড়ার অনুমতি দেওয়া হয়নি' : 'Permission to read old SMS was not given', 'info'); return; }
      const { rows, error } = await smsHistory(Number(days));
      if (error) { showSnackbar(bn ? `SMS পড়া যায়নি (${error})` : `Could not read SMS (${error})`, 'danger'); return; }
      if (!rows.length) { setResult(bn ? 'এই সময়ের মধ্যে কোনো SMS পাওয়া যায়নি' : 'No SMS in this period'); return; }
      const r = await va.smsImport(rows, Number(days));
      setResult(bn ? `ফোনে পাওয়া: ${r.found}, নতুন রাখা: ${r.imported} (${r.people} জন), আগেই ছিল: ${r.duplicates}, প্রচার বাদ: ${r.promotions_left_out}`
        : `Found ${r.found}, kept ${r.imported} (${r.people} people), already there ${r.duplicates}, promotions left out ${r.promotions_left_out}`);
    } catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
    finally { setBusy(false); }
  };

  return (
    <Card icon="message-text-clock-outline" title={bn ? 'পুরোনো SMS আনুন' : 'Bring in old SMS'}>
      <Text style={{ opacity: 0.8, marginBottom: 8 }}>{bn ? 'ফোনের আগের SMS ইতিহাস হিসেবে রাখা হবে। সহকারী এগুলোর উত্তর দেবে না, অ্যালার্টও দেবে না। কোড লুকানো থাকে, অপারেটর/দোকানের অফার বাদ যায়। আবার চালালেও দ্বিগুণ হয় না।' : 'Earlier SMS are kept as history. No replies or alerts from them, codes are hidden, operator/shop offers are left out, and running it again adds nothing.'}</Text>
      <ChipGroup<Days> label={bn ? 'কত দিনের (০ = সব)' : 'How many days (0 = all)'} options={DAYS} value={days} labelOf={(d) => d} onChange={(d) => { if (d) setDays(d); }} />
      <AppButton icon="download" label={bn ? 'SMS আনুন' : 'Bring them in'} loading={busy} disabled={busy} onPress={() => void run()} />
      {result ? <Text style={{ marginTop: 8 }}>{result}</Text> : null}
    </Card>
  );
}
