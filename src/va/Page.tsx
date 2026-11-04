import { useMemo, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { AppState } from '../ui/AppSurface';
import { ScreenHeader } from '../ui/AppKit';
import { useAppPreferences } from '../app/AppPreferences';
import { layout, spacing, type ThemeColors } from '../theme';
import { AppBackdrop } from '../ui/AppBackdrop';

/**
 * The one page frame every screen of the app uses: background, width, spacing, header, pull-to-refresh and the room the
 * bottom bar needs. A new screen only supplies its title and content, so fonts, colours and spacing can never drift.
 */
export function Page({ title, subtitle, right, back, children, onRefresh, refreshing = false, bottomPadding = layout.compactNavHeight + spacing.xl }: {
  title: string; subtitle?: string; right?: ReactNode; back?: string; children: ReactNode; onRefresh?: () => void; refreshing?: boolean; bottomPadding?: number;
}) {
  const { colors } = useAppPreferences();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <AppBackdrop />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}>
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
  content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  body: { gap: spacing.md, marginTop: spacing.md },
});
