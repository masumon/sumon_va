import { memo, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { AppIcon } from '../ui/AppIcon';
import { useAppFeedback } from '../ui/AppFeedback';
import { useShell } from './shell';
import { va, errTone } from './api';
import { AppText as Text } from '../ui/AppText';
import { AppBadge } from '../ui/AppSurface';
import { BrandLogo, brandFor } from './BrandLogo';
import { useAppPreferences } from '../app/AppPreferences';
import { formatBangladeshRelativeDate, formatBangladeshTime } from '../i18n/date-time';
import { border, radius, spacing, type ThemeColors } from '../theme';
import type { DesignTokens } from '../theme/designs';
import type { Contact } from './api';
import { CATEGORY, PRIORITY, displayName } from './labels';
import { ChatMenuButton } from './ChatMenu';
import { sourceLabel } from './modules';
import { num } from './bd';

/** One person in a list. High-density 3-line card with priority left-border accent and 1-tap inline draft approval. */
export const ContactRow = memo(function ContactRow({ contact, onPress, onChanged, selectable, selected, onToggleSelect }: { contact: Contact; onPress: () => void; onChanged?: () => void; selectable?: boolean; selected?: boolean; onToggleSelect?: () => void }) {
  const { colors, language, design } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors, design), [colors, design]);
  const [menu, setMenu] = useState(false);
  const [sendingDraft, setSendingDraft] = useState(false);
  const pr = PRIORITY[contact.priority] ?? PRIORITY[5]!;
  const urgent = contact.unread > 0 && contact.priority === 1;
  const when = contact.ago || (contact.last_message_at
    ? (formatBangladeshRelativeDate(contact.last_message_at, language) === (bn ? 'আজ' : 'Today') ? formatBangladeshTime(contact.last_message_at, language) : formatBangladeshRelativeDate(contact.last_message_at, language))
    : '');
  const refreshAll = useShell((st) => st.refresh);
  const { showSnackbar } = useAppFeedback();
  const swipe = useRef<SwipeableMethods | null>(null);
  const canFinish = contact.unread > 0 || contact.state !== 'done';
  const finish = async () => {
    swipe.current?.close();
    try { await va.patchContact(contact.id, { state: 'done' }); refreshAll(); onChanged?.(); showSnackbar(bn ? 'শেষ হিসেবে রাখা হয়েছে' : 'Marked done', 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
  };
  const sendDraftInline = async () => {
    if (!contact.draft_id || sendingDraft) return;
    setSendingDraft(true);
    try {
      await va.approve(contact.draft_id);
      refreshAll();
      onChanged?.();
      showSnackbar(bn ? `✓ ${displayName(contact)}-কে খসড়া উত্তর পাঠানো হয়েছে` : `✓ Draft sent to ${displayName(contact)}`, 'success');
    } catch (e) {
      showSnackbar(e instanceof Error ? e.message : '', errTone(e));
    } finally {
      setSendingDraft(false);
    }
  };
  const accentLeft = contact.is_family ? colors.success : contact.is_vip ? colors.warning : urgent ? colors.danger : design.cardBorder;
  const finishPane = () => (
    <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'শেষ' : 'Done'} onPress={() => { void finish(); }} style={styles.finish}>
      <AppIcon name="check" size={22} color="#FFFFFF" />
      <Text style={styles.finishText}>{bn ? 'শেষ' : 'Done'}</Text>
    </Pressable>
  );
  const previewText = contact.need || contact.summary || contact.preview || (bn ? 'কোনো বার্তা নেই' : 'No message');
  return (
    <ReanimatedSwipeable ref={swipe} enabled={canFinish} friction={2} overshootRight={false} dragOffsetFromRight={-36} dragOffsetFromLeft={36} renderRightActions={finishPane}>
      <Pressable
        android_ripple={{ color: 'rgba(128,128,128,0.12)' }}
        accessibilityRole="button"
        accessibilityLabel={[displayName(contact), contact.unread > 0 ? (bn ? `${num(contact.unread, true)}টি নতুন বার্তা` : `${contact.unread} new`) : '', previewText].filter(Boolean).join(', ')}
        onPress={selectable ? onToggleSelect : onPress}
        onLongPress={() => (selectable ? onToggleSelect?.() : setMenu(true))}
        delayLongPress={350}
        style={({ pressed }) => [styles.row, { borderLeftWidth: 4, borderLeftColor: accentLeft }, urgent && styles.urgent, selected && { borderColor: colors.primary, backgroundColor: colors.primaryTint }, pressed && styles.pressed]}
      >
        <View style={styles.topRow}>
          {selectable ? (
            <AppIcon name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={selected ? colors.primary : colors.textMuted} />
          ) : null}
          <BrandLogo brand={brandFor(contact.channel, contact.phone)} size={38} />
          <View style={styles.main}>
            <View style={styles.top}>
              <View style={styles.nameWrap}>
                <Text numberOfLines={1} style={[styles.name, contact.unread > 0 && styles.bold]}>{displayName(contact)}</Text>
                {contact.is_vip ? <AppBadge label="VIP" tone="warning" /> : null}
                {contact.is_family ? <AppBadge label={bn ? 'পরিবার' : 'Family'} tone="success" /> : null}
                {!contact.is_vip && !contact.is_family && contact.priority <= 2 ? <AppBadge label={bn ? pr.bn : pr.en} tone={pr.tone} /> : null}
              </View>
              <View style={styles.rightMeta}>
                <Text style={styles.when}>{when}</Text>
                <ChatMenuButton contact={contact} size={18} shown={menu} onShownChange={setMenu} />
              </View>
            </View>
            <View style={styles.subRow}>
              <Text numberOfLines={1} style={styles.source}>
                {contact.source_label || sourceLabel(contact.phone, contact.channel, bn)}
                {contact.category ? ` · ${bn ? CATEGORY[contact.category].bn : CATEGORY[contact.category].en}` : ''}
              </Text>
              {contact.unread > 0 ? (
                <View style={[styles.unreadPill, { backgroundColor: colors.danger }]}>
                  <Text style={styles.unreadText}>{bn ? `${num(contact.unread, true)}টি নতুন` : `${contact.unread} new`}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
        <Text numberOfLines={2} style={styles.preview}>
          {contact.purpose ? `🎯 ${contact.purpose}` : previewText}
        </Text>
        {contact.draft_id && contact.draft_body ? (
          <View style={styles.draftBar}>
            <Text numberOfLines={1} style={styles.draftPreview}>
              {bn ? '✍ খসড়া: ' : '✍ Draft: '}“{contact.draft_body}”
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={bn ? 'খসড়া পাঠান' : 'Send draft'}
              disabled={sendingDraft}
              onPress={() => { void sendDraftInline(); }}
              style={[styles.draftBtn, { backgroundColor: colors.primary, opacity: sendingDraft ? 0.6 : 1 }]}
            >
              <Text style={[styles.draftBtnText, { color: colors.onPrimary }]}>
                {sendingDraft ? (bn ? 'যাচ্ছে…' : 'Sending…') : (bn ? '✓ খসড়া পাঠান' : '✓ Send draft')}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </Pressable>
    </ReanimatedSwipeable>
  );
});

const makeStyles = (colors: ThemeColors, design: DesignTokens) => StyleSheet.create({
  row: { gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: design.radiusCard, borderWidth: border.thin, borderColor: design.cardBorder, backgroundColor: colors.surface, ...(design.shadow ?? {}) },
  urgent: { borderColor: colors.danger, borderWidth: border.medium },
  pressed: { opacity: 0.92 },
  finish: { width: 80, marginLeft: spacing.xs, borderRadius: design.radiusCard, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', gap: 2 },
  finishText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  main: { flex: 1, minWidth: 0, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  nameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  name: { flexShrink: 1, color: colors.textPrimary, fontSize: 15 },
  bold: { fontWeight: '800' },
  rightMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  when: { color: colors.textMuted, fontSize: 11.5 },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  source: { flex: 1, color: colors.textMuted, fontSize: 11.5 },
  unreadPill: { paddingHorizontal: 7, paddingVertical: 1.5, borderRadius: radius.pill },
  unreadText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  preview: { color: colors.textSecondary, fontSize: 13.5, lineHeight: 19 },
  draftBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 6, marginTop: 2, borderTopWidth: 1, borderTopColor: colors.border },
  draftPreview: { flex: 1, color: colors.textMuted, fontSize: 12 },
  draftBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, minHeight: 32, justifyContent: 'center' },
  draftBtnText: { fontSize: 11.5, fontWeight: '800' },
});
