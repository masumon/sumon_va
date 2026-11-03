import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, PanResponder, Pressable, StyleSheet, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AponMark } from './AponMark';
import { useAppPreferences } from '../app/AppPreferences';
import { tapLight, tapSelect } from './haptics';
import { getWindowSizeClass, layout, spacing } from '../theme';

const SIZE = 58;
const EDGE = spacing.md;
const KEY = 'fab.apon.position';

type Spot = { side: 'left' | 'right'; y: number };

/**
 * আপন, one tap away on every main page (the user's request for 1.0 — it left the tab bar
 * so "আরও" could have that slot).
 *
 * Tap opens আপন. Press and hold, then drag, moves it — a plain touch-and-drag would move it
 * by accident every time someone scrolled past it. Let go and it settles on the nearer
 * side, clear of the tab bar, and stays there next time. It steps aside while the keyboard
 * is open. Shown only where the tab bar is (the layout decides), so it never sits over a
 * form's Save bar.
 */
export function FloatingApon() {
  const db = useSQLiteContext();
  const { colors, language } = useAppPreferences();
  const bn = language === 'bn';
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const expandedNav = getWindowSizeClass(width) === 'expanded';

  // Where it may go: below the status bar, above the tab bar (or the screen edge on a
  // tablet, where the bar sits on the left instead).
  const minY = insets.top + spacing.xl;
  const maxY = height - SIZE - spacing.md - (expandedNav ? insets.bottom : layout.compactNavHeight + insets.bottom);
  const leftX = (expandedNav ? layout.expandedNavWidth : 0) + EDGE;
  const rightX = width - SIZE - EDGE;
  const clampY = (y: number) => Math.min(Math.max(y, minY), Math.max(minY, maxY));
  // First place: right side, a little above the tab bar and the pages' own + buttons.
  // Until the person moves it: right side, just above the tab bar — clear of tiles and row
  // arrows. Worked out from the screen as it is now, every time (the first render's size used
  // to be frozen in, which left it mid-screen — rc.15 phone check).
  const [saved, setSaved] = useState<Spot | null>(null);
  const spot: Spot = saved ?? { side: 'right', y: maxY };
  const firstSpot = spot;
  const [keyboard, setKeyboard] = useState(false);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  // Whether the drag actually started moving, so a hold-and-let-go still settles it.
  const grantedRef = useRef(false);
  // Made once and kept (state, not a ref, so reading it while rendering is allowed).
  const [pan] = useState(() => new Animated.ValueXY({ x: rightX, y: firstSpot.y }));
  const at = useRef({ x: rightX, y: firstSpot.y });

  useEffect(() => {
    const id = pan.addListener((v) => { at.current = v; });
    return () => pan.removeListener(id);
  }, [pan]);

  // The remembered place, read once.
  useEffect(() => {
    let alive = true;
    void db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', KEY)
      .then((row) => {
        if (!alive || !row) return;
        const stored = JSON.parse(row.value) as Partial<Spot>;
        if ((stored.side === 'left' || stored.side === 'right') && typeof stored.y === 'number') setSaved({ side: stored.side, y: stored.y });
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [db]);

  // Keep it on its side and on screen when the place, the screen size or the bars change.
  useEffect(() => {
    if (draggingRef.current) return;
    pan.setValue({ x: spot.side === 'left' ? leftX : rightX, y: clampY(spot.y) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot.side, spot.y, leftX, rightX, minY, maxY]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const settle = () => {
    const side: Spot['side'] = at.current.x + SIZE / 2 < width / 2 ? 'left' : 'right';
    const y = clampY(at.current.y);
    const next = { side, y };
    Animated.spring(pan, { toValue: { x: side === 'left' ? leftX : rightX, y }, useNativeDriver: false, friction: 7 }).start();
    setSaved(next);
    void db.runAsync('INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)', KEY, JSON.stringify(next)).catch(() => undefined);
    draggingRef.current = false;
    setDragging(false);
  };

  // The handlers below read the refs only when a finger moves — PanResponder.create never
  // calls them while rendering (React Native's documented pattern). The lint rule cannot
  // see that, and the React Compiler is not enabled here, so the rule is silenced for this
  // one call only.
  // eslint-disable-next-line react-hooks/refs
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: () => draggingRef.current,
    onMoveShouldSetPanResponderCapture: () => draggingRef.current,
    onPanResponderGrant: () => {
      grantedRef.current = true;
      pan.setOffset({ x: at.current.x, y: at.current.y });
      pan.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
    onPanResponderRelease: () => { grantedRef.current = false; pan.flattenOffset(); settle(); },
    onPanResponderTerminate: () => { grantedRef.current = false; pan.flattenOffset(); settle(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pan, width, height, leftX, rightX, minY, maxY]);

  if (keyboard) return null;

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[styles.host, { transform: pan.getTranslateTransform() }, dragging && styles.lifted]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bn ? 'আপনকে জিজ্ঞেস করুন' : 'Ask আপন'}
        accessibilityHint={bn ? 'চেপে ধরে টেনে সরানো যায়' : 'Press and hold, then drag, to move it'}
        onPress={() => { if (!draggingRef.current) { tapLight(); router.push('/assistant' as never); } }}
        onLongPress={() => { draggingRef.current = true; setDragging(true); tapSelect(); }}
        delayLongPress={300}
        onPressOut={() => { if (draggingRef.current) setTimeout(() => { if (draggingRef.current && !grantedRef.current) settle(); }, 200); }}
        style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, borderColor: colors.surface }, dragging && styles.buttonLifted, pressed && !dragging && styles.pressed]}
      >
        <AponMark size={34} progress={1} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Above the page and the tab bar; Android stacks by elevation, not zIndex.
  host: { position: 'absolute', left: 0, top: 0, zIndex: 45, elevation: 14 },
  button: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center', shadowColor: '#131A2E', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 14 },
  lifted: { opacity: 0.9 },
  buttonLifted: { transform: [{ scale: 1.1 }] },
  pressed: { opacity: 0.8 },
});

/**
 * A main page's list style, kept as the page wrote it (rc.16 look). Reserving the button's
 * height left an empty band under every page (rc.18); the button can be dragged instead.
 */
export const FAB_ROOM = SIZE + spacing.md;
export function withFabRoom(style: StyleProp<ViewStyle>): ViewStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
  // The page keeps its own end padding, as in rc.16 — reserving the button's height left a
  // nav-bar-sized empty band under every page (rc.18 phone check); the button can be dragged.
  return flat;
}
