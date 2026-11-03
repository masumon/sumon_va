import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { AppText as Text } from '../ui/AppText';
import { AppIcon } from '../ui/AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { border, radius, spacing, type ThemeColors } from '../theme';
import { getStatus } from '../../modules/va-bridge';
import { va } from './api';
import { useLoad } from './hooks';
import { titleFor } from './menu';
import { useShell } from './shell';
import { THEME_OPTIONS } from './labels';


/** The top bar on every signed-in screen: menu, logo and title, connection light, urgent bell, and your initial. */
export function AppHeader() {
  const { colors, language } = useAppPreferences();
  const bn = language === 'bn';
  const pathname = usePathname();
  const open = useShell((s) => s.open);
  const refresh = useShell((s) => s.refresh);
  const [spin, setSpin] = useState(false);
  const doRefresh = () => { refresh(); setSpin(true); setTimeout(() => setSpin(false), 900); };
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const overview = useLoad(() => va.overview(), 'header-overview', 30000, { always: true });
  const bridge = getStatus();
  const urgent = overview.data?.urgent ?? 0;
  // green = the phone service is running and the last sync worked; amber = something needs a look; grey = no answer yet
  const light = bridge.serviceAlive && !bridge.lastError ? colors.success : bridge.lastError ? colors.warning : colors.textMuted;
  const initial = (bridge.accountName || bridge.accountEmail || 'S').trim().charAt(0).toUpperCase();

  const { themeSetting, setThemeMode, setLanguage } = useAppPreferences();
  // One tap cycles the look: auto -> day -> night -> low light; the icon always shows the current one.
  const order = ['system', 'light', 'dark', 'dim'] as const;
  const themeIcon = themeSetting === 'light' ? 'white-balance-sunny' : themeSetting === 'dark' ? 'weather-night' : themeSetting === 'dim' ? 'moon-waning-crescent' : 'theme-light-dark';
  const nextTheme = () => void setThemeMode(order[(order.indexOf(themeSetting as (typeof order)[number]) + 1) % order.length]!);
  const themeLabel = THEME_OPTIONS.find((t) => t.value === themeSetting);

  return (
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'মেনু খুলুন' : 'Open menu'} onPress={open} style={styles.iconBtn} hitSlop={4}>
        <AppIcon name="menu" size={26} color={colors.textPrimary} />
      </Pressable>
      <Text numberOfLines={1} style={styles.title}>{titleFor(pathname, bn)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? `রং: ${themeLabel?.bn ?? ''} — বদলান` : `Theme: ${themeLabel?.en ?? ''} — change`} onPress={nextTheme} style={styles.iconBtn} hitSlop={4}>
        <AppIcon name={themeIcon} size={22} color={colors.textPrimary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'ভাষা বদলান' : 'Change language'} onPress={() => void setLanguage(bn ? 'en' : 'bn')} style={styles.langBtn} hitSlop={4}>
        <Text style={styles.langText}>{bn ? 'EN' : 'বাং'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'AI সংযোগ' : 'AI connections'} onPress={() => router.push('/ai' as never)} style={styles.iconBtn} hitSlop={4}>
        <AppIcon name="brain" size={22} color={colors.textPrimary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'রিফ্রেশ' : 'Refresh'} onPress={doRefresh} style={styles.iconBtn} hitSlop={4}>
        <AppIcon name={spin ? 'timer-sand' : 'refresh'} size={22} color={colors.textPrimary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'জরুরি বার্তা' : 'Urgent messages'} onPress={() => router.push({ pathname: '/inbox', params: { view: 'urgent' } } as never)} style={styles.iconBtn} hitSlop={4}>
        <AppIcon name={urgent ? 'bell-badge' : 'bell-outline'} size={24} color={urgent ? colors.danger : colors.textPrimary} />
        {urgent ? <View style={styles.badge}><Text style={styles.badgeText}>{urgent > 9 ? '9+' : urgent}</Text></View> : null}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'অ্যাকাউন্ট ও মেনু' : 'Account and menu'} onPress={open} style={styles.avatar}>
        <Text style={styles.avatarText}>{initial}</Text>
        <View style={[styles.light, { backgroundColor: light }]} accessibilityLabel={bn ? 'সংযোগের অবস্থা' : 'Connection status'} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: spacing.sm, height: 56, backgroundColor: colors.surface, borderBottomWidth: border.thin, borderBottomColor: colors.border },
  iconBtn: { width: 38, height: 44, alignItems: 'center', justifyContent: 'center' },
  langBtn: { minWidth: 34, height: 28, paddingHorizontal: 6, borderRadius: 8, borderWidth: border.thin, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  langText: { color: colors.textPrimary, fontWeight: '700', fontSize: 12 },
  title: { flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  light: { position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.surface },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
});
