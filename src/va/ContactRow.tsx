import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { AppIcon } from '../ui/AppIcon';
import { useAppFeedback } from '../ui/AppFeedback';
import { useShell } from './shell';
import { va, errTone } from './api';
import { AppText as Text } from '../ui/AppText';
import { AppBadge } from '../ui/AppSurface';
import { BrandLogo, brandFor, brandName } from './BrandLogo';
import { useAppPreferences } from '../app/AppPreferences';
import { formatBangladeshRelativeDate, formatBangladeshTime } from '../i18n/date-time';
import { border, control, radius, spacing, type ThemeColors } from '../theme';
import type { Contact } from './api';
import { CATEGORY, PRIORITY, displayName } from './labels';
import { ChatMenuButton } from './ChatMenu';
import { sourceLabel } from './modules';

/** One person in a list. The same row is used on Home and in the Inbox, so they can never look different. */
export function ContactRow({ contact, onPress }: { contact: Contact; onPress: () => void }) {
  const { colors, language } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [menu, setMenu] = useState(false);
  const pr = PRIORITY[contact.priority] ?? PRIORITY[5]!;
  const urgent = contact.unread > 0 && contact.priority === 1;
  const when = contact.last_message_at
    ? (formatBangladeshRelativeDate(contact.last_message_at, language) === (bn ? 'আজ' : 'Today') ? formatBangladeshTime(contact.last_message_at, language) : formatBangladeshRelativeDate(contact.last_message_at, language))
    : '';
  const refreshAll = useShell((st) => st.refresh);
  const { showSnackbar } = useAppFeedback();
  const swipe = useRef<SwipeableMethods | null>(null);
  const canFinish = contact.unread > 0 || contact.state !== 'done';
  const finish = async () => {
    swipe.current?.close();
    try { await va.patchContact(contact.id, { state: 'done' }); refreshAll(); showSnackbar(bn ? 'শেষ হিসেবে রাখা হয়েছে' : 'Marked done', 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
  };
  // Swipe the row to the left to reveal "শেষ"; a long press opens the full menu. Fewer buttons on screen, same power.
  const finishPane = () => (
    <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'শেষ' : 'Done'} onPress={() => { void finish(); }} style={styles.finish}>
      <AppIcon name="check" size={22} color="#FFFFFF" />
      <Text style={styles.finishText}>{bn ? 'শেষ' : 'Done'}</Text>
    </Pressable>
  );
  return (
    <ReanimatedSwipeable ref={swipe} enabled={canFinish} friction={2} overshootRight={false} renderRightActions={finishPane}>
    <Pressable accessibilityRole="button" accessibilityLabel={displayName(contact)} onPress={onPress} onLongPress={() => setMenu(true)} delayLongPress={350}
      style={({ pressed }) => [styles.row, urgent && styles.urgent, pressed && styles.pressed]}>
      <BrandLogo brand={brandFor(contact.channel, contact.phone)} size={46} />
      <View style={styles.main}>
        <View style={styles.top}>
          <Text numberOfLines={1} style={[styles.name, contact.unread > 0 && styles.bold]}>{displayName(contact)}</Text>
          <Text style={styles.when}>{when}</Text>
          <ChatMenuButton contact={contact} size={20} shown={menu} onShownChange={setMenu} />
        </View>
        <Text numberOfLines={1} style={styles.source}>{sourceLabel(contact.phone, contact.channel, bn)}</Text>
        <Text numberOfLines={2} style={styles.preview}>{contact.summary || contact.preview || (bn ? 'কোনো বার্তা নেই' : 'No message')}</Text>
        <View style={styles.badges}>
          {contact.priority <= 2 || contact.unread > 0 ? <AppBadge label={bn ? pr.bn : pr.en} tone={pr.tone} /> : null}
          {contact.category ? <AppBadge label={bn ? CATEGORY[contact.category].bn : CATEGORY[contact.category].en} tone={CATEGORY[contact.category].tone} /> : null}
          {(contact.tags ?? []).slice(0, 3).map((t) => <AppBadge key={t.label} label={`${t.important ? '★ ' : ''}${t.label}${t.value ? `: ${t.value}` : ''}`} tone={t.important ? 'danger' : 'primary'} />)}
          {contact.is_family ? <AppBadge label={bn ? 'পরিবার' : 'Family'} tone="success" /> : null}
          {contact.is_vip ? <AppBadge label="VIP" tone="primary" /> : null}
          <AppBadge label={brandName(brandFor(contact.channel, contact.phone))} tone="neutral" />
          {contact.unread > 0 ? <AppBadge label={bn ? `${contact.unread}টি নতুন` : `${contact.unread} new`} tone="danger" /> : null}
        </View>
      </View>
    </Pressable>
    </ReanimatedSwipeable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.smd, padding: spacing.md, minHeight: control.rowMinHeight, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
  urgent: { borderColor: colors.danger, borderWidth: border.medium },
  pressed: { opacity: 0.92 },
  finish: { width: 84, marginLeft: spacing.xs, borderRadius: radius.lg, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', gap: 2 },
  finishText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  icon: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryTint },
  main: { flex: 1, gap: spacing.xs },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  name: { flex: 1, color: colors.textPrimary, fontSize: 16 },
  bold: { fontWeight: '700' },
  when: { color: colors.textMuted, fontSize: 12 },
  source: { color: colors.textMuted, fontSize: 12 },
  preview: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
});
