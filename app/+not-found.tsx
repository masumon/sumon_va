// Where a link that no longer goes anywhere lands.
//
// Without this file expo-router serves its own built-in screen: English, permanently dark
// whatever the app's theme is, and carrying a "Sitemap" link into a development-only route
// that crashes a release build outright (it reads `window.location.origin`, which does not
// exist on a phone). So a stale reminder or a mistyped `apon://` link could take someone
// from a Bengali app to an English error page to a hard crash back at the launcher.
//
// A dead link is an ordinary thing. It should look like the rest of the app, say what
// happened in the user's language, and offer the way back.

import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppIcon } from '../src/ui/AppIcon';
import { useKit } from '../src/ui/AppKit';
import { tapLight } from '../src/ui/haptics';
import { border, control, radius, spacing, typography } from '../src/theme';

export default function NotFoundScreen() {
  const { colors, accents, bn } = useKit();
  const pathname = usePathname();

  const goHome = () => { tapLight(); router.replace('/'); };
  const goBack = () => { tapLight(); if (router.canGoBack()) router.back(); else router.replace('/'); };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.icon, { backgroundColor: accents.orange.soft }]}>
          <AppIcon name="link-variant-off" size={32} color={accents.orange.on} />
        </View>

        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>
          {bn ? 'এই পাতাটি নেই' : 'This page does not exist'}
        </Text>

        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {bn
            ? 'যে লিংক দিয়ে আসা হয়েছে সেটি আর কোথাও যায় না — হয়তো পুরোনো, নয়তো ভুল লেখা। আপনার কোনো তথ্য হারায়নি।'
            : 'The link you followed no longer goes anywhere — it may be out of date, or mistyped. Nothing of yours has been lost.'}
        </Text>

        {pathname ? (
          <Text numberOfLines={2} style={[styles.path, { color: colors.textMuted, backgroundColor: colors.surfaceMuted }]}>
            {pathname}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bn ? 'হোমে যান' : 'Go home'}
          onPress={goHome}
          style={({ pressed }) => StyleSheet.flatten([styles.primary, { backgroundColor: colors.primary }, pressed && styles.pressed])}
        >
          <AppIcon name="home-outline" size={control.iconSize} color={colors.onPrimary} />
          <Text numberOfLines={1} style={[styles.primaryText, { color: colors.onPrimary }]}>
            {bn ? 'হোমে যান' : 'Go home'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bn ? 'ফিরুন' : 'Go back'}
          onPress={goBack}
          style={({ pressed }) => StyleSheet.flatten([styles.ghost, { borderColor: colors.border, backgroundColor: colors.surface }, pressed && styles.pressed])}
        >
          <AppIcon name="arrow-left" size={control.iconSize} color={colors.primary} />
          <Text numberOfLines={1} style={[styles.ghostText, { color: colors.primary }]}>
            {bn ? 'ফিরুন' : 'Go back'}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, gap: spacing.sm },
  icon: { width: 72, height: 72, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  title: { ...typography.titleLarge, fontWeight: '700', textAlign: 'center' },
  body: { ...typography.body, textAlign: 'center', maxWidth: 420, marginBottom: spacing.sm },
  path: { ...typography.caption, textAlign: 'center', maxWidth: '100%', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.md, marginBottom: spacing.md },
  primary: { minHeight: control.buttonHeight, minWidth: 200, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
  primaryText: { ...typography.callout, fontWeight: '800', flexShrink: 1 },
  ghost: { minHeight: control.buttonHeight, minWidth: 200, borderWidth: border.thin, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, marginTop: spacing.xs },
  ghostText: { ...typography.callout, fontWeight: '800', flexShrink: 1 },
  pressed: { opacity: 0.78 },
});
