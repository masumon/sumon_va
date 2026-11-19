import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../src/ui/AppText';
import { AppIcon } from '../src/ui/AppIcon';
import { router, useLocalSearchParams } from 'expo-router';
import { AppButton } from '../src/ui/AppSurface';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKit } from '../src/ui/AppKit';
import { layout } from '../src/theme';
import { va, type Contact, type View as InboxView } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Page, Status } from '../src/va/Page';
import { ContactRow } from '../src/va/ContactRow';
import { num } from '../src/va/bd';

const VIEWS: { key: InboxView; bn: string; en: string }[] = [
  { key: 'waiting', bn: 'উত্তর বাকি', en: 'Waiting' },
  { key: 'urgent', bn: 'জরুরি', en: 'Urgent' },
  { key: 'drafts', bn: 'খসড়া রেডি', en: 'Drafts ready' },
  { key: 'vip', bn: 'VIP', en: 'VIP' },
  { key: 'family', bn: 'পরিবার', en: 'Family' },
  { key: 'business', bn: 'ব্যবসায়িক', en: 'Business' },
  { key: 'personal', bn: 'ব্যক্তিগত', en: 'Personal' },
  { key: 'social', bn: 'সামাজিক', en: 'Social' },
  { key: 'failed', bn: 'পাঠানো যায়নি', en: 'Failed' },
  { key: 'spam', bn: 'স্প্যাম', en: 'Spam' },
  { key: 'done', bn: 'শেষ হয়েছে', en: 'Done' },
  { key: 'all', bn: 'সব', en: 'All' },
];

const VIEW_HINT: Partial<Record<InboxView, { bn: string; en: string }>> = {
  waiting: { bn: 'যাদের এখনো উত্তর দেওয়া হয়নি। খসড়া থাকলে সরাসরি “✓ খসড়া পাঠান” চাপুন।', en: 'People waiting for a reply. Tap Send draft if a draft is ready.' },
  urgent: { bn: 'জরুরি ও গুরুত্বপূর্ণ বার্তা—আগে এগুলো দেখুন।', en: 'Urgent messages: look at these first.' },
  drafts: { bn: 'সহকারী উত্তর লিখে রেখেছে। তালিকা থেকেই ১ ট্যাপে “✓ খসড়া পাঠান” চাপুন বা ভেতরে ঢুকে বদলান।', en: 'Assistant prepared a reply. Tap Send draft right from the list or open to edit.' },
  failed: { bn: 'এই উত্তরগুলো যায়নি। নাম চাপুন, বিকল্প উপায়ে (অ্যাপে/SMS) আবার পাঠান।', en: 'These did not go out. Open to retry via app or SMS.' },
  all: { bn: 'সব মাধ্যমের সবাই, নতুন ও জরুরি বার্তা আগে।', en: 'Everyone across all channels, newest first.' },
};

