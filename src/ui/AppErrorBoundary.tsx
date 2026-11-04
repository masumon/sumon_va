import { Component, type ErrorInfo, type ReactNode } from 'react';
import { I18nManager, NativeModules, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

// Last line of defence: if a screen throws during render, the user gets a calm recovery
// card instead of a white screen or a hard crash. "Try again" remounts the subtree;
// "Copy details" hands them the stack so they can paste it into a bug report. No network,
// nothing logged anywhere off-device. Colours are hard-coded (theme context may be the
// thing that broke) and read fine on any background.
//
// The crash screen itself used to be English-only, no matter what the app was showing a
// moment before — the one screen a Bengali-only user is most likely to actually need to
// read, since it is the one telling them something went wrong. `AppPreferences` cannot be
// trusted here (it may be the very thing that crashed), so language is read the same
// dependency-free way `deviceLanguage()` in AppPreferences.tsx does — duplicated rather
// than imported, so this boundary stays fully self-contained.
function deviceIsBangla(): boolean {
  try {
    const tag =
      (Platform.OS === 'ios'
        ? NativeModules.SettingsManager?.settings?.AppleLocale ||
          NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        : NativeModules.I18nManager?.localeIdentifier) ||
      (I18nManager as unknown as { getConstants?: () => { localeIdentifier?: string } }).getConstants?.().localeIdentifier ||
      '';
    const tagged = String(tag).toLowerCase();
    return tagged.startsWith('bn') || tagged.includes('-bd') || tagged.endsWith('bd');
  } catch {
    return false;
  }
}

const COPY = {
  bn: {
    title: 'একটি সমস্যা হয়েছে',
    body: 'স্ক্রিনটিতে একটি ত্রুটি হয়েছে। আপনার বার্তা সার্ভারে নিরাপদে আছে, কিছু হারায়নি। ব্যাকগ্রাউন্ড সিঙ্কও চলছে।',
    retry: 'আবার চেষ্টা করুন',
    copy: 'ত্রুটির বিবরণ কপি করুন',
    save: 'ফাইলে রিপোর্ট সেভ করুন',
  },
  en: {
    title: 'Something went wrong',
    body: 'The screen hit an error. Your messages are safe on the server, nothing was lost, and background sync keeps running.',
    retry: 'Try again',
    copy: 'Copy error details',
    save: 'Save report to a file',
  },
} as const;

type Props = { children: ReactNode };
type State = { error: Error | null; info: string };

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack ?? '' });
  }

  private reset = () => this.setState({ error: null, info: '' });

  private dump = () => {
    const { error, info } = this.state;
    return [
      `সুমনের ভার্চুয়াল সহকারী — error report`,
      new Date().toISOString(),
      '',
      String(error?.stack ?? error?.message ?? error),
      '',
      info,
    ].join('\n');
  };

  private copy = () => {
    void Clipboard.setStringAsync(this.dump()).catch(() => {});
  };

  private save = () => {
    void (async () => {
      try {
        const file = new File(Paths.cache, `sumon-va-error-${Date.now()}.txt`);
        file.create({ overwrite: true });
        file.write(this.dump());
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: 'Sumon VA error report' });
      } catch { /* best-effort — Copy details is the fallback */ }
    })();
  };

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const t = COPY[deviceIsBangla() ? 'bn' : 'en'];
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.badge}><Text style={styles.badgeText}>!</Text></View>
          <Text style={styles.title}>{t.title}</Text>
          <Text style={styles.body}>{t.body}</Text>
          <Text style={styles.mono} numberOfLines={4}>{String(error.message || error)}</Text>
          <Pressable accessibilityRole="button" onPress={this.reset} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            <Text style={styles.primaryText}>{t.retry}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={this.copy} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>{t.copy}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={this.save} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>{t.save}</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1013' },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  badge: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#2A1416', borderWidth: 1, borderColor: '#5A2A2E', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#F0736A', fontSize: 26, fontWeight: '800' },
  title: { color: '#EDEEF2', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  body: { color: '#A7ADB8', fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 420 },
  mono: { color: '#7E8695', fontSize: 12, lineHeight: 17, fontFamily: 'monospace', textAlign: 'center', maxWidth: 420, marginVertical: 6 },
  primary: { minHeight: 48, alignSelf: 'stretch', maxWidth: 320, borderRadius: 14, backgroundColor: '#2F6FD6', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 8 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondary: { minHeight: 48, alignSelf: 'stretch', maxWidth: 320, borderRadius: 14, borderWidth: 1, borderColor: '#2C313B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  secondaryText: { color: '#C4CAD4', fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.8 },
});
