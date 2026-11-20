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
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [askBulkDelete, setAskBulkDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { showSnackbar } = useAppFeedback();
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => { setTerm(q); setPage(1); }, 350); return () => clearTimeout(t); }, [q]);
  const list = useLoad(async () => {
    const r = await va.contacts(view, term, page);
    setItems((prev) => (page === 1 ? r.items : [...prev, ...r.items]));
    return r;
  }, `contacts:${view}|${term}|${page}`, 20000);
  const total = list.data?.total ?? 0;
  const shown = items.length > 0 ? items : (list.data?.items ?? []);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const runBulk = async (action: 'auto_organize' | 'approve_all_drafts' | 'mark_done' | 'delete_contacts') => {
    setBulkBusy(true);
    try {
      const r = await va.bulkInbox(action, selectedIds);
      const msg = action === 'auto_organize'
        ? (bn ? `✨ সাজানো হয়েছে: ${num(r.drafted ?? 0, true)}টি খসড়া, ${num(r.spam_cleared ?? 0, true)}টি স্প্যাম আলাদা` : `Organized: ${r.drafted ?? 0} drafts`)
        : action === 'approve_all_drafts'
          ? (bn ? `✓ ${num(r.sent ?? 0, true)}টি খসড়া পাঠানো হয়েছে` : `Sent ${r.sent ?? 0} drafts`)
          : action === 'mark_done'
            ? (bn ? `✓ ${num(r.count ?? 0, true)}টি চ্যাট শেষ হয়েছে` : `Marked ${r.count ?? 0} done`)
            : (bn ? `✓ ${num(r.count ?? 0, true)}টি চ্যাট মুছে ফেলা হয়েছে` : `Deleted ${r.count ?? 0} chats`);
      showSnackbar(msg, 'success');
      setSelectedIds([]);
      setSelectMode(false);
      setPage(1);
      await list.reload();
    } catch (e) {
      showSnackbar(e instanceof Error ? e.message : '', 'danger');
    } finally {
      setBulkBusy(false);
    }
  };

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
              onPress={() => { setView(v.key); setPage(1); }}
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

      {/* Smart Bulk AI & Multi-Select Bar */}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Pressable
          accessibilityRole="button"
          disabled={bulkBusy}
          onPress={() => void runBulk('auto_organize')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 12, backgroundColor: colors.primaryTint, borderWidth: 1, borderColor: colors.primary, opacity: bulkBusy ? 0.6 : 1 }}
        >
          <AppIcon name="auto-fix" size={15} color={colors.primary} />
          <Text style={{ fontSize: 11.5, fontWeight: '800', color: colors.primary }}>{bn ? 'AI দিয়ে সাজান' : 'AI Organize'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={bulkBusy}
          onPress={() => void runBulk('approve_all_drafts')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: bulkBusy ? 0.6 : 1 }}
        >
          <AppIcon name="send-check-outline" size={15} color={colors.success} />
          <Text style={{ fontSize: 11.5, fontWeight: '800', color: colors.textPrimary }}>{bn ? 'সব খসড়া পাঠান' : 'Send all drafts'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => { setSelectMode((v) => !v); setSelectedIds([]); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 12, backgroundColor: selectMode ? colors.primary : colors.surface, borderWidth: 1, borderColor: selectMode ? colors.primary : colors.border }}
        >
          <AppIcon name="checkbox-multiple-marked-outline" size={15} color={selectMode ? colors.onPrimary : colors.textPrimary} />
          <Text style={{ fontSize: 11.5, fontWeight: '800', color: selectMode ? colors.onPrimary : colors.textPrimary }}>{selectMode ? (bn ? 'বাছাই শেষ' : 'Cancel select') : (bn ? 'একাধিক বাছুন' : 'Select')}</Text>
        </Pressable>
      </View>

      {selectMode && selectedIds.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary }}>
          <View style={{ flex: 1 }}>
            <AppButton label={bn ? `✓ কাজ শেষ (${num(selectedIds.length, true)})` : `Done (${selectedIds.length})`} loading={bulkBusy} onPress={() => void runBulk('mark_done')} />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton variant="danger" label={bn ? `মুছুন (${num(selectedIds.length, true)})` : `Delete (${selectedIds.length})`} disabled={bulkBusy} onPress={() => setAskBulkDelete(true)} />
          </View>
        </View>
      ) : null}

      <AppConfirmDialog
        visible={askBulkDelete}
        danger
        icon="delete-outline"
        title={bn ? 'বাছাই করা চ্যাট মুছবেন?' : 'Delete selected chats?'}
        description={bn ? `${num(selectedIds.length, true)}টি চ্যাট স্থায়ীভাবে মুছে যাবে। পরিবার ও VIP কখনো মোছা হয় না।` : `${selectedIds.length} chats will be permanently deleted. Family & VIP are protected.`}
        confirmLabel={bn ? 'হ্যাঁ, মুছুন' : 'Delete'}
        cancelLabel={bn ? 'না' : 'No'}
        onCancel={() => setAskBulkDelete(false)}
        onConfirm={() => { setAskBulkDelete(false); void runBulk('delete_contacts'); }}
      />

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
              selectable={selectMode}
              selected={selectedIds.includes(c.id)}
              onToggleSelect={() => toggleSelect(c.id)}
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
