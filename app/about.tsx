import { useMemo } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useAppPreferences } from '../src/app/AppPreferences';
import { AppIcon } from '../src/ui/AppIcon';
import { border, control, elevation, icon, layout, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../src/theme';
import { asciiDigitsToBengali } from '../src/services/debt/money';

const APP_ICON = require('../assets/icon.png');
const YEAR = new Date().getFullYear();

// Lead designer's public links (shared with his consent; the email stays behind a button).
const DESIGNER = { facebook: 'https://www.facebook.com/fahimbd99', email: 'abdur.r3030@gmail.com' } as const;

export default function AboutScreen() {
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const c = bn
    ? {
        back: 'আরও',
        eyebrow: 'আপন',
        title: 'অ্যাপ সম্পর্কে',
        tagline: 'আপনার কাজ আর মনে রাখার জিনিসগুলো — সব এই ফোনেই, শুধু আপনার।',
        privacyTitle: 'আগে গোপনীয়তা, আগে অফলাইন',
        privacyText: 'কাজ, মেমোরি, সার্চ, পরিকল্পনা, রিমাইন্ডার আর ব্যাকআপ — সবই এই ফোনে চলে। নিজে ব্যাকআপ শেয়ার না করলে কোনো ডেটা কোথাও যায় না।',
        features: 'যা যা পাবেন',
        items: ['বাংলা ও ইংরেজি', 'লাইট ও ডার্ক থিম', 'সব তথ্য এই ফোনেই', 'অফলাইন বোঝাপড়া ও আপন', 'অফলাইন রিমাইন্ডার', 'ফাইলসহ পুরো ব্যাকআপ'],
        version: 'সংস্করণ',
        madeBy: 'তৈরি করেছেন',
        designBy: 'প্রধান ডিজাইনার',
        designFocus: 'ব্র্যান্ড আইডেন্টিটি · UI ডিজাইন · গ্রাফিক্স',
        designFb: 'ফাহিমের Facebook',
        designMail: 'ফাহিমকে ইমেইল করুন',
        legal: 'গোপনীয়তা নীতি ও শর্তাবলি',
        legalHint: 'অ্যাপেই পড়া যায়',
        rights: `© ${asciiDigitsToBengali(String(YEAR))} SUMON · সর্বস্বত্ব সংরক্ষিত`,
      }
    : {
        back: 'More',
        eyebrow: 'APON',
        title: 'About the app',
        tagline: 'Your work and the things you want to remember — all on this phone, only yours.',
        privacyTitle: 'Privacy first, offline first',
        privacyText: 'Tasks, memories, search, planning, reminders and backups all run on this device. Nothing leaves it unless you share a backup yourself.',
        features: 'What you get',
        items: ['Bangla and English', 'Light and dark themes', 'All data on the device', 'Offline understanding and assistant', 'Offline reminders', 'Full backup, files included'],
        version: 'Version',
        madeBy: 'Made by',
        designBy: 'Lead Designer',
        designFocus: 'Brand Identity · UI Design · Graphics',
        designFb: 'Fahim on Facebook',
        designMail: 'Email Fahim',
        legal: 'Privacy Policy & Terms',
        legalHint: 'read here in the app',
        rights: `© ${YEAR} SUMON · All rights reserved`,
      };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        {/* The same back link as every other screen (rc.7), not a lone boxed arrow. */}
        <Pressable accessibilityRole="button" accessibilityLabel={c.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/more' as never))} style={({ pressed }) => [styles.backLink, pressed && { opacity: 0.7 }]}>
          <AppIcon name="arrow-left" size={icon.md} color={colors.primary} />
          <Text style={styles.backLinkText}>{c.back}</Text>
        </Pressable>
        <View style={styles.brand}>
          <Image source={APP_ICON} style={styles.brandIcon} />
          <View style={styles.brandCopy}>
            <Text style={styles.eyebrow}>{c.eyebrow}</Text>
            <Text style={styles.title}>{c.title}</Text>
          </View>
        </View>
        <Text style={styles.tagline}>{c.tagline}</Text>

        <View style={styles.privacy}>
          <View style={styles.privacyIcon}><AppIcon name="shield-lock" size={icon.md} color={accents.green.on} /></View>
          <View style={styles.privacyCopy}>
            <Text style={styles.privacyTitle}>{c.privacyTitle}</Text>
            <Text style={styles.privacyText}>{c.privacyText}</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>{c.features}</Text>
        {c.items.map((item) => (
          <View key={item} style={styles.row}>
            <AppIcon name="check-circle" size={icon.sm} color={accents.green.base} />
            <Text style={styles.rowText}>{item}</Text>
          </View>
        ))}
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel={c.legal} onPress={() => router.push({ pathname: '/doc', params: { id: 'legal' } })} style={({ pressed }) => StyleSheet.flatten([styles.legalRow, pressed && styles.pressed])}>
        <View style={styles.legalIcon}><AppIcon name="file-document-outline" size={icon.md} color={accents.blue.on} /></View>
        <View style={styles.legalCopy}>
          <Text style={styles.legalTitle}>{c.legal}</Text>
          <Text style={styles.legalHint}>{c.legalHint}</Text>
        </View>
        <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
      </Pressable>

      <View style={styles.credits}>
        <Image source={APP_ICON} style={styles.creditsBadge} />
        <Text style={styles.creditsApp}>Apon <Text style={styles.creditsVersion}>{c.version} {version}</Text></Text>

        <View style={styles.creditLine}>
          <Text style={styles.creditLabel}>{c.madeBy} — </Text>
          <Pressable accessibilityRole="link" accessibilityLabel="SUMON" hitSlop={8} onPress={() => void Linking.openURL('https://mumainsumon.netlify.app').catch(() => {})}>
            <Text style={styles.creditName}>SUMON</Text>
          </Pressable>
        </View>
        {/* The app's whole visual design — logo, brand, screens and graphics, from the first idea. */}
        <View style={styles.creditLine}>
          <Text style={styles.creditLabel}>{c.designBy} — </Text>
          <Pressable accessibilityRole="link" accessibilityLabel="MD ABDUR RAHMAN FAHIM" hitSlop={8} onPress={() => void Linking.openURL(DESIGNER.facebook).catch(() => {})}>
            <Text style={styles.creditName}>MD ABDUR RAHMAN FAHIM</Text>
          </Pressable>
        </View>
        <Text style={styles.creditFocus}>{c.designFocus}</Text>
        <View style={styles.creditLinks}>
          <Pressable accessibilityRole="link" accessibilityLabel={c.designFb} hitSlop={6} onPress={() => void Linking.openURL(DESIGNER.facebook).catch(() => {})} style={({ pressed }) => StyleSheet.flatten([styles.creditLinkBtn, pressed && { opacity: 0.6 }])}>
            <AppIcon name="facebook" size={icon.sm} color={colors.primary} />
          </Pressable>
          <Pressable accessibilityRole="link" accessibilityLabel={c.designMail} hitSlop={6} onPress={() => void Linking.openURL(`mailto:${DESIGNER.email}`).catch(() => {})} style={({ pressed }) => StyleSheet.flatten([styles.creditLinkBtn, pressed && { opacity: 0.6 }])}>
            <AppIcon name="email-outline" size={icon.sm} color={colors.primary} />
          </Pressable>
        </View>
        <View style={styles.creditLine}>
          <Text style={styles.creditLabel}>Powered by — </Text>
          <Pressable accessibilityRole="link" accessibilityLabel="ABO ENTERPRISE" hitSlop={8} onPress={() => void Linking.openURL('https://www.aboenterprise.com').catch(() => {})}>
            <Text style={styles.creditName}>ABO ENTERPRISE</Text>
          </Pressable>
        </View>

        <Text style={styles.rights}>{c.rights}</Text>
      </View>
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    backLink: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' },
    backLinkText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
    header: { paddingTop: spacing.sm },
    brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
    brandIcon: { width: control.titleIconSize, height: control.titleIconSize, borderRadius: radius.xl },
    brandCopy: { flex: 1, minWidth: 0 },
    eyebrow: { color: colors.primary, ...typography.label, fontWeight: '700', letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700', marginTop: spacing.xxs },
    tagline: { color: colors.textSecondary, ...typography.body, marginTop: spacing.md, lineHeight: 22 },
    privacy: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.lg, backgroundColor: accents.green.soft, borderWidth: border.thin, borderColor: accents.green.border, flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
    privacyIcon: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    privacyCopy: { flex: 1, minWidth: 0 },
    privacyTitle: { color: accents.green.on, ...typography.body, fontWeight: '700' },
    privacyText: { color: colors.textSecondary, ...typography.meta, marginTop: spacing.xs, lineHeight: 19 },
    card: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border, ...elevation.soft },
    section: { color: colors.textPrimary, ...typography.cardTitle, fontWeight: '700', marginBottom: spacing.sm },
    row: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    rowText: { color: colors.textSecondary, ...typography.bodySmall, flex: 1 },
    legalRow: { marginTop: spacing.md, minHeight: layout.minTouchTarget + spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border, ...elevation.soft },
    legalIcon: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.md, backgroundColor: accents.blue.soft, alignItems: 'center', justifyContent: 'center' },
    legalCopy: { flex: 1, minWidth: 0 },
    legalTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '800' },
    legalHint: { color: colors.textMuted, ...typography.caption, marginTop: spacing.xxs },
    credits: { marginTop: spacing.xl, alignItems: 'center', gap: spacing.xs },
    creditsBadge: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.lg, marginBottom: spacing.xxs },
    creditsApp: { color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    creditsVersion: { color: colors.textMuted, ...typography.caption, fontWeight: '700', fontFamily: typography.numeric.fontFamily },
    creditLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
    creditFocus: { color: colors.textMuted, ...typography.caption, textAlign: 'center', marginTop: -2 },
    creditLinks: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xxs },
    creditLinkBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    creditLabel: { color: colors.textMuted, ...typography.caption },
    creditName: { color: colors.primary, ...typography.caption, fontWeight: '700' },
    rights: { color: colors.textMuted, textAlign: 'center', ...typography.caption, marginTop: spacing.xs },
    pressed: { opacity: 0.78 },
  });
}
