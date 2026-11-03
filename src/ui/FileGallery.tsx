// Every photo, video, PDF and file in the app, shown one way (the user's rule, RC.5).
//
// Before this, tasks and memories listed files as long rows with three small buttons,
// the money form had its own "proof" rows, test reports had their own mini buttons and
// the new-task/new-memory forms a fourth drop zone. One look now: a grid of tiles — a
// photo shows itself, a PDF or video shows what it is — and a "+" tile to add more.
// Tapping any tile opens it full screen (MediaViewer), where Share and Delete live, so
// the tile itself carries no row of tiny buttons.
//
// This component only draws. Where the files come from — saved with a record, or kept
// aside until the record is saved — is the caller's business (AttachmentPanel, the
// editors' drafts, the money form).

import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from './AppText';
import { AppIcon, type IconName } from './AppIcon';
import { AttachSourceSheet } from './AttachSourceSheet';
import { MediaViewer } from './MediaViewer';
import { useAppPreferences } from '../app/AppPreferences';
import { asciiDigitsToBengali } from '../services/debt/money';
import type { AttachSource } from '../services/attachment-sources';
import { border, control, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../theme';

export interface GalleryItem { id: string; name: string; uri: string; mimeType: string }

interface Kind { icon: IconName; label: { bn: string; en: string }; tone: 'blue' | 'red' | 'purple' | 'green' }
function kindOf(item: GalleryItem): Kind {
  const m = item.mimeType;
  if (m.startsWith('video/')) return { icon: 'play-circle-outline', label: { bn: 'ভিডিও', en: 'Video' }, tone: 'purple' };
  if (m.includes('pdf') || /\.pdf$/iu.test(item.name)) return { icon: 'file-pdf-box', label: { bn: 'PDF', en: 'PDF' }, tone: 'red' };
  if (m.startsWith('audio/')) return { icon: 'music-note-outline', label: { bn: 'অডিও', en: 'Audio' }, tone: 'green' };
  return { icon: 'file-document-outline', label: { bn: 'ফাইল', en: 'File' }, tone: 'blue' };
}

export function FileGallery({
  items, onPick, onShare, onRemove, onOpenOther, busy = false, title, hint, compact = false, header = !compact,
}: {
  items: readonly GalleryItem[];
  /** Camera, gallery or file was chosen. Omit for a read-only gallery. */
  onPick?: (source: AttachSource) => void;
  onShare?: (item: GalleryItem) => void;
  onRemove?: (item: GalleryItem) => void;
  /** A file the app cannot show itself (a Word file, say): open it in another app. */
  onOpenOther?: (item: GalleryItem) => void;
  busy?: boolean;
  /** Defaults to "ছবি ও ফাইল". */
  title?: string;
  /** One plain line under the title — what belongs here. */
  hint?: string;
  /** Smaller tiles and no big header — for a file list inside a card row. */
  compact?: boolean;
  /** The title row. Off inside a card that already has its own title; the hint still shows. */
  header?: boolean;
}) {
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const s = useMemo(() => makeStyles(colors, accents, compact), [colors, accents, compact]);
  const [choosing, setChoosing] = useState(false);
  const [viewing, setViewing] = useState<GalleryItem | null>(null);
  const count = bn ? asciiDigitsToBengali(String(items.length)) : String(items.length);

  const open = (item: GalleryItem) => {
    const k = kindOf(item);
    const showable = item.mimeType.startsWith('image/') || item.mimeType.startsWith('video/') || k.icon === 'file-pdf-box';
    if (!showable && onOpenOther) onOpenOther(item); else setViewing(item);
  };
  const add = () => { if (!busy && onPick) setChoosing(true); };

  return (
    <View style={s.wrap}>
      {!header ? (hint ? <Text style={s.hint}>{hint}</Text> : null) : (
        <View style={s.head}>
          <View style={s.headCopy}>
            <View style={s.titleRow}>
              <AppIcon name="image-multiple-outline" size={control.iconSize} color={colors.primary} />
              <Text numberOfLines={2} style={s.title}>{title ?? (bn ? 'ছবি ও ফাইল' : 'Photos & files')}</Text>
              {items.length ? <View style={s.count}><Text style={s.countText}>{count}</Text></View> : null}
            </View>
            {hint ? <Text style={s.hint}>{hint}</Text> : null}
          </View>
          {onPick && items.length ? (
            <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'ছবি বা ফাইল যোগ করুন' : 'Add a photo or file'} disabled={busy} onPress={add} style={({ pressed }) => StyleSheet.flatten([s.addBtn, busy && s.disabled, pressed && s.pressed])}>
              {busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <><AppIcon name="plus" size={control.iconSize} color={colors.onPrimary} /><Text style={s.addText}>{bn ? 'যোগ করুন' : 'Add'}</Text></>}
            </Pressable>
          ) : null}
        </View>
      )}

      {items.length === 0 ? (
        onPick ? (
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'ছবি বা ফাইল যোগ করুন' : 'Add a photo or file'} disabled={busy} onPress={add} style={({ pressed }) => StyleSheet.flatten([s.empty, pressed && s.pressed])}>
            {busy ? <ActivityIndicator color={colors.primary} /> : (
              <View style={s.emptyIcons}>
                {(['camera-outline', 'image-outline', 'file-pdf-box'] as IconName[]).map((name) => (
                  <View key={name} style={s.emptyIcon}><AppIcon name={name} size={compact ? 20 : 24} color={colors.primary} /></View>
                ))}
              </View>
            )}
            <Text style={s.emptyTitle}>{bn ? 'ছবি তুলুন, গ্যালারি বা ফাইল থেকে যোগ করুন' : 'Take a photo, or add from the gallery or files'}</Text>
            {compact ? null : <Text style={s.emptyHint}>{bn ? 'সব এই ফোনেই থাকে' : 'Everything stays on this phone'}</Text>}
          </Pressable>
        ) : null
      ) : (
        <View style={s.grid}>
          {items.map((item) => {
            const isImage = item.mimeType.startsWith('image/');
            const k = kindOf(item);
            const tone = accents[k.tone];
            return (
              <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${bn ? 'খুলুন' : 'Open'}: ${item.name}`} onPress={() => open(item)} style={({ pressed }) => StyleSheet.flatten([s.tile, pressed && s.pressed])}>
                {isImage ? (
                  <Image source={{ uri: item.uri }} style={s.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
                ) : (
                  <View style={[s.fileFace, { backgroundColor: tone.soft }]}>
                    <AppIcon name={k.icon} size={compact ? 26 : 34} color={tone.on} />
                    <Text numberOfLines={compact ? 1 : 2} style={[s.fileName, { color: tone.on }]}>{item.name}</Text>
                  </View>
                )}
                {isImage ? null : <View style={[s.badge, { borderColor: tone.on }]}><Text style={[s.badgeText, { color: tone.on }]}>{bn ? k.label.bn : k.label.en}</Text></View>}
              </Pressable>
            );
          })}
          {onPick ? (
            <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'আরও যোগ করুন' : 'Add more'} disabled={busy} onPress={add} style={({ pressed }) => StyleSheet.flatten([s.tile, s.plusTile, pressed && s.pressed])}>
              {busy ? <ActivityIndicator color={colors.primary} /> : <><AppIcon name="plus" size={compact ? 24 : 30} color={colors.primary} /><Text style={s.plusText}>{bn ? 'আরও' : 'More'}</Text></>}
            </Pressable>
          ) : null}
        </View>
      )}

      <AttachSourceSheet visible={choosing} onClose={() => setChoosing(false)} onPick={(source) => { setChoosing(false); onPick?.(source); }} />
      <MediaViewer
        item={viewing}
        onClose={() => setViewing(null)}
        onShare={onShare ? (v) => { const it = items.find((x) => x.uri === v.uri); if (it) onShare(it); } : undefined}
        onDelete={onRemove ? (v) => { const it = items.find((x) => x.uri === v.uri); setViewing(null); if (it) onRemove(it); } : undefined}
      />
    </View>
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents, compact: boolean) {
  return StyleSheet.create({
    wrap: { gap: spacing.sm, marginTop: compact ? spacing.xs : spacing.md },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    headCopy: { flex: 1, minWidth: 0 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    title: { flexShrink: 1, color: colors.textPrimary, ...typography.cardTitle },
    count: { minWidth: 24, minHeight: 24, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: accents.blue.soft, alignItems: 'center', justifyContent: 'center' },
    countText: { color: accents.blue.on, ...typography.label, fontWeight: '700' },
    hint: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.xxs },
    addBtn: { minHeight: control.buttonHeight, borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    addText: { color: colors.onPrimary, ...typography.callout, fontWeight: '700' },
    empty: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: compact ? spacing.md : spacing.lg, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: colors.surface },
    emptyIcons: { flexDirection: 'row', gap: spacing.sm },
    emptyIcon: { width: compact ? 36 : 44, height: compact ? 36 : 44, borderRadius: radius.md, backgroundColor: accents.blue.soft, alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { color: colors.textPrimary, ...typography.callout, fontWeight: '700', textAlign: 'center' },
    emptyHint: { color: colors.textMuted, ...typography.caption, textAlign: 'center' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tile: { width: compact ? 84 : '31%', aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
    thumb: { width: '100%', height: '100%' },
    fileFace: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xs, gap: 2 },
    fileName: { ...typography.label, fontWeight: '600', textAlign: 'center' },
    badge: { position: 'absolute', left: 6, top: 6, borderRadius: radius.sm, borderWidth: border.thin, backgroundColor: colors.surface, paddingHorizontal: 6, paddingVertical: 1 },
    badgeText: { ...typography.label, fontWeight: '700' },
    plusTile: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: colors.surface },
    plusText: { color: colors.primary, ...typography.label, fontWeight: '700' },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.8 },
  });
}
