import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView , Animated, Image, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { pdfPagesAvailable, renderPdfPages } from '../../modules/pdf-pages';
import { GestureDetector, GestureHandlerRootView, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { useVideoPlayer, VideoView } from 'expo-video';
import { AppText as Text } from './AppText';
import { AppIcon } from './AppIcon';
import { AppConfirmDialog } from './AppFeedback';
import { useAppPreferences } from '../app/AppPreferences';
import { control, layout, radius, spacing, typography } from '../theme';
import { asciiDigitsToBengali } from '../services/debt/money';

export interface ViewerItem { uri: string; name: string; mimeType: string }

// B-10b: the one full-screen viewer — photos with pinch-zoom (Android included: the old
// ScrollView zoom only ever worked on iOS), video with controls, share, and delete that
// asks first. Zoom is Gesture Handler (see ZoomableImage).
export function MediaViewer({ item, onClose, onShare, onDelete }: {
  item: ViewerItem | null;
  onClose: () => void;
  onShare?: (item: ViewerItem) => void;
  onDelete?: (item: ViewerItem) => void;
}) {
  const { language } = useAppPreferences();
  const bn = language === 'bn';
  const { width, height } = useWindowDimensions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isVideo = item?.mimeType.startsWith('video/') ?? false;
  const isImage = item?.mimeType.startsWith('image/') ?? false;
  const isPdf = (item?.mimeType.includes('pdf') ?? false) || /\.pdf$/iu.test(item?.name ?? '');
  const player = useVideoPlayer(isVideo && item ? item.uri : null, (p) => { p.loop = false; });
  useEffect(() => {
    if (!isVideo) return;
    try { player.play(); } catch { /* noop */ }
    return () => { try { player.pause(); } catch { /* noop */ } };
  }, [isVideo, player]);

  return (
    <Modal visible={Boolean(item)} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {/* Android: gestures inside a Modal need their own root view. */}
      <GestureHandlerRootView style={styles.root}>
      <View style={styles.backdrop}>
        <View style={styles.bar}>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'বন্ধ করুন' : 'Close'} onPress={onClose} style={styles.barButton}><AppIcon name="close" size={control.iconSize} color="#FFFFFF" /></Pressable>
          <View style={styles.barSpacer} />
          {item && onShare ? <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'শেয়ার' : 'Share'} onPress={() => onShare(item)} style={styles.pillButton}><AppIcon name="share-variant-outline" size={20} color="#FFFFFF" /><Text style={styles.pillText}>{bn ? 'শেয়ার' : 'Share'}</Text></Pressable> : null}
          {item && onDelete ? <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'মুছুন' : 'Delete'} onPress={() => setConfirmDelete(true)} style={[styles.pillButton, styles.pillDanger]}><AppIcon name="delete-outline" size={20} color="#FFFFFF" /><Text style={styles.pillText}>{bn ? 'মুছুন' : 'Delete'}</Text></Pressable> : null}
        </View>
        {item ? (isVideo
          ? <VideoView player={player} style={{ width, height: height * 0.72 }} contentFit="contain" nativeControls />
          : isImage
            ? <ZoomableImage key={`${item.uri}|${width}x${height}`} uri={item.uri} width={width} height={height * 0.8} />
            : isPdf && pdfPagesAvailable
              ? <PdfPages key={item.uri} uri={item.uri} width={width} height={height * 0.8} bn={bn} />
              : <AppIcon name={item.mimeType.includes('pdf') ? 'file-pdf-box' : 'file-document-outline'} size={96} color="#FFFFFF" />) : null}
        <Text numberOfLines={2} style={styles.name}>{item?.name}</Text>
        {isImage ? <Text style={styles.hint}>{bn ? 'দুই আঙুলে বড়-ছোট করুন · দুবার ছুঁলে বড় হবে' : 'Pinch to zoom · double-tap to zoom in'}</Text> : null}
        {isPdf && pdfPagesAvailable ? <Text style={styles.hint}>{bn ? 'পাতা ছুঁলে বড় হবে · দুই আঙুলে বড়-ছোট করুন' : 'Tap a page to zoom · pinch to resize'}</Text> : null}
        {item && !isImage && !isVideo && !(isPdf && pdfPagesAvailable) ? <Text style={styles.hint}>{bn ? 'এই ফাইলটি অন্য অ্যাপে খুলতে উপরের "শেয়ার" চাপুন' : 'Tap Share above to open this file in another app'}</Text> : null}
      </View>
      </GestureHandlerRootView>
      <AppConfirmDialog
        visible={confirmDelete}
        title={bn ? 'এই ফাইলটি মুছবেন?' : 'Delete this file?'}
        description={item?.name}
        confirmLabel={bn ? 'মুছুন' : 'Delete'}
        cancelLabel={bn ? 'বাতিল' : 'Cancel'}
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); if (item && onDelete) onDelete(item); }}
      />
    </Modal>
  );
}

