import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { AppText as Text } from '../ui/AppText';
import { AppState } from '../ui/AppSurface';
import { ScreenHeader } from '../ui/AppKit';
import { useAppPreferences } from '../app/AppPreferences';
import { getWindowSizeClass, layout, spacing, type ThemeColors } from '../theme';
import { AppBackdrop } from '../ui/AppBackdrop';
import { NAV_BAR_GAP, NAV_BAR_HEIGHT, primaryNavItems } from '../ui/PrimaryNav';

/**
 * The one page frame every screen of the app uses: background, width, spacing, header, pull-to-refresh and the room the
 * bottom bar needs. A new screen only supplies its title and content, so fonts, colours and spacing can never drift.
 */
export function Page({ title, subtitle, right, back, children, onRefresh, refreshing = false, bottomPadding }: {
  title: string; subtitle?: string; right?: ReactNode; back?: string; children: ReactNode; onRefresh?: () => void; refreshing?: boolean; bottomPadding?: number;
}) {
  const { colors } = useAppPreferences();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Pull-to-refresh: the spinner is ours and stops after at most 2.5 s (or sooner when the screen says it is done), so it can
  // never hang while a slow request is still running behind it (owner bug: refresh seemed to stick).
  const [pulling, setPulling] = useState(false);
  const pullTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pullTimer.current) clearTimeout(pullTimer.current); }, []);
  const pull = () => {
    setPulling(true);
    if (pullTimer.current) clearTimeout(pullTimer.current);
    pullTimer.current = setTimeout(() => setPulling(false), 2500);
    onRefresh?.();
  };
  void refreshing;
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // On the screens that show the floating bar, the content must end above it: bar + its gap + the phone's bottom inset + 16.
  const barShown = primaryNavItems.some((i) => i.href === pathname) && getWindowSizeClass(width) !== 'expanded';
  const bottom = bottomPadding ?? (barShown ? NAV_BAR_HEIGHT + NAV_BAR_GAP + insets.bottom + 16 : layout.compactNavHeight + spacing.xl);
  return (
    <View style={styles.container}>
      <AppBackdrop />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: bottom }]} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? <RefreshControl refreshing={pulling} onRefresh={pull} tintColor={colors.primary} /> : undefined}>
        <ScreenHeader title={title} subtitle={subtitle} right={right} backLabel={back} hideBack={!back} />
        <View style={styles.body}>{children}</View>
      </ScrollView>
    </View>
  );
}

/** Loading / error / empty in one consistent look. Returns null when there is something to show. */
export function Status({ loading, error, empty, emptyTitle, emptyHint, onRetry, retryLabel }: {
  loading: boolean; error: string | null; empty?: boolean; emptyTitle?: string; emptyHint?: string; onRetry?: () => void; retryLabel?: string;
}) {
  if (loading) return <AppState title="" loading />;
  if (error) return <AppState icon="cloud-off-outline" title={error} actionLabel={retryLabel} onAction={onRetry} />;
  if (empty) return <AppState icon="check-circle-outline" title={emptyTitle ?? ''} description={emptyHint} />;
  return null;
}

export function Hint({ children }: { children: ReactNode }) {
  const { colors } = useAppPreferences();
  return <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 20 }}>{children}</Text>;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1, backgroundColor: 'transparent' },
  content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  body: { gap: spacing.md, marginTop: spacing.sm },
});
