import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AppButton } from '../src/ui/AppSurface';
import { ChipGroup, Field, useKit } from '../src/ui/AppKit';
import { va, type Contact, type View as InboxView } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Page, Status } from '../src/va/Page';
import { ContactRow } from '../src/va/ContactRow';

const VIEWS: { key: InboxView; bn: string; en: string }[] = [
  { key: 'all', bn: 'সব', en: 'All' },
  { key: 'business', bn: 'ব্যবসায়িক', en: 'Business' },
  { key: 'personal', bn: 'ব্যক্তিগত', en: 'Personal' },
  { key: 'social', bn: 'সামাজিক', en: 'Social' },
  { key: 'family', bn: 'পরিবার', en: 'Family' },
  { key: 'vip', bn: 'VIP', en: 'VIP' },
  { key: 'spam', bn: 'স্প্যাম', en: 'Spam' },
  { key: 'blocked', bn: 'ব্লক', en: 'Blocked' },
  { key: 'urgent', bn: 'জরুরি', en: 'Urgent' },
  { key: 'waiting', bn: 'উত্তর বাকি', en: 'Waiting' },
  { key: 'drafts', bn: 'খসড়া', en: 'Drafts' },
  { key: 'owner', bn: 'আমি নিয়েছি', en: 'Mine' },
  { key: 'done', bn: 'শেষ', en: 'Done' },
];

export default function InboxScreen() {
  const { bn } = useKit();
  const params = useLocalSearchParams<{ view?: string }>();
  const fromLink = VIEWS.find((v) => v.key === params.view)?.key as InboxView | undefined;
  const [view, setView] = useState<InboxView>(fromLink ?? 'waiting');
  // A new link (e.g. the bell → "urgent") switches the filter; adjusting state during render avoids a flash of the old list.
  const [linkSeen, setLinkSeen] = useState(params.view);
  if (params.view !== linkSeen) { setLinkSeen(params.view); if (fromLink) setView(fromLink); }
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Contact[]>([]);
  // Search waits for a pause in typing instead of asking the server on every keystroke.
  useEffect(() => { const t = setTimeout(() => { setTerm(q); setPage(1); }, 400); return () => clearTimeout(t); }, [q]);
  const list = useLoad(async () => {
    const r = await va.contacts(view, term, page);
    setItems((prev) => (page === 1 ? r.items : [...prev, ...r.items]));
    return r;
  }, `${view}|${term}|${page}`, 20000);
  const total = list.data?.total ?? 0;

  return (
    <Page title={bn ? 'ইনবক্স' : 'Inbox'} subtitle={bn ? 'সব মাধ্যমের সবাই, জরুরি আগে' : 'Everyone, every channel, by importance'}
      onRefresh={() => { setPage(1); void list.reload(); }} refreshing={list.loading && items.length > 0}>
      <ChipGroup<InboxView> value={view} options={VIEWS.map((v) => v.key)} labelOf={(k) => { const v = VIEWS.find((x) => x.key === k); return v ? (bn ? v.bn : v.en) : k; }} onChange={(v) => { if (v) { setView(v); setPage(1); } }} />
      <Field label={bn ? 'খুঁজুন' : 'Search'} value={q} onChangeText={setQ} placeholder={bn ? 'নাম, নম্বর বা বিষয়' : 'Name, number or topic'} />
      <Status loading={list.loading && items.length === 0} error={items.length ? null : list.error} onRetry={list.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'}
        empty={!list.loading && !list.error && items.length === 0} emptyTitle={bn ? 'এখানে কেউ নেই' : 'Nobody here'} emptyHint={bn ? 'নতুন বার্তা এলে এখানে দেখা যাবে।' : 'New messages will appear here.'} />
      <View style={{ gap: 12 }}>
        {items.map((c) => <ContactRow key={c.id} contact={c} onPress={() => router.push({ pathname: '/contact', params: { id: c.id } } as never)} />)}
      </View>
      {items.length < total ? <AppButton variant="secondary" label={bn ? 'আরও দেখান' : 'Load more'} onPress={() => setPage((p) => p + 1)} /> : null}
    </Page>
  );
}