// RC.1 QA: the PanResponder version never saw the second finger inside an Android Modal,
// so only double-tap zoomed. Gesture Handler reads multi-touch natively; it already ships in
// the APK (expo-router uses it), so nothing new is installed. Callbacks run on the JS thread
// against the same Animated values as before.
function ZoomableImage({ uri, width, height }: { uri: string; width: number; height: number }) {
  // Created once per image (the caller keys this by uri and size).
  const [z] = useState(() => makeZoom(width, height));
  const pinch = usePinchGesture({ runOnJS: true, onBegin: () => z.pinchStart(), onUpdate: (e) => z.pinchTo(e.scale), onFinalize: () => z.settle() });
  const pan = usePanGesture({ runOnJS: true, onBegin: () => z.panStart(), onUpdate: (e) => z.panBy(e.translationX, e.translationY), onFinalize: () => z.settle() });
  const doubleTap = useTapGesture({ runOnJS: true, numberOfTaps: 2, onActivate: () => z.toggle() });
  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);
  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height, overflow: 'hidden' }} collapsable={false}>
        <Animated.View style={{ flex: 1, transform: [{ translateX: z.tx }, { translateY: z.ty }, { scale: z.scale }] }}>
          <Image source={{ uri }} style={{ width, height }} resizeMode="contain" />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

