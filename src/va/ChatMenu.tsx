import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../ui/AppText';
import { AppIcon } from '../ui/AppIcon';
import type { IconName } from '../ui/AppKit';
import { AppConfirmDialog, useAppFeedback } from '../ui/AppFeedback';
import { useAppPreferences } from '../app/AppPreferences';
import { border, radius, spacing } from '../theme';
import { va, type Category, type Contact, errTone } from './api';
import { CATEGORY, CATEGORY_KEYS, MODE, displayName } from './labels';
import { BrandLogo, brandFor, brandName } from './BrandLogo';
import { useShell } from './shell';

type Item = { key: string; icon: IconName; bn: string; en: string; hintBn?: string; hintEn?: string; on?: boolean; danger?: boolean; run: () => void | Promise<unknown> };

/** The ⋮ button for one chat. Everything you can do with this person lives here, exactly like WhatsApp's chat menu. */
export function ChatMenuButton({ contact, onChanged, size = 22, shown, onShownChange }: { contact: Contact; onChanged?: () => void; size?: number; shown?: boolean; onShownChange?: (v: boolean) => void }) {
  const refreshAll = useShell((st) => st.refresh);
  const { colors, language } = useAppPreferences();
  const bn = language === 'bn';
  // The menu can also be opened from outside (a long press on the chat row), so it may be controlled.
  const [localOpen, setLocalOpen] = useState(false);
  const open = shown ?? localOpen;
  const setOpen = (v: boolean) => { setLocalOpen(v); onShownChange?.(v); };
  const [sub, setSub] = useState<'mode' | 'category' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { showSnackbar } = useAppFeedback();
  const c = contact;

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); (onChanged ?? refreshAll)(); if (ok) showSnackbar(ok, 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
  };
  const patch = (p: Parameters<typeof va.patchContact>[1], ok?: string) => act(() => va.patchContact(c.id, p), ok);
  const go = (path: string) => { setOpen(false); router.push({ pathname: path, params: { id: c.id } } as never); };

  const items: Item[] = [
    { key: 'open', icon: 'message-text-outline', bn: 'চ্যাট খুলুন', en: 'Open chat', run: () => go('/contact') },
    c.unread > 0 || c.state !== 'done'
      ? { key: 'done', icon: 'check-circle-outline', bn: 'শেষ, উত্তর দেওয়া হয়ে গেছে', en: 'Done — handled', run: () => patch({ state: 'done' }, bn ? 'শেষ হিসেবে রাখা হয়েছে' : 'Marked done') }
      : { key: 'reopen', icon: 'restore', bn: 'আবার খুলুন', en: 'Reopen', run: () => patch({ state: 'assistant' }) },
    c.state !== 'owner'
      ? { key: 'mine', icon: 'hand-front-right-outline', bn: 'আমি দেখছি (সহকারী চুপ থাকবে)', en: "I'll handle it (assistant stays quiet)", run: () => patch({ state: 'owner' }, bn ? 'আপনি নিজে দেখছেন' : 'You took over') }
      : { key: 'give', icon: 'robot-outline', bn: 'সহকারীর হাতে দিন', en: 'Hand back to the assistant', run: () => patch({ state: 'assistant' }, bn ? 'সহকারীকে ফেরানো হয়েছে' : 'Handed back') },
    { key: 'mode', icon: 'tune-variant', bn: 'উত্তরের ধরন', en: 'Reply style', hintBn: MODE[c.mode].bn, hintEn: MODE[c.mode].en, run: () => setSub('mode') },
    { key: 'category', icon: 'shape-outline', bn: 'ধরন: ব্যবসায়িক/ব্যক্তিগত/সামাজিক', en: 'Kind: business/personal/social', hintBn: c.category ? CATEGORY[c.category].bn : 'সহকারী নিজে ঠিক করবে', hintEn: c.category ? CATEGORY[c.category].en : 'decided by itself', run: () => setSub('category') },
    { key: 'family', icon: 'account-heart-outline', bn: 'পরিবার', en: 'Family', hintBn: 'সহকারী কখনও নিজে উত্তর দেবে না', hintEn: 'never answered by itself', on: c.is_family, run: () => patch({ is_family: !c.is_family }) },
    { key: 'vip', icon: 'star-outline', bn: 'VIP', en: 'VIP', on: c.is_vip, run: () => patch({ is_vip: !c.is_vip }) },
    { key: 'tags', icon: 'tag-outline', bn: 'ট্যাগ ও নোট (ক্লায়েন্ট, মামলা, NID…)', en: 'Tags and notes (client, case, NID…)', hintBn: `${c.tags?.length ?? 0}টি`, hintEn: `${c.tags?.length ?? 0}`, run: () => go('/contact') },
    { key: 'task', icon: 'checkbox-marked-circle-plus-outline', bn: 'এই ব্যক্তির জন্য কাজ যোগ করুন', en: 'Add a task for this person', run: () => act(() => va.addTask(`${displayName(c)}: ${bn ? 'উত্তর দিন' : 'reply'}`, undefined, c.id), bn ? 'কাজ যোগ হয়েছে' : 'Task added') },
    { key: 'xfer', icon: 'file-swap-outline', bn: 'চ্যাট ইমপোর্ট / এক্সপোর্ট', en: 'Import / export chat', run: () => go('/contact') },
    { key: 'block', icon: 'block-helper', bn: 'ব্লক', en: 'Block', hintBn: 'উত্তর বা সতর্কতা কিছুই আসবে না', hintEn: 'no reply, no alert', on: c.is_blocked, run: () => patch({ is_blocked: !c.is_blocked }) },
    { key: 'clear', icon: 'delete-sweep-outline', bn: 'চ্যাট খালি করুন', en: 'Clear chat', hintBn: 'বার্তা মুছবে, ব্যক্তি থাকবে', hintEn: 'removes messages, keeps the person', danger: true, run: () => { setOpen(false); setConfirm(true); } },
  ];

  const render = (i: Item): ReactNode => (
    <Pressable key={i.key} accessibilityRole="button" onPress={() => void i.run()} style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && { opacity: 0.85 }]}>
      <AppIcon name={i.icon} size={22} color={i.danger ? colors.danger : colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: i.danger ? colors.danger : colors.textPrimary, fontWeight: '600' }}>{bn ? i.bn : i.en}</Text>
        {i.hintBn ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>{bn ? i.hintBn : i.hintEn}</Text> : null}
      </View>
      {i.on !== undefined ? <AppIcon name={i.on ? 'toggle-switch' : 'toggle-switch-off-outline'} size={34} color={i.on ? colors.primary : colors.textMuted} /> : null}
    </Pressable>
  );

  const close = () => { setOpen(false); setSub(null); };
  const choice = (label: string, active: boolean, onPress: () => void) => (
    <Pressable key={label} accessibilityRole="button" onPress={onPress} style={[styles.row, { borderBottomColor: colors.border }]}>
      <AppIcon name={active ? 'radiobox-marked' : 'radiobox-blank'} size={22} color={active ? colors.primary : colors.textMuted} />
      <Text style={{ flex: 1, color: colors.textPrimary, fontWeight: active ? '700' : '500' }}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'এই চ্যাটের মেনু' : 'Chat menu'} onPress={() => setOpen(true)} hitSlop={10} style={styles.dots}>
        <AppIcon name="dots-vertical" size={size} color={colors.textSecondary} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
        <Pressable style={[styles.veil, { backgroundColor: colors.overlay }]} onPress={close} accessibilityLabel={bn ? 'বন্ধ' : 'Close'} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.head, { borderBottomColor: colors.border }]}>
            <BrandLogo brand={brandFor(c.channel, c.phone)} size={38} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontWeight: '800', fontSize: 16, color: colors.textPrimary }}>{displayName(c)}</Text>
              <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 12 }}>{brandName(brandFor(c.channel, c.phone))} · {c.phone.split(':').slice(-1)[0]}</Text>
            </View>
            {sub ? <Pressable onPress={() => setSub(null)} hitSlop={8}><AppIcon name="arrow-left" size={22} color={colors.textPrimary} /></Pressable> : <Pressable onPress={close} hitSlop={8}><AppIcon name="close" size={22} color={colors.textPrimary} /></Pressable>}
          </View>
          <ScrollView style={{ maxHeight: 520 }}>
            {sub === 'mode' ? (['inherit', 'auto', 'telegram', 'draft', 'notify'] as const).map((m) => choice(bn ? MODE[m].bn : MODE[m].en, c.mode === m, () => { void patch({ mode: m }); close(); }))
              : sub === 'category' ? (CATEGORY_KEYS as readonly Category[]).map((k) => choice(`${bn ? CATEGORY[k].bn : CATEGORY[k].en}: ${bn ? CATEGORY[k].hintBn : CATEGORY[k].hintEn}`, c.category === k, () => { void patch({ category: k }); close(); }))
              : items.map(render)}
          </ScrollView>
        </View>
      </Modal>
      <AppConfirmDialog visible={confirm} danger icon="delete-sweep-outline" title={bn ? 'এই চ্যাটের সব বার্তা মুছবেন?' : 'Delete all messages of this chat?'}
        description={bn ? `${displayName(c)}-এর সব বার্তা মুছে যাবে। ব্যক্তি, ট্যাগ ও নোট থাকবে। এটা আর ফেরানো যাবে না।` : `All messages with ${displayName(c)} will be removed. The person, tags and notes stay. This cannot be undone.`}
        cancelLabel={bn ? 'না' : 'No'} confirmLabel={bn ? 'মুছুন' : 'Delete'} onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); void act(() => va.clearChat(c.id), bn ? 'চ্যাট খালি হয়েছে' : 'Chat cleared'); }} />
    </>
  );
}

const styles = StyleSheet.create({
  dots: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  veil: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: spacing.sm, borderRadius: radius.xl, borderWidth: border.thin, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, padding: spacing.md, borderBottomWidth: border.thin },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, minHeight: 52, paddingHorizontal: spacing.md, borderBottomWidth: border.thin },
});
