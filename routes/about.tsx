import { Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { AppButton } from '../src/ui/AppSurface';
import { AppText as Text } from '../src/ui/AppText';
import { Card, useKit } from '../src/ui/AppKit';
import { Page } from '../src/va/Page';
import { BrandMark, PoweredBy } from '../src/va/BrandMark';
import { APP_VERSION, CREDITS } from '../src/va/config';

function Link({ label, url }: { label: string; url: string }) {
  const { colors } = useKit();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} hitSlop={8} onPress={() => void Linking.openURL(url).catch(() => {})}>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export default function AboutScreen() {
  const { bn } = useKit();
  return (
    <Page title={bn ? 'অ্যাপ সম্পর্কে' : 'About'} back={bn ? 'সেটিংস' : 'Settings'} bottomPadding={40}>
      <View style={{ alignItems: 'center', marginVertical: 8 }}><BrandMark size={96} /></View>
      <Card title={bn ? 'এই অ্যাপ' : 'This app'}>
        <Text style={{ lineHeight: 24 }}>
          {bn
            ? 'WhatsApp, Telegram, SMS, মিসড কল ও অন্য চ্যাট-অ্যাপের সব বার্তা এক জায়গায়। সহকারী সাধারণ প্রশ্নের উত্তর দেয়। পরিবার ও জরুরি বার্তা আপনাকে সাথে সাথে জানায়। আপনার ব্যক্তিগত বার্তা শুধু আপনার ফোনে আর আপনার নিজের সার্ভারে থাকে।'
            : 'Every message from WhatsApp, Telegram, SMS, missed calls and other chat apps in one place. The assistant answers routine questions; family and urgent messages reach you at once. Your private messages stay on your phone and your own server.'}
        </Text>
        <Text style={{ marginTop: 8, opacity: 0.7 }}>{bn ? 'সংস্করণ' : 'Version'} {APP_VERSION}</Text>
      </Card>
      <Card title={bn ? 'যাঁরা বানিয়েছেন' : 'Made by'}>
        <View style={{ gap: 10 }}>
          <View><Text style={{ opacity: 0.7, fontSize: 13 }}>{bn ? 'পরিচালনা ও তৈরি' : 'Built by'}</Text><Link label={CREDITS.maker.name} url={CREDITS.maker.url} /></View>
          <View><Text style={{ opacity: 0.7, fontSize: 13 }}>{bn ? 'প্রতিষ্ঠান' : 'Company'}</Text><Link label={CREDITS.company.name} url={CREDITS.company.url} /></View>
        </View>
      </Card>
      <Card>
        <AppButton variant="secondary" icon="school-outline" label={bn ? 'পরিচিতি আবার দেখুন' : 'See the quick tour again'} onPress={() => router.push('/tour' as never)} />
      </Card>
      <PoweredBy />
    </Page>
  );
}