// A PDF drawn page by page with Android's own renderer (modules/pdf-pages) — read inside the
// app instead of needing a separate PDF reader (RC.1 QA). A page tapped opens in the same
// pinch-zoom view photos use.
function PdfPages({ uri, width, height, bn }: { uri: string; width: number; height: number; bn: boolean }) {
  const [state, setState] = useState<{ pages: string[]; total: number } | 'loading' | 'failed'>('loading');
  const [zoomed, setZoomed] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    renderPdfPages(uri, Math.min(1600, width * 2)).then((r) => { if (alive) setState(r); }).catch(() => { if (alive) setState('failed'); });
    return () => { alive = false; };
  }, [uri, width]);
  if (state === 'loading') return <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#FFFFFF" size="large" /></View>;
  if (state === 'failed') return <View style={{ width, height, alignItems: 'center', justifyContent: 'center', padding: spacing.lg }}><AppIcon name="file-pdf-box" size={96} color="#FFFFFF" /><Text style={styles.hint}>{bn ? 'এই PDF খোলা গেল না — উপরের "শেয়ার" চেপে অন্য অ্যাপে খুলুন' : 'This PDF could not be opened — use Share above to open it elsewhere'}</Text></View>;
  if (zoomed) {
    return (
      <View>
        <ZoomableImage key={zoomed} uri={zoomed} width={width} height={height - 56} />
        <Pressable accessibilityRole="button" onPress={() => setZoomed(null)} style={styles.pdfBack}>
          <AppIcon name="arrow-left" size={control.iconSize} color="#FFFFFF" />
          <Text style={styles.pdfBackText}>{bn ? 'সব পাতায় ফিরুন' : 'Back to all pages'}</Text>
        </Pressable>
      </View>
    );
  }
  const pageHeight = Math.round(width * 1.414);
  return (
    <ScrollView style={{ width, height }} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
      {state.pages.map((page, index) => (
        <Pressable key={page} accessibilityRole="button" accessibilityLabel={bn ? `পাতা ${index + 1} বড় করে দেখুন` : `Zoom page ${index + 1}`} onPress={() => setZoomed(page)}>
          <Image source={{ uri: page }} style={{ width, height: pageHeight, backgroundColor: '#FFFFFF' }} resizeMode="contain" />
        </Pressable>
      ))}
      {state.total > state.pages.length ? <Text style={styles.hint}>{bn ? `প্রথম ${asciiDigitsToBengali(String(state.pages.length))}টি পাতা দেখানো হলো — বাকিগুলো "শেয়ার" দিয়ে অন্য অ্যাপে দেখুন` : `Showing the first ${state.pages.length} pages — use Share for the rest`}</Text> : null}
    </ScrollView>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function makeZoom(width: number, height: number) {
  const scale = new Animated.Value(1);
  const tx = new Animated.Value(0);
  const ty = new Animated.Value(0);
  const st = { scale: 1, x: 0, y: 0, startScale: 1, startX: 0, startY: 0 };
  const limits = () => ({ maxX: (width * (st.scale - 1)) / 2, maxY: (height * (st.scale - 1)) / 2 });
  const spring = (v: Animated.Value, to: number) => Animated.spring(v, { toValue: to, useNativeDriver: true });
  const reset = () => {
    Object.assign(st, { scale: 1, x: 0, y: 0 });
    Animated.parallel([spring(scale, 1), spring(tx, 0), spring(ty, 0)]).start();
  };
  return {
    scale, tx, ty,
    pinchStart: () => { st.startScale = st.scale; },
    pinchTo: (factor: number) => { st.scale = clamp(st.startScale * factor, 1, 5); scale.setValue(st.scale); },
    panStart: () => { st.startX = st.x; st.startY = st.y; },
    panBy: (dx: number, dy: number) => {
      if (st.scale <= 1) return;
      const { maxX, maxY } = limits();
      st.x = clamp(st.startX + dx, -maxX, maxX); st.y = clamp(st.startY + dy, -maxY, maxY);
      tx.setValue(st.x); ty.setValue(st.y);
    },
    settle: () => {
      if (st.scale <= 1.02) { reset(); return; }
      const { maxX, maxY } = limits();
      st.x = clamp(st.x, -maxX, maxX); st.y = clamp(st.y, -maxY, maxY);
      Animated.parallel([spring(tx, st.x), spring(ty, st.y)]).start();
    },
    toggle: () => {
      if (st.scale > 1) { reset(); return; }
      st.scale = 2.5; spring(scale, 2.5).start();
    },
  };
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pdfBack: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 48, paddingHorizontal: spacing.md },
  pdfBackText: { color: '#FFFFFF', ...typography.callout, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', top: spacing.xl, left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, zIndex: 2 },
  barSpacer: { flex: 1 },
  barButton: { width: layout.iconButtonSize, height: layout.iconButtonSize, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
    pillButton: { minHeight: layout.iconButtonSize, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.16)', flexDirection: 'row', alignItems: 'center', gap: 6 },
    pillDanger: { backgroundColor: 'rgba(220,53,69,0.55)' },
    pillText: { color: '#FFFFFF', ...typography.callout, fontWeight: '700' },
  name: { ...typography.meta, fontWeight: '800', color: '#FFFFFF', textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg },
  hint: { ...typography.caption, color: 'rgba(255,255,255,0.7)', marginTop: spacing.xxs },
});
