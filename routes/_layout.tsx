import { useEffect, useRef, useState } from 'react';
import { Stack, router, usePathname } from 'expo-router';
import { KeyboardAvoidingView, StatusBar, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';
// One file per weight, from its own folder: the packages' index would pull every weight into the APK.
import { NotoSansBengali_400Regular } from '@expo-google-fonts/noto-sans-bengali/400Regular';
import { NotoSansBengali_500Medium } from '@expo-google-fonts/noto-sans-bengali/500Medium';
import { NotoSansBengali_600SemiBold } from '@expo-google-fonts/noto-sans-bengali/600SemiBold';
import { NotoSansBengali_700Bold } from '@expo-google-fonts/noto-sans-bengali/700Bold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { AppProviders } from '../src/app/AppProviders';
import { useAppPreferences } from '../src/app/AppPreferences';
import { AppErrorBoundary } from '../src/ui/AppErrorBoundary';
import { LockGate } from '../src/ui/LockGate';
import { PrimaryNav, primaryNavItems } from '../src/ui/PrimaryNav';
import { getWindowSizeClass, layout } from '../src/theme';
import { getStatus } from '../modules/va-bridge';

void SplashScreen.preventAutoHideAsync().catch(() => {});

// The bar's routes come from the bar itself, so a new tab can never exist in one list and not the other.
const primaryRoutes: string[] = primaryNavItems.map((item) => item.href);

function AppNavigator() {
  const { colors, themeMode, prefsLoaded, reduceMotion, blockScreenshots } = useAppPreferences();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const windowClass = getWindowSizeClass(width);
  const dark = themeMode === 'dark';
  const showNav = primaryRoutes.includes(pathname);
  const expandedNav = windowClass === 'expanded';

  // Private by default: the recent-apps thumbnail and screenshots show nothing of the owner's chats.
  useEffect(() => {
    if (blockScreenshots) void preventScreenCaptureAsync().catch(() => {});
    else void allowScreenCaptureAsync().catch(() => {});
  }, [blockScreenshots]);

  // First run: nothing works until this phone is paired with the owner's account.
  useEffect(() => {
    if (prefsLoaded && pathname !== '/pair' && !getStatus().paired) router.replace('/pair');
  }, [pathname, prefsLoaded]);

  if (!prefsLoaded) return null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Stack
          screenOptions={{
            headerShown: false,
            animation: reduceMotion ? 'none' : 'default',
            contentStyle: { backgroundColor: colors.background, paddingBottom: showNav && !expandedNav ? 0 : insets.bottom, paddingLeft: showNav && expandedNav ? layout.expandedNavWidth : 0 },
          }}
        />
      </KeyboardAvoidingView>
      {showNav ? <PrimaryNav /> : null}
      <LockGate>{null}</LockGate>
    </SafeAreaView>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    NotoSansBengali_400Regular, NotoSansBengali_500Medium, NotoSansBengali_600SemiBold, NotoSansBengali_700Bold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  });
  // Never let a slow or failed font load trap the app on a blank splash.
  const [fontTimedOut, setFontTimedOut] = useState(false);
  useEffect(() => { const t = setTimeout(() => setFontTimedOut(true), 4000); return () => clearTimeout(t); }, []);
  const canRender = fontsLoaded || Boolean(fontError) || fontTimedOut;
  const hidden = useRef(false);
  useEffect(() => {
    if (canRender && !hidden.current) { hidden.current = true; void SplashScreen.hideAsync().catch(() => {}); }
  }, [canRender]);
  if (!canRender) return null;
  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <AppProviders>
          <AppNavigator />
        </AppProviders>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}
