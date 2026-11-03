// Permissions, in one place, in plain words.
//
// Android shows a bare dialog with a system-written sentence. Someone who meets that
// before they know what the app does denies it, and the feature is off for good. So the
// reason sits on the same card as the button, and the system dialog only appears after
// the user has tapped to allow.
//
// Two of the rows are not permissions Android models — battery saving and auto-start —
// but they decide whether a reminder ever arrives on the phones people here actually use.
// The app cannot read or grant them, so those rows say so honestly and open the right
// settings page instead of pretending to know.

import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { router, useFocusEffect } from 'expo-router';
import { useAppPreferences } from '../src/app/AppPreferences';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { useSQLiteContext } from 'expo-sqlite';
import { selfReportedPermissions, setSelfReportedPermission } from '../src/services/self-reported-permissions';
import {
  openAppSettings,
  readPermissionStates,
  type AppPermission,
  type PermissionState,
} from '../src/services/permission-service';
import { AppIcon } from '../src/ui/AppIcon';
import { success, tapLight, warn } from '../src/ui/haptics';
import { border, control, elevation, icon, layout, radius, spacing, typography, type ThemeColors } from '../src/theme';

export default function PermissionsScreen() {
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const { showSnackbar } = useAppFeedback();
  const db = useSQLiteContext();
  // The few settings Android never reports back (auto-start): the person's own answer.
  const [saidDone, setSaidDone] = useState<Set<string>>(new Set());
  const s = makeStyles(colors);

  const [rows, setRows] = useState<{ permission: AppPermission; state: PermissionState }[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Which card has its "what if I skip it" open. One at a time keeps the page short.
  const [openWhy, setOpenWhy] = useState<string | null>(null);

  // Which ids were DENIED as of the last read — so a background poll (below) can tell "was
  // asked, now granted" apart from "was already granted", and only the first is news.
  const deniedIdsRef = useRef<Set<string>>(new Set());
  const load = useCallback(async (opts: { announce?: boolean } = {}) => {
    try {
      const next = await readPermissionStates();
      if (opts.announce) {
        const newlyGranted = next.filter((r) => r.state === 'GRANTED' && deniedIdsRef.current.has(r.permission.id));
        for (const r of newlyGranted) {
          success();
          showSnackbar(
            bn ? `${r.permission.title('bn')} — এখন আছে` : `${r.permission.title('en')} — now allowed`,
            'success',
          );
        }
      }
      deniedIdsRef.current = new Set(next.filter((r) => r.state === 'DENIED').map((r) => r.permission.id));
      setRows(next);
    }
    catch { setRows([]); }
    finally { setReady(true); }
  }, [bn, showSnackbar]);
  useFocusEffect(useCallback(() => { void load(); void selfReportedPermissions(db).then(setSaidDone).catch(() => {}); }, [load, db]));

  const sayDone = async (id: string, done: boolean) => {
    tapLight();
    await setSelfReportedPermission(db, id, done);
    setSaidDone(await selfReportedPermissions(db).catch(() => new Set<string>()));
    if (done) success();
  };

  // A person who opens this screen, pulls down the quick-settings shade to turn the
  // connection on, downloads the voice pack there, and comes straight back — without ever
  // truly leaving the app — sees nothing change, because that shade toggle does not blur
  // React Navigation's focus and so never re-triggers the effect above. Polling while this
  // screen is open and something is still unsettled is what actually catches that: cheap
  // (one local Android call, no network of its own), and it stops on its own the moment
  // every row has an answer.
  useFocusEffect(useCallback(() => {
    // DENIED specifically — not UNKNOWN. Battery saving and auto-start have no read API
    // and always report UNKNOWN; polling those would run for as long as the screen stayed
    // open with nothing left to catch. DENIED is the state Android can actually answer
    // "yes" to later on its own — a pack finishing its download, a setting flipped outside
    // the app — so it is the one worth watching.
    const unsettled = () => rows.some((r) => r.state === 'DENIED');
    if (!rows.length || !unsettled()) return undefined;
    const timer = setInterval(() => { if (unsettled()) void load({ announce: true }); }, 5000);
    return () => clearInterval(timer);
  }, [rows, load]));

  const ask = async (permission: AppPermission) => {
    if (busy) return;
    tapLight();
    setBusy(permission.id);
    try {
      const next = await permission.request();
      // A row with its own wording wins: "Allowed" is wrong for a download that has only
      // been queued, and wrong again for one the phone did there and then.
      const note = permission.note?.(next, language) ?? null;
      if (note) {
        if (next === 'GRANTED') success(); else warn();
        showSnackbar(note, next === 'GRANTED' ? 'success' : 'info');
      } else if (next === 'GRANTED') {
        success();
        showSnackbar(bn ? 'অনুমতি দেওয়া হয়েছে' : 'Allowed', 'success');
      } else if (next === 'BLOCKED') {
        warn();
        showSnackbar(
          bn ? 'ফোনের সেটিংস থেকে অনুমতি দিতে হবে' : 'This has to be allowed from your phone’s settings',
          'danger',
        );
      }
      await load();
    } catch {
      warn();
    } finally { setBusy(null); }
  };

  // Three looks, one per real answer from the phone (the user's rule, RC.4): given (green
  // tick, nothing to do), not given (warning + the button that gives it), and could not be
  // taken (failure + why + what to do). No row ever says "check it yourself".
  type Look = { text: string; tone: 'good' | 'warn' | 'fail'; icon: 'check-circle' | 'alert-circle-outline' | 'close-circle-outline'; reason: string | null; action: 'ask' | 'settings' | null };
  const look = (permission: AppPermission, state: PermissionState): Look => {
    const given = bn ? 'অনুমতি দেওয়া হয়েছে' : 'Allowed';
    const failed = bn ? 'অনুমতি নেওয়া যায়নি' : 'Could not be allowed';
    switch (state) {
      case 'GRANTED': return { text: given, tone: 'good', icon: 'check-circle', reason: null, action: null };
      case 'DENIED': return { text: bn ? 'অনুমতি দেওয়া হয়নি' : 'Not allowed', tone: 'warn', icon: 'alert-circle-outline', reason: null, action: permission.opensSettings ? 'settings' : 'ask' };
      case 'BLOCKED': return { text: failed, tone: 'fail', icon: 'close-circle-outline', reason: bn ? 'আগে "না" বলা হয়েছে, তাই ফোন আর জিজ্ঞেস করবে না। সেটিংস থেকে চালু করুন।' : 'It was refused before, so the phone will not ask again. Turn it on in settings.', action: 'settings' };
      case 'NOT_NEEDED': {
        const limit = permission.statusOverride?.(state, language);
        return limit
          ? { text: failed, tone: 'fail', icon: 'close-circle-outline', reason: limit, action: null }
          : { text: bn ? 'এই ফোনে লাগে না' : 'Not needed on this phone', tone: 'good', icon: 'check-circle', reason: null, action: null };
      }
      default:
        // Android cannot answer for this one. If the person has said they turned it on,
        // that is what the card shows — as their word, not as a reading of the phone.
        if (saidDone.has(permission.id)) {
          return { text: bn ? 'আপনি চালু করেছেন বলে জানিয়েছেন' : 'You said you turned it on', tone: 'good', icon: 'check-circle', reason: null, action: null };
        }
        return { text: failed, tone: 'fail', icon: 'close-circle-outline', reason: bn ? 'ফোন এটির অবস্থা অ্যাপকে জানায় না। সেটিংসে গিয়ে চালু করে দিন।' : 'This phone does not tell the app. Turn it on in settings.', action: 'settings' };
    }
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bn ? 'ফিরুন' : 'Back'}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
        style={({ pressed }) => StyleSheet.flatten([s.back, pressed && s.pressed])}
      >
        <AppIcon name="arrow-left" size={icon.md} color={colors.primary} />
        <Text style={s.backText}>{bn ? 'ফিরুন' : 'Back'}</Text>
      </Pressable>

      <Text style={s.eyebrow}>{bn ? 'অনুমতি' : 'PERMISSIONS'}</Text>
      <Text accessibilityRole="header" style={s.title}>{bn ? 'অ্যাপ কী কী চায়' : 'What the app asks for'}</Text>
      <Text style={s.subtitle}>
        {bn
          ? 'অ্যাপ নিজে থেকে কোনো অনুমতি নেয় না। কোনটা কেন দরকার তা এখানে লেখা আছে — আপনি দিলে তবেই সেটি কাজ করবে, না দিলে বাকি সব আগের মতোই চলবে।'
          : 'The app takes nothing on its own. Each one says what it is for; allow it and that feature works, skip it and everything else carries on as before.'}
      </Text>

      {!ready ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        rows.map(({ permission, state }) => {
          const l = look(permission, state);
          const tone = l.tone === 'good' ? accents.green : l.tone === 'warn' ? accents.orange : accents.red;
          return (
            <View key={permission.id} style={s.card}>
              <View style={s.cardTop}>
                <View style={[s.cardIcon, { backgroundColor: tone.soft }]}>
                  <AppIcon name={permission.icon} size={icon.md} color={tone.on} />
                </View>
                <View style={s.grow}>
                  <Text numberOfLines={2} style={s.cardTitle}>{permission.title(language)}</Text>
                  <View style={s.statusRow}>
                    <AppIcon name={l.icon} size={icon.xs} color={tone.on} />
                    <Text style={[s.status, { color: tone.on }]}>{l.text}</Text>
                  </View>
                </View>
              </View>

              <Text style={s.why}>{permission.why(language)}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: openWhy === permission.id }}
                accessibilityLabel={bn ? 'না দিলে কী হয়' : 'What happens if you skip it'}
                onPress={() => { tapLight(); setOpenWhy(openWhy === permission.id ? null : permission.id); }}
                style={({ pressed }) => StyleSheet.flatten([s.moreRow, pressed && s.pressed])}
              >
                <Text style={s.moreText}>{bn ? 'না দিলে কী হয়?' : 'What if I skip it?'}</Text>
                <AppIcon name={openWhy === permission.id ? 'chevron-up' : 'chevron-down'} size={icon.sm} color={colors.primary} />
              </Pressable>
              {l.reason ? <Text style={[s.reason, { color: tone.on, backgroundColor: tone.soft }]}>{l.reason}</Text> : null}
              {openWhy === permission.id ? <Text style={s.without}>{permission.without(language)}</Text> : null}

              {l.action ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={permission.title(language)}
                  accessibilityState={{ busy: busy === permission.id }}
                  disabled={busy !== null}
                  onPress={() => { if (l.action === 'settings' && !permission.opensSettings) { tapLight(); void openAppSettings(); } else void ask(permission); }}
                  style={({ pressed }) => StyleSheet.flatten([s.allow, busy !== null && s.disabled, pressed && s.pressed])}
                >
                  {busy === permission.id ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <>
                      <AppIcon name={l.action === 'settings' ? 'cog-outline' : 'check'} size={icon.sm} color={colors.onPrimary} />
                      <Text numberOfLines={1} style={s.allowText}>
                        {l.action === 'settings'
                          ? (bn ? 'সেটিংস খুলুন' : 'Open settings')
                          : (bn ? 'অনুমতি দিন' : 'Allow')}
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : null}

              {/* Nothing here reads the phone: the app cannot switch this on, and cannot
                  check it either. It opens the right screen and takes the person's word. */}
              {state === 'UNKNOWN' ? (
                saidDone.has(permission.id) ? (
                  <Pressable accessibilityRole="button" onPress={() => void sayDone(permission.id, false)} style={({ pressed }) => StyleSheet.flatten([s.moreRow, pressed && s.pressed])}>
                    <Text style={s.moreText}>{bn ? 'চালু করা হয়নি — আবার দেখাও' : 'Not turned on — show again'}</Text>
                  </Pressable>
                ) : (
                  <Pressable accessibilityRole="button" onPress={() => void sayDone(permission.id, true)} style={({ pressed }) => StyleSheet.flatten([s.doneRow, pressed && s.pressed])}>
                    <AppIcon name="check" size={icon.sm} color={accents.green.on} />
                    <Text style={[s.doneText, { color: accents.green.on }]}>{bn ? 'চালু করে এসেছি' : 'I turned it on'}</Text>
                  </Pressable>
                )
              ) : null}
            </View>
          );
        })
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => { tapLight(); void openAppSettings(); }}
        style={({ pressed }) => StyleSheet.flatten([s.ghost, pressed && s.pressed])}
      >
        <AppIcon name="cog-outline" size={icon.sm} color={colors.primary} />
        <Text numberOfLines={1} style={s.ghostText}>
          {bn ? 'ফোনে অ্যাপের সেটিংস খুলুন' : 'Open this app’s settings on the phone'}
        </Text>
      </Pressable>

      <Text style={s.footnote}>
        {bn
          ? 'অ্যাপটি কোনো তথ্য কোথাও পাঠায় না। যেকোনো অনুমতি যেকোনো সময় ফোনের সেটিংস থেকে ফিরিয়ে নিতে পারেন।'
          : 'Nothing is sent anywhere. Any permission can be taken back at any time from your phone’s settings.'}
      </Text>
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    eyebrow: { color: colors.primary, ...typography.section, fontWeight: '700', letterSpacing: 1, marginTop: spacing.sm },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700', marginTop: 2 },
    subtitle: { color: colors.textSecondary, ...typography.body, marginTop: spacing.sm, marginBottom: spacing.lg },
    card: { borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.md, ...elevation.soft },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    grow: { flex: 1, minWidth: 0 },
    cardTitle: { color: colors.textPrimary, ...typography.cardTitle },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
    status: { flex: 1, ...typography.caption, fontWeight: '700' },
    why: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.sm },
    moreRow: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    doneRow: { minHeight: control.buttonHeight, marginTop: spacing.sm, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
    doneText: { ...typography.callout, fontWeight: '700' },
    moreText: { color: colors.primary, ...typography.caption, fontWeight: '700' },
    reason: { ...typography.bodySmall, fontWeight: '700', marginTop: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    without: { color: colors.textMuted, ...typography.caption, marginTop: spacing.xs },
    allow: { minHeight: control.buttonHeight, marginTop: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
    allowText: { flexShrink: 1, color: colors.onPrimary, ...typography.callout, fontWeight: '800' },
    ghost: { minHeight: control.buttonHeight, marginTop: spacing.sm, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
    ghostText: { flexShrink: 1, color: colors.primary, ...typography.callout, fontWeight: '800' },
    footnote: { color: colors.textMuted, ...typography.caption, marginTop: spacing.md, textAlign: 'center' },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.78 },
  });
}
