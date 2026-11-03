import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from './AppText';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAppPreferences } from '../app/AppPreferences';
import { AppIcon } from './AppIcon';
import { border, control, layout, opacity, radius, spacing, typography } from '../theme';

// D9: a quick glance away keeps the app open; anything longer asks again.
const GRACE_MS = 5000;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'] as const;

export function LockGate({ children }: PropsWithChildren) {
  const { appLockEnabled, verifyAppLockPin, colors, language, reduceMotion } = useAppPreferences();
  const bn = language === 'bn';
  const [unlocked, setUnlocked] = useState(false);
  const [entry, setEntry] = useState('');
  const [failed, setFailed] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const bioTried = useRef(false);
  const [bioNonce, setBioNonce] = useState(0);
  // PBKDF2 now yields to the event loop while it derives the key (see backup/crypto.ts),
  // so a verification in flight can be superseded by a later keystroke before it resolves.
  // Only the most recent call's result is allowed to act.
  const verifyToken = useRef(0);
  const locked = appLockEnabled && !unlocked;
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  // Nudge the card sideways on a rejected PIN — the mutation lives in an effect (not a
  // memoised callback) so it plays well with the React Compiler immutability rule.
  useEffect(() => {
    if (!failed || reduceMotion) return;
    shake.set(withSequence(
      withTiming(-10, { duration: 45 }),
      withTiming(10, { duration: 45 }),
      withTiming(-6, { duration: 45 }),
      withTiming(0, { duration: 45 }),
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed, reduceMotion]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'background' || state === 'inactive') {
        if (backgroundedAt.current === null) backgroundedAt.current = Date.now();
      } else if (state === 'active') {
        if (backgroundedAt.current !== null && Date.now() - backgroundedAt.current > GRACE_MS) { setUnlocked(false); bioTried.current = false; }
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, []);

  // Offer Face/Fingerprint as the fast path; the PIN pad is always the fallback.
  useEffect(() => {
    if (!locked || bioTried.current) return;
    bioTried.current = true;
    let cancelled = false;
    (async () => {
      try {
        if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return;
        // `disableDeviceFallback: true` is load-bearing: without it, Android offers the
        // phone's own screen-lock credential as a fallback inside the biometric prompt,
        // which unlocks this app with a code that has nothing to do with the PIN the user
        // set for it — anyone who knows the phone's lock defeats App Lock entirely.
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: bn ? 'আনলক করুন' : 'Unlock Apon', disableDeviceFallback: true });
        if (!cancelled && res.success) setUnlocked(true);
      } catch { /* fall back to PIN */ }
    })();
    return () => { cancelled = true; };
  }, [locked, bioNonce, bn]);

  const press = useCallback((digit: string) => {
    setFailed(false);
    setEntry(prev => (prev + digit).slice(0, 8));
  }, []);

  // Auto-unlocks the moment a typed prefix matches, so a shorter PIN never needs the OK
  // button. `verifyAppLockPin` derives a key with PBKDF2 and yields while it works, so a
  // fast second keystroke can resolve before this one does — the token guards against that
  // stale result flipping the screen open (or shut) after a newer attempt is already
  // underway.
  useEffect(() => {
    if (entry.length < 4) return;
    const token = ++verifyToken.current;
    let cancelled = false;
    (async () => {
      const ok = await verifyAppLockPin(entry);
      if (cancelled || verifyToken.current !== token) return;
      if (ok) { setUnlocked(true); setEntry(''); }
    })();
    return () => { cancelled = true; };
  }, [entry, verifyAppLockPin]);

  const submit = useCallback(() => {
    const token = ++verifyToken.current;
    void (async () => {
      const ok = await verifyAppLockPin(entry);
      if (verifyToken.current !== token) return;
      if (ok) { setUnlocked(true); setEntry(''); }
      else { setFailed(true); setEntry(''); }
    })();
  }, [entry, verifyAppLockPin]);

  if (!appLockEnabled || !locked) return <>{children}</>;

  const styles = makeStyles(colors);
  const dotCount = Math.max(4, Math.min(8, entry.length || 4));
  return (
    <View style={styles.wrap} accessibilityViewIsModal accessibilityLabel={bn ? 'অ্যাপ লক' : 'App locked'}>
      <Animated.View style={[styles.card, shakeStyle]}>
        <View style={styles.badge}><AppIcon name="lock-check-outline" size={control.iconSize + 10} color={colors.primary} /></View>
        <View style={styles.dots}>
          {Array.from({ length: dotCount }, (_, i) => (
            <View key={i} style={[styles.dot, i < entry.length && styles.dotOn, failed && styles.dotFail]} />
          ))}
        </View>
        <Text style={[styles.error, !failed && styles.errorHidden]}>{bn ? 'ভুল পিন — আবার চেষ্টা করুন' : 'Wrong PIN — try again'}</Text>
        {/* Icon-only by request — the label said nothing a lock badge and a fingerprint
            glyph didn't already say, and stayed as the accessibility label instead. */}
        <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'বায়োমেট্রিক দিয়ে আনলক' : 'Unlock with biometrics'} onPress={() => { bioTried.current = false; setBioNonce(n => n + 1); }} hitSlop={8} style={({ pressed }) => StyleSheet.flatten([styles.bioBtn, pressed && styles.pressed])}>
          <AppIcon name="fingerprint" size={control.iconSize} color={colors.primary} />
        </Pressable>
      </Animated.View>
      <View style={styles.pad}>
        {KEYS.map((key, idx) => {
          if (key === 'back') {
            return (
              <Pressable
                key={idx}
                accessibilityRole="button"
                accessibilityLabel={bn ? 'মুছুন' : 'Delete'}
                disabled={entry.length === 0}
                onPress={() => { setFailed(false); setEntry(prev => prev.slice(0, -1)); }}
                style={({ pressed }) => StyleSheet.flatten([styles.key, styles.keyGhost, entry.length === 0 && styles.keyDisabled, pressed && styles.pressed])}
              >
                <AppIcon name="backspace-outline" size={control.iconSize} color={colors.textSecondary} />
              </Pressable>
            );
          }
          if (key === 'ok') {
            return (
              <Pressable
                key={idx}
                accessibilityRole="button"
                accessibilityLabel={bn ? 'নিশ্চিত' : 'Confirm'}
                disabled={entry.length < 4}
                onPress={submit}
                style={({ pressed }) => StyleSheet.flatten([styles.key, styles.keyOk, entry.length < 4 && styles.keyDisabled, pressed && styles.pressed])}
              >
                <AppIcon name="arrow-right" size={control.iconSize} color={colors.onPrimary} />
              </Pressable>
            );
          }
          return (
            <Pressable
              key={idx}
              accessibilityRole="button"
              accessibilityLabel={key}
              onPress={() => press(key)}
              style={({ pressed }) => StyleSheet.flatten([styles.key, styles.keyFilled, pressed && styles.pressed])}
            >
              <Text style={styles.keyText}>{key}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppPreferences>['colors']) {
  return StyleSheet.create({
    wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg, zIndex: layout.feedbackZIndex + 10 },
    card: { alignItems: 'center', gap: spacing.xs },
    badge: { width: 76, height: 76, borderRadius: radius.xxl, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
    dots: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xs },
    dot: { width: 13, height: 13, borderRadius: radius.pill, borderWidth: border.medium, borderColor: colors.border },
    dotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    dotFail: { borderColor: colors.danger },
    error: { color: colors.danger, ...typography.bodySmall, fontWeight: '800', marginTop: spacing.xs, minHeight: 44 },
    errorHidden: { opacity: 0 },
    bioBtn: { width: layout.minTouchTarget, height: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    pad: { width: 264, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'center' },
    key: { width: 72, height: 72, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center' },
    keyFilled: { backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border },
    keyGhost: { backgroundColor: 'transparent' },
    keyOk: { backgroundColor: colors.primary },
    keyDisabled: { opacity: opacity.disabled },
    keyText: { color: colors.textPrimary, ...typography.title, fontFamily: typography.numeric.fontFamily },
    pressed: { opacity: opacity.pressed },
  });
}
