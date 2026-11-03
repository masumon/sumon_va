// A money entry, read before anything can change it — the same preview sheet the health
// lists open (RecordPreview), so a card behaves the same in every module. The full entry
// page stays one tap away and still owns delete, because deleting an entry also has to
// undo its link to a debt (money-bridge), which only that page knows how to do.

import { router } from 'expo-router';
import { RecordPreview } from './RecordPreview';
import { useAppPreferences } from '../app/AppPreferences';
import { asciiDigitsToBengali, formatPaisa } from '../services/debt/money';
import { formatBangladeshDate } from '../i18n/date-time';
import type { FinanceEntry } from '../services/finance-service';

export function EntryPreview({ entry, onClose }: { entry: FinanceEntry | null; onClose: () => void }) {
  const { language } = useAppPreferences();
  const bn = language === 'bn';
  if (!entry) return null;
  const income = entry.kind === 'INCOME';
  const amount = formatPaisa(entry.amountPaisa);
  return (
    <RecordPreview
      visible
      icon={income ? 'arrow-down' : 'arrow-up'}
      title={entry.category}
      subtitle={income ? (bn ? 'আয়' : 'Income') : (bn ? 'খরচ' : 'Expense')}
      headline={`${income ? '+' : '−'} ${bn ? asciiDigitsToBengali(amount) : amount}`}
      rows={[
        { label: bn ? 'তারিখ' : 'Date', value: formatBangladeshDate(entry.occurredAt, language) },
        { label: bn ? 'মানুষ' : 'Person', value: entry.personName },
        { label: bn ? 'কীভাবে' : 'Paid by', value: entry.method },
        { label: bn ? 'নোট' : 'Note', value: entry.note },
        { label: bn ? 'প্রতি মাসে' : 'Repeats', value: entry.recurring ? (bn ? 'হ্যাঁ' : 'Yes') : null },
      ]}
      editIcon="open-in-new"
      editLabel={bn ? 'বিস্তারিত দেখুন ও বদলান' : 'Open details'}
      onEdit={() => { const id = entry.id; onClose(); router.push(`/finance/entry/${id}` as never); }}
      onClose={onClose}
    />
  );
}