export default function InboxScreen() {
  const { bn, colors, design } = useKit();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ view?: string }>();
  const fromLink = VIEWS.find((v) => v.key === params.view)?.key as InboxView | undefined;
  const [view, setView] = useState<InboxView>(fromLink ?? 'waiting');
  const [linkSeen, setLinkSeen] = useState(params.view);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Contact[]>([]);
  if (params.view !== linkSeen) { setLinkSeen(params.view); if (fromLink) { setView(fromLink); setPage(1); setItems([]); } }
  const [q, setQ] = useState('');
  const [askClear, setAskClear] = useState(false);
  const { showSnackbar } = useAppFeedback();
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => { setTerm(q); setPage(1); setItems([]); }, 350); return () => clearTimeout(t); }, [q]);
  const list = useLoad(async () => {
    const r = await va.contacts(view, term, page);
    setItems((prev) => (page === 1 ? r.items : [...prev, ...r.items]));
    return r;
  }, `contacts:${view}|${term}|${page}`, 20000);
  const total = list.data?.total ?? 0;
  const shown = items;

  return (
    <Page
      title={bn ? 'স্মার্ট ইনবক্স' : 'Smart Inbox'}
      hideHeader
      onRefresh={() => { if (page === 1) void list.reload(); else setPage(1); }}
      refreshing={list.loading && shown.length > 0}
    >
      {/* Compact Search Bar with Total Count Badge */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          minHeight: 46,
          borderRadius: design.radiusCard,
          borderWidth: 1,
          borderColor: design.cardBorder,
          backgroundColor: colors.surface,
        }}
      >
        <AppIcon name="magnify" size={20} color={colors.textMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={bn ? 'নাম, নম্বর বা কথার বিষয় খুঁজুন…' : 'Search name, number or topic…'}
          placeholderTextColor={colors.textMuted}
          style={{ flex: 1, fontSize: 13.5, color: colors.textPrimary, paddingVertical: 6 }}
        />
        {q ? (
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'মুছুন' : 'Clear'} onPress={() => setQ('')} hitSlop={8}>
            <AppIcon name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: colors.surfaceMuted }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: colors.textSecondary }}>
            {bn ? `${num(total, true)} জন` : `${total}`}
          </Text>
        </View>
      </View>

      {/* Single-Row Horizontal Filter Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
        {VIEWS.map((v) => {
          const active = view === v.key;
          return (
            <Pressable
              key={v.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => { setView(v.key); setPage(1); setItems([]); }}
              style={{
                paddingHorizontal: 13,
                paddingVertical: 7,
                minHeight: 36,
                borderRadius: 999,
                justifyContent: 'center',
                backgroundColor: active ? colors.primary : colors.surface,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: active ? '800' : '600', color: active ? colors.onPrimary : colors.textPrimary }}>
                {bn ? v.bn : v.en}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {VIEW_HINT[view] ? (
        <Text style={{ fontSize: 12, color: colors.textSecondary }}>{bn ? VIEW_HINT[view]!.bn : VIEW_HINT[view]!.en}</Text>
      ) : null}

      {view === 'spam' ? (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 12, color: colors.textSecondary }}>
            {bn
              ? 'অপারেটর ও দোকানের অফার এখানে ৩ দিন থাকে, তারপর নিজে মুছে যায়। ভুল করে কেউ এলে তার পাতায় “ইনি কেমন মানুষ?” বদলে দিন।'
              : 'Operator and shop offers stay here 3 days, then delete themselves.'}
          </Text>
          <AppButton variant="secondary" icon="delete-sweep-outline" label={bn ? 'সব স্প্যাম এখনই মুছুন' : 'Delete all spam now'} disabled={items.length === 0} onPress={() => setAskClear(true)} />
          <AppConfirmDialog
            visible={askClear}
            title={bn ? 'সব স্প্যাম মুছবেন?' : 'Delete all spam?'}
            description={bn ? 'স্প্যাম ফোল্ডারের সব বার্তা মুছে যাবে। পরিবার ও VIP কখনো মোছা হয় না।' : 'Every message in the spam folder is deleted.'}
            confirmLabel={bn ? 'মুছুন' : 'Delete'}
            cancelLabel={bn ? 'না' : 'No'}
            danger
            icon="delete-sweep-outline"
            onCancel={() => setAskClear(false)}
            onConfirm={() => {
              setAskClear(false);
              void va.clearSpam().then((r) => {
                showSnackbar(bn ? `${num(r.messages, true)}টি বার্তা মুছে ফেলা হলো` : `${r.messages} messages deleted`, 'success');
                void list.reload();
              }).catch((e: unknown) => showSnackbar(e instanceof Error ? e.message : '', 'danger'));
            }}
          />
        </View>
      ) : null}

      <View style={{ gap: 8, paddingBottom: layout.compactNavHeight + insets.bottom + 20 }}>
        <Status
          loading={list.loading && shown.length === 0}
          error={shown.length ? null : list.error}
          onRetry={list.reload}
          retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'}
          empty={!list.loading && !list.error && shown.length === 0}
          emptyTitle={bn ? 'এখানে কেউ নেই ✓' : 'Nobody here ✓'}
          emptyHint={bn ? 'নতুন বার্তা এলে এখানে দেখা যাবে।' : 'New messages will appear here.'}
        />
        <View style={{ gap: 8 }}>
          {shown.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              onPress={() => router.push({ pathname: '/contact', params: { id: c.id } } as never)}
              onChanged={() => { setPage(1); void list.reload(); }}
            />
          ))}
        </View>
        {shown.length < total ? (
          <AppButton variant="secondary" label={bn ? 'আরও দেখান' : 'Load more'} onPress={() => setPage((p) => p + 1)} />
        ) : null}
      </View>
    </Page>
  );
}
