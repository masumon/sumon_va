import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import type { IconName } from '../src/ui/AppKit';
import { useKit } from '../src/ui/AppKit';
import { Hero } from '../src/va/Hero';
import { Page } from '../src/va/Page';

const STEPS: { icon: IconName; bn: string; en: string; bodyBn: string; bodyEn: string }[] = [
  { icon: 'inbox-multiple-outline', bn: 'সব বার্তা এক জায়গায়', en: 'Every message in one place', bodyBn: 'WhatsApp, Messenger, Telegram, SMS, মিসড কল, সব এখানেই আসে। আলাদা আলাদা অ্যাপ খুলে দেখতে হবে না।', bodyEn: 'WhatsApp, Messenger, Telegram, SMS, missed calls — all arrive here. No more hopping between apps.' },
  { icon: 'shape-outline', bn: 'নিজে থেকেই আলাদা হয়', en: 'Sorted for you', bodyBn: 'সহকারী প্রতিটি বার্তা পড়ে ঠিক করে, এটা ব্যবসায়িক, ব্যক্তিগত, সামাজিক নাকি স্প্যাম। ওপরের বোতাম চেপে আলাদা করে দেখতে পারবেন।', bodyEn: 'The assistant reads each message and decides: business, personal, social or spam. Use the buttons on top to filter.' },
  { icon: 'robot-happy-outline', bn: 'কখন নিজে উত্তর দেয়', en: 'When it answers by itself', bodyBn: 'শুধু ব্যবসার সাধারণ প্রশ্নে। পরিবার ও ব্যক্তিগত বার্তায় কখনও নিজে উত্তর দেয় না, আপনাকে জানায়। নিজে থেকে কোনো কথা দেয় না, দামও বানিয়ে বলে না।', bodyEn: 'Only for routine business questions. For family and personal messages it never answers — it tells you. It never invents promises or prices.' },
  { icon: 'bell-ring-outline', bn: 'জরুরি হলে বেজে উঠবে', en: 'It rings when it matters', bodyBn: 'পরিবারের জরুরি বার্তা সাইলেন্ট মোডেও বাজবে। দিনে কতবার বাজবে আর রাতে কখন চুপ থাকবে, সেটা আপনিই ঠিক করবেন।', bodyEn: 'Urgent family messages ring even on silent. You decide how many times a day and when it stays quiet at night.' },
  { icon: 'hand-back-left-outline', bn: 'সব সময় আপনার হাতে', en: 'You are always in control', bodyBn: 'একটা সুইচে সব নিজে-নিজে উত্তর বন্ধ হয়ে যায়। কিছু ঠিক না থাকলে ওপরে লাল ব্যানার দেখাবে। সেটা চাপলে কী হয়েছে আর কীভাবে ঠিক করবেন, লেখা থাকবে।', bodyEn: 'One switch stops every automatic reply. If anything is wrong a red banner appears — tap it to see what and how to fix it.' },
];

/** Five short cards shown once after sign-in, in plain words, so nobody needs a manual. */
export default function TourScreen() {
  const { bn, colors } = useKit();
  const [i, setI] = useState(0);
  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;
  return (
    <Page title={bn ? 'অ্যাপটি একনজরে' : 'A quick look'} subtitle={bn ? `${i + 1} / ${STEPS.length}` : `${i + 1} of ${STEPS.length}`} bottomPadding={40}>
      <Hero icon={step.icon} title={bn ? step.bn : step.en} />
      <Text style={{ fontSize: 16, lineHeight: 26 }}>{bn ? step.bodyBn : step.bodyEn}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 8 }}>
        {STEPS.map((s, k) => <View key={s.bn} style={{ width: k === i ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: k === i ? colors.primary : colors.border }} />)}
      </View>
      <View style={{ gap: 10 }}>
        <AppButton label={last ? (bn ? 'বুঝেছি, শুরু করি' : 'Got it — let’s start') : (bn ? 'পরেরটি' : 'Next')} icon={last ? 'check' : 'arrow-right'} onPress={() => (last ? router.replace('/setup' as never) : setI(i + 1))} />
        {i > 0 ? <AppButton variant="ghost" label={bn ? 'আগেরটি' : 'Back'} icon={'arrow-left' as IconName} onPress={() => setI(i - 1)} /> : null}
        {!last ? <AppButton variant="ghost" label={bn ? 'এখন নয়' : 'Skip'} onPress={() => router.replace('/setup' as never)} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', opacity: 0.7 }}>
        <AppIcon name="help-circle-outline" size={18} color={colors.textMuted} />
        <Text style={{ flex: 1, fontSize: 12 }}>{bn ? 'পরে আবার দেখতে চাইলে: সেটিংস > অ্যাপ সম্পর্কে।' : 'To see this again: menu → About.'}</Text>
      </View>
    </Page>
  );
}
