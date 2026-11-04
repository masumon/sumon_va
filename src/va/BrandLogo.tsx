import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { AppText as Text } from '../ui/AppText';
import { AppIcon } from '../ui/AppIcon';
import type { IconName } from '../ui/AppKit';
import type { Channel } from './api';
import { BRAND_PATHS } from './brandSvgs';

/**
 * Each platform's mark in its own brand colour, so you see at a glance where a message came from.
 * Official marks come from `brandSvgs.ts` (vector paths, one per platform); anything without one falls back to the icon set or text.
 * To use a platform's own artwork instead, replace its path in that file; nothing else needs to change.
 */
export type BrandKey = 'whatsapp' | 'whatsapp-business' | 'messenger' | 'instagram' | 'telegram' | 'sms' | 'email' | 'gmail' | 'imo' | 'viber' | 'signal' | 'line' | 'wechat' | 'webhook' | 'phone' | 'linkedin' | 'tiktok' | 'facebook';

type Brand = { bg: string; glyph?: IconName; text?: string; svg?: string; name: string };

const BRANDS: Record<BrandKey, Brand> = {
  whatsapp: { bg: '#25D366', glyph: 'whatsapp', name: 'WhatsApp' },
  'whatsapp-business': { bg: '#128C7E', glyph: 'whatsapp', name: 'WhatsApp Business' },
  messenger: { bg: '#0A7CFF', glyph: 'facebook-messenger', name: 'Messenger' },
  instagram: { bg: '#E1306C', glyph: 'instagram', name: 'Instagram' },
  telegram: { bg: '#229ED9', name: 'Telegram' },
  sms: { bg: '#34A853', glyph: 'message-text', name: 'SMS' },
  email: { bg: '#5F6368', glyph: 'email', name: 'E-mail' },
  gmail: { bg: '#EA4335', glyph: 'gmail', name: 'Gmail' },
  imo: { bg: '#1E8CFF', text: 'imo', name: 'imo' },
  viber: { bg: '#7360F2', glyph: 'phone', name: 'Viber' },
  signal: { bg: '#3A76F0', glyph: 'signal-variant', name: 'Signal' },
  line: { bg: '#06C755', text: 'LINE', name: 'LINE' },
  wechat: { bg: '#07C160', glyph: 'wechat' as IconName, name: 'WeChat' },
  webhook: { bg: '#7A5AF8', glyph: 'webhook' as IconName, name: 'Webhook' },
  phone: { bg: '#5C6BC0', glyph: 'cellphone-message', name: 'Phone app' },
  linkedin: { bg: '#0A66C2', glyph: 'linkedin' as IconName, name: 'LinkedIn' },
  tiktok: { bg: '#111111', glyph: 'music-note' as IconName, name: 'TikTok' },
  facebook: { bg: '#1877F2', glyph: 'facebook' as IconName, name: 'Facebook' },
};

const PACKAGES: [string, BrandKey][] = [
  ['com.whatsapp.w4b', 'whatsapp-business'], ['com.whatsapp', 'whatsapp'], ['com.facebook.orca', 'messenger'], ['com.facebook.mlite', 'messenger'],
  ['com.instagram', 'instagram'], ['org.telegram', 'telegram'], ['org.thunderdog', 'telegram'], ['com.linkedin', 'linkedin'], ['com.zhiliaoapp', 'tiktok'], ['com.ss.android.ugc', 'tiktok'], ['com.facebook.katana', 'facebook'], ['com.facebook.lite', 'facebook'], ['com.imo', 'imo'],['com.viber', 'viber'],
  ['org.thoughtcrime', 'signal'], ['jp.naver.line', 'line'], ['com.tencent.mm', 'wechat'], ['com.google.android.gm', 'gmail'],
];

/** Which brand a conversation belongs to: its channel, or — for chats read from the phone — the app that showed the notification. */
export function brandFor(channel: Channel | string, phone?: string): BrandKey {
  if (channel === 'notif' && phone) {
    const pkg = phone.split(':')[1] ?? '';
    const hit = PACKAGES.find(([p]) => pkg.startsWith(p));
    return hit ? hit[1] : 'phone';
  }
  if (channel === 'whatsapp' || channel === 'telegram' || channel === 'sms' || channel === 'email' || channel === 'webhook') return channel;
  return 'phone';
}

export const brandName = (k: BrandKey) => BRANDS[k].name;
export const brandColor = (k: BrandKey) => BRANDS[k].bg;

export function BrandLogo({ brand, size = 44 }: { brand: BrandKey; size?: number }) {
  const b = BRANDS[brand];
  const path = BRAND_PATHS[brand] ?? b.svg;
  const inner = Math.round(size * 0.56);
  return (
    <View style={[styles.base, { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: b.bg }]} accessibilityLabel={b.name}>
      {path ? <Svg width={inner} height={inner} viewBox="0 0 24 24"><Path d={path} fill="#FFFFFF" /></Svg>
        : b.text ? <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: Math.round(size * (b.text.length > 3 ? 0.27 : 0.34)) }}>{b.text}</Text>
        : <AppIcon name={b.glyph as IconName} size={inner} color="#FFFFFF" />}
    </View>
  );
}

const styles = StyleSheet.create({ base: { alignItems: 'center', justifyContent: 'center' } });
