// "Will my reminders actually ring on this phone?" — said on Home, only while something is
// missing, for people who would never open the permissions page on their own.
//
// The user's rule: nothing is switched on by default. This card never asks for a permission
// and never changes a setting; it names what is missing on *this* phone (the maker is read
// from the device) and the person decides. "ঠিক করুন" opens the permissions page, where each
// item says why it is needed. Notifications and exact alarms are read from Android, so those
// lines disappear by themselves once allowed; battery and auto-start cannot be read by any
// app, so they stay until the person taps "হয়ে গেছে".

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Device from 'expo-device';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from './AppText';
import { AppIcon } from './AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { getPermission } from '../services/permission-service';
import { isAggressiveOem, oemFamily } from '../services/oem-background';
import { border, control, radius, spacing, typography } from '../theme';

const CONFIRMED_KEY = 'reminderReadiness.confirmed';

type Missing = { id: string; bn: string; en: string };

export function ReminderReadinessCard() {
  const db = useSQLiteContext();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const [missing, setMissing] = useState<Missing[]>([]);
  const brand = (Device.manufacturer || Device.brand || '').toString();
  const family = oemFamily(Device.manufacturer, Device.brand);

  const check = useCallback(async () => {
    const out: Missing[] = [];
    const notif = await getPermission('notifications')?.check().catch(() => 'UNKNOWN' as const);
    if (notif === 'DENIED' || notif === 'BLOCKED') out.push({ id: 'notifications', bn: 'নোটিফিকেশন দেখানোর অনুমতি', en: 'Permission to show notifications' });
    const exact = await getPermission('exactAlarm')?.check().catch(() => 'UNKNOWN' as const);
    if (exact === 'DENIED' || exact === 'BLOCKED') out.push({ id: 'exactAlarm', bn: 'ঠিক সময়ে বাজার অনুমতি', en: 'Permission to ring at the exact time' });
    const confirmed = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', CONFIRMED_KEY).catch(() => null);
    if (!confirmed) {
      out.push({ id: 'battery', bn: 'ব্যাটারিতে Apon-কে অনুমতি', en: 'Battery: allow Apon' });
      if (isAggressiveOem(family)) out.push({ id: 'autostart', bn: 'অটো-স্টার্ট ও Recents-এ 🔒 লক', en: 'Auto-start and 🔒 lock in Recents' });
    }
    setMissing(out);
  }, [db, family]);

  // Re-read on every return to Home, so a line goes away as soon as it is fixed.
  useFocusEffect(useCallback(() => { void check(); }, [check]));

  if (!missing.length) return null;
  const done = () => {
    void db.runAsync('INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)', CONFIRMED_KEY, new Date().toISOString())
      .then(check).catch(() => undefined);
  };
  // "হয়ে গেছে" confirms the two Android never reports back (battery, auto-start). It used
  // to appear only when nothing else was missing, so a phone that also needed notification
  // permission never showed it and those two lines could never be cleared.
  const hasManual = missing.some((m) => m.id === 'battery' || m.id === 'autostart');
  const phone = brand ? (bn ? `আপনার ${brand} ফোনে:` : `On your ${brand} phone:`) : (bn ? 'এই ফোনে:' : 'On this phone:');
  const count = bn ? String(missing.length).replace(/\d/gu, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!) : String(missing.length);

  return (
    <View style={[styles.card, { backgroundColor: accents.orange.soft, borderColor: accents.orange.border }]} accessibilityLiveRegion="polite">
      <View style={styles.head}>
        <AppIcon name="bell-alert-outline" size={control.iconSize} color={accents.orange.on} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {bn ? `রিমাইন্ডার ঠিক সময়ে বাজতে ${count}টি কাজ বাকি` : `${count} thing(s) left for reminders to ring on time`}
        </Text>
      </View>
      <Text style={[styles.phone, { color: colors.textSecondary }]}>{phone}</Text>
      {missing.map((m) => (
        <Text key={m.id} style={[styles.line, { color: colors.textSecondary }]}>{`• ${bn ? m.bn : m.en}`}</Text>
      ))}
      <View style={styles.row}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/permissions' as never)} style={({ pressed }) => StyleSheet.flatten([styles.primary, { backgroundColor: colors.primary }, pressed && styles.pressed])}>
          <Text style={[styles.primaryText, { color: colors.onPrimary }]}>{bn ? 'ঠিক করুন' : 'Fix it'}</Text>
        </Pressable>
        {hasManual ? (
          <Pressable accessibilityRole="button" onPress={done} style={({ pressed }) => StyleSheet.flatten([styles.secondary, { borderColor: colors.border }, pressed && styles.pressed])}>
            <Text style={[styles.secondaryText, { color: colors.textPrimary }]}>{bn ? 'হয়ে গেছে' : 'Done'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: border.thin, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.callout, fontWeight: '700', flex: 1 },
  phone: { ...typography.bodySmall, fontWeight: '700' },
  line: { ...typography.bodySmall, marginLeft: spacing.xs },
  // Both buttons share the width and may drop to a second line: Bengali labels at a large
  // font size used to push the second button past the card's edge, out of sight.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  primary: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 120, minHeight: control.buttonHeight, borderRadius: radius.md, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  primaryText: { ...typography.callout, fontWeight: '800' },
  secondary: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 120, minHeight: control.buttonHeight, borderRadius: radius.md, borderWidth: border.thin, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { ...typography.callout, fontWeight: '700' },
  pressed: { opacity: 0.85 },
});
