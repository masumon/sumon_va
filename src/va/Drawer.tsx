import { useEffect, useMemo } from 'react';
import { AppState, Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, usePathname } from 'expo-router';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText as Text } from '../ui/AppText';
import { AppIcon } from '../ui/AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { border, radius, spacing, type ThemeColors } from '../theme';
import type { DesignTokens } from '../theme/designs';
import { getStatus } from '../../modules/va-bridge';
import { MENU } from './menu';
import { useShell } from './shell';
import { PoweredBy } from './BrandMark';

const LOGO = require('../../assets/icon.png');

/** The side menu: who is signed in, every part of the app, language and theme, and sign out. */
export function Drawer() {
  const { colors, language, reduceMotion, design, accents } = useAppPreferences();
  const bn = language === 'bn';
  const { drawer, close } = useShell();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, design), [colors, design]);
  const panel = Math.min(320, width * 0.86);
  const x = useSharedValue(-panel);
  const bridge = getStatus();

  // The menu always starts shut and shuts whenever the screen changes or the app comes back (owner bug, 2026-11-05).
  useEffect(() => { close(); }, [pathname, close]);
  useEffect(() => {
    close();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') close(); });
    return () => sub.remove();
  }, [close]);

  useEffect(() => {
    x.value = withTiming(drawer ? 0 : -panel, { duration: reduceMotion ? 0 : 220, easing: Easing.out(Easing.cubic) });
  }, [drawer, panel, reduceMotion, x]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const veil = useAnimatedStyle(() => ({ opacity: 1 + x.value / panel }));

  const go = (href: string) => { close(); router.push(href as never); };
  // Every menu entry gets its own coloured icon tile, cycling through the theme's accent families.
  const TILE = ['blue', 'green', 'orange', 'purple', 'yellow', 'red'] as const;
  let tileIndex = 0;

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents={drawer ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.veil, veil]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={bn ? 'মেনু বন্ধ করুন' : 'Close menu'} onPress={close} />
      </Animated.View>
      <Animated.View style={[styles.panel, { width: panel, paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.sm }, slide]}>
        <LinearGradient colors={design.drawerGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.account}>
          <View style={styles.avatar}><Image source={LOGO} style={styles.logo} accessibilityLabel={bn ? 'সুমনের ভার্চুয়াল সহকারী' : "Sumon's Virtual Assistant"} /></View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.name}>{bridge.accountName || (bn ? 'মালিক' : 'Owner')}</Text>
            <Text numberOfLines={1} style={styles.email}>{bridge.accountEmail || (bridge.accountName ? `${bn ? 'Telegram/ফোন লগইন' : 'Telegram/phone login'}` : (bn ? 'এই ফোন জোড়া আছে' : 'This phone is paired'))}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'বন্ধ' : 'Close'} onPress={close} style={styles.x}><AppIcon name="close" size={22} color="#FFFFFF" /></Pressable>
        </LinearGradient>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.md }}>
          {MENU.map((section) => (
            <View key={section.key} style={{ marginTop: spacing.md }}>
              <Text style={styles.section}>{bn ? section.bn : section.en}</Text>
              {section.items.map((item) => {
                const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const tile = accents[TILE[tileIndex++ % TILE.length]!];
                return (
                  <Pressable key={item.href} accessibilityRole="button" onPress={() => go(item.href)} style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && { opacity: 0.9 }]}>
                    <View style={[styles.tile, { backgroundColor: tile.base }]}><AppIcon name={item.icon} size={20} color="#FFFFFF" /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemLabel, active && { color: colors.primary }]}>{bn ? item.bn : item.en}</Text>
                      <Text numberOfLines={1} style={styles.itemHint}>{bn ? item.hintBn : item.hintEn}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
        <View style={{ gap: spacing.sm }}>
          <Text style={{ textAlign: 'center', fontSize: 12, opacity: 0.7, paddingHorizontal: spacing.sm }}>{bn ? 'এই ফোন শুধু অ্যাডমিন থেকে সরানো যায় (Find Hub-এর মতো)' : 'This phone can only be removed from the admin (like Find Hub)'}</Text>
          <PoweredBy />
        </View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors, design: DesignTokens) => StyleSheet.create({
  // On Android a view with elevation (the bottom bar) is drawn above later siblings; the menu needs a higher elevation to cover it.
  layer: { zIndex: 1000, elevation: 1000 },
  veil: { backgroundColor: colors.overlay },
  panel: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.surface, paddingHorizontal: spacing.md, borderRightWidth: border.thin, borderRightColor: colors.border, justifyContent: 'space-between', elevation: 1001 },
  account: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, padding: spacing.md, borderRadius: design.radiusCard, overflow: 'hidden', ...(design.heroShadow ?? {}) },
  avatar: { width: 60, height: 60, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  logo: { width: 52, height: 52, borderRadius: 14 },
  name: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  email: { color: 'rgba(255,255,255,0.88)', fontSize: 12 },
  tile: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  x: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 4, marginLeft: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, minHeight: 52, paddingHorizontal: spacing.smd, borderRadius: design.radiusButton },
  itemActive: { backgroundColor: colors.primaryTint },
  itemLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  itemHint: { color: colors.textMuted, fontSize: 12 },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  pill: { paddingHorizontal: 14, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
});
