import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { AppIcon } from '../src/ui/AppIcon';
import { router, useLocalSearchParams } from 'expo-router';
import { AppButton } from '../src/ui/AppSurface';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChipGroup, Field, useKit } from '../src/ui/AppKit';
import { layout } from '../src/theme';
import { va, type Contact, type View as InboxView } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Page, Status } from '../src/va/Page';
import { ContactRow } from '../src/va/ContactRow';
import { FilterSheet } from '../src/va/FilterSheet';

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
  { key: 'failed', bn: 'পাঠানো যায়নি', en: 'Failed' },
  { key: 'owner', bn: 'আমি নিয়েছি', en: 'Mine' },
  { key: 'done', bn: 'শেষ', en: 'Done' },
];

const STATE_KEYS: InboxView[] = ['waiting', 'drafts', 'failed', 'done', 'all'];

export default function InboxScreen() {
  const { bn, colors } = useKit();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ view?: string }>();
  const fromLink = VIEWS.find((v) => v.key === params.view)?.key as InboxView | undefined;
  const [view, setView] = useState<InboxView>(fromLink ?? 'waiting');
  // A new link (e.g. the bell → "urgent") switches the filter; adjusting state during render avoids a flash of the old list.
  const [linkSeen, setLinkSeen] = useState(params.view);
  if (params.view !== linkSeen) { setLinkSeen(params.view); if (fromLink) setView(fromLink); }
  const [showMore, setShowMore] = useState(false);
  const [q, setQ] = useState('');
  const [askClear, setAskClear] = useState(false);
  const { showSnackbar } = useAppFeedback();
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
  const EXTRA = VIEWS.map((v) => v.key).filter((k) => !STATE_KEYS.includes(k));
  const labelOf = (k: InboxView) => { const v = VIEWS.find((x) => x.key === k); return v ? (bn ? v.bn : v.en) : k; };
  const extraActive = !STATE_KEYS.includes(view);

  return (
    <Page title={bn ? 'ইনবক্স' : 'Inbox'} subtitle={bn ? 'সব মাধ্যমের সবাই, জরুরি আগে' : 'Everyone, every channel, by importance'}
      onRefresh={() => { setPage(1); void list.reload(); }} refreshing={list.loading && items.length > 0}>
      <ChipGroup<InboxView> value={view} options={STATE_KEYS} labelOf={(k) => { const v = VIEWS.find((x) => x.key === k); return v ? (bn ? v.bn : v.en) : k; }} onChange={(v) => { if (v) { setView(v); setPage(1); } }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <AppButton variant="secondary" icon="filter-variant" label={bn ? 'আরও ফিল্টার' : 'More filters'} onPress={() => setShowMore(true)} />
        {extraActive ? (
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? `${labelOf(view)} ফিল্টার সরান` : `Remove the ${labelOf(view)} filter`} onPress={() => { setView('waiting'); setPage(1); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.primary }}>
            <Text style={{ color: colors.onPrimary, fontWeight: '700' }}>{labelOf(view)}</Text>
            <AppIcon name="close" size={16} color={colors.onPrimary} />
          </Pressable>
        ) : null}
      </View>
      <FilterSheet<InboxView> visible={showMore} onClose={() => setShowMore(false)} title={bn ? 'আরও ফিল্টার' : 'More filters'} options={EXTRA} value={extraActive ? view : null} labelOf={labelOf} onSelect={(k) => { setView(k); setPage(1); }} />
      {view === 'spam' ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.textSecondary }}>{bn ? 'অপারেটর ও দোকানের অফার এখানে ৩ দিন থাকে, তারপর নিজে মুছে যায়। ভুল করে কেউ এলে তার পাতায় “ইনি কেমন মানুষ?” বদলে দিন।' : 'Operator and shop offers stay here 3 days, then delete themselves. If someone real landed here, change “What kind of person” on their page.'}</Text>
          <AppButton variant="secondary" icon="delete-sweep-outline" label={bn ? 'সব স্প্যাম এখনই মুছুন' : 'Delete all spam now'} disabled={items.length === 0} onPress={() => setAskClear(true)} />
          <AppConfirmDialog visible={askClear} title={bn ? 'সব স্প্যাম মুছবেন?' : 'Delete all spam?'} description={bn ? 'স্প্যাম ফোল্ডারের সব বার্তা মুছে যাবে। পরিবার ও VIP কখনো মোছা হয় না।' : 'Every message in the spam folder is deleted. Family and VIP are never touched.'}
            confirmLabel={bn ? 'মুছুন' : 'Delete'} cancelLabel={bn ? 'না' : 'No'} danger icon="delete-sweep-outline" onCancel={() => setAskClear(false)}
            onConfirm={() => { setAskClear(false); void va.clearSpam().then((r) => { showSnackbar(bn ? `${r.messages}টি বার্তা মুছে ফেলা হলো` : `${r.messages} messages deleted`, 'success'); void list.reload(); }).catch((e: unknown) => showSnackbar(e instanceof Error ? e.message : '', 'danger')); }} />
        </View>
      ) : null}
      <Field label={bn ? 'খুঁজুন' : 'Search'} value={q} onChangeText={setQ} placeholder={bn ? 'নাম, নম্বর বা বিষয়' : 'Name, number or topic'} />
      <View style={{ gap: 12, paddingBottom: layout.compactNavHeight + insets.bottom + 24 }}>
      <Status loading={list.loading && items.length === 0} error={items.length ? null : list.error} onRetry={list.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'}
        empty={!list.loading && !list.error && items.length === 0} emptyTitle={bn ? 'এখানে কেউ নেই' : 'Nobody here'} emptyHint={bn ? 'নতুন বার্তা এলে এখানে দেখা যাবে।' : 'New messages will appear here.'} />
      <View style={{ gap: 12 }}>
        {items.map((c) => <ContactRow key={c.id} contact={c} onPress={() => router.push({ pathname: '/contact', params: { id: c.id } } as never)} />)}
      </View>
      {items.length < total ? <AppButton variant="secondary" label={bn ? 'আরও দেখান' : 'Load more'} onPress={() => setPage((p) => p + 1)} /> : null}
      </View>
    </Page>
  );
}
