import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import * as Location from 'expo-location';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton, AppIconButton } from '../src/ui/AppSurface';
import { Card, Chip, ChipGroup, Field, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { useAppPreferences } from '../src/app/AppPreferences';
import { va, errTone, type ScheduleBlock, type SavedPlace, type StatusDef } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero } from '../src/va/Hero';
import { Page, Status } from '../src/va/Page';
import { InfoHint } from '../src/va/InfoHint';
import { SoftIcon } from '../src/va/SoftIcon';

const BUILTIN = ['free', 'sleeping', 'meeting', 'prayer', 'driving'];
// Server order: Monday = 0 ... Sunday = 6.
const DAYS_BN = ['সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি', 'রবি'];
const DAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIMES = ['06:00', '09:00', '13:00', '15:00', '18:00', '22:00'] as const;
const RADII = ['100', '300', '1000'] as const;
const newKey = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

function shift(t: string, mins: number): string {
  const [h, m] = t.split(':').map(Number);
  const v = ((((h || 0) * 60 + (m || 0) + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

function TimePick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { s, colors } = useKit();
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <View style={[s.chipRow, { alignItems: 'center' }]}>
        <AppIconButton icon="minus" label="-30" onPress={() => onChange(shift(value, -30))} />
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.textPrimary, minWidth: 64, textAlign: 'center' }}>{value}</Text>
        <AppIconButton icon="plus" label="+30" onPress={() => onChange(shift(value, 30))} />
      </View>
      <View style={s.chipRow}>
        {TIMES.map((t) => <Chip key={t} label={t} active={value === t} onPress={() => onChange(t)} />)}
      </View>
    </View>
  );
}

/** What the assistant may say about the owner: his own statuses, a weekly routine, and saved places. */
export default function RoutineScreen() {
  const { bn } = useKit();
  const { colors } = useAppPreferences();
  const { showSnackbar } = useAppFeedback();
  const cfg = useLoad(() => va.assistantConfig(), 'assistant-config');
  const c = cfg.data?.config;
  const [st, setSt] = useState<{ id: string | null; label: string; say: string } | null>(null);
  const [blk, setBlk] = useState<{ days: number[]; from: string; to: string; status: string } | null>(null);
  const [pl, setPl] = useState<{ label: string; say: string; lat: number | null; lng: number | null; radius: string }>({ label: '', say: '', lat: null, lng: null, radius: '300' });
  const [locBusy, setLocBusy] = useState(false);

  const save = async (patch: Record<string, unknown>): Promise<boolean> => {
    try { await va.saveAssistantConfig(patch); await cfg.reload(); showSnackbar(bn ? 'সংরক্ষণ হয়েছে' : 'Saved', 'success'); return true; }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); return false; }
  };

  const statuses: StatusDef[] = c?.statuses ?? [];
  const schedule: ScheduleBlock[] = c?.schedule ?? [];
  const places: SavedPlace[] = c?.places ?? [];
  const labelOf = (k: string) => statuses.find((x) => x.key === k)?.label ?? k;
  const nowKey = c?.status_now?.key ?? c?.status.key ?? 'free';
  const nowSrc = c?.status_now?.source ?? c?.status.source;
  const srcText = nowSrc === 'schedule' ? (bn ? 'সময়সূচি থেকে' : 'From your schedule') : nowSrc === 'place' ? (bn ? 'জায়গা থেকে' : 'From a saved place') : nowSrc === 'manual' ? (bn ? 'আপনার বেছে নেওয়া' : 'Chosen by you') : '';

  const saveStatus = async () => {
    if (!st || !st.label.trim() || !st.say.trim()) return;
    const label = st.label.trim();
    const say = st.say.trim();
    const next = st.id ? statuses.map((x) => (x.key === st.id ? { ...x, label, say } : x)) : [...statuses, { key: newKey('c'), label, say }];
    if (await save({ statuses: next })) setSt(null);
  };
  const saveBlock = async () => {
    if (!blk || !blk.days.length || !blk.status) return;
    if (await save({ schedule: [...schedule, { days: [...blk.days].sort((a, b) => a - b), from: blk.from, to: blk.to, status: blk.status }] })) setBlk(null);
  };
  const captureHere = async () => {
    setLocBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { showSnackbar(bn ? 'লোকেশনের অনুমতি দেওয়া হয়নি' : 'Location permission was not given', 'info'); return; }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPl((x) => ({ ...x, lat: Math.round(p.coords.latitude * 1e4) / 1e4, lng: Math.round(p.coords.longitude * 1e4) / 1e4 }));
    } catch (e) { showSnackbar(bn ? 'এখনকার জায়গা পাওয়া যায়নি, আবার চেষ্টা করুন' : 'Could not get the location, try again', errTone(e)); }
    finally { setLocBusy(false); }
  };
  const savePlace = async () => {
    if (!pl.label.trim() || !pl.say.trim() || pl.lat == null || pl.lng == null) return;
    const item: SavedPlace = { key: newKey('p'), label: pl.label.trim(), say: pl.say.trim(), lat: pl.lat, lng: pl.lng, radius_m: Number(pl.radius) };
    if (await save({ places: [...places, item] })) setPl({ label: '', say: '', lat: null, lng: null, radius: '300' });
  };

  const row = (icon: 'tag-outline' | 'calendar-clock' | 'map-marker-outline', title: string, sub: string, actions: ReactNode, key: string) => (
    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <SoftIcon name={icon} tone="primary" size={34} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={2} style={{ fontSize: 14, fontWeight: '700', color: colors.textPrimary }}>{title}</Text>
        <Text numberOfLines={3} style={{ fontSize: 12, color: colors.textSecondary }}>{sub}</Text>
      </View>
      {actions}
    </View>
  );

  return (
    <Page title={bn ? 'সময়সূচি, অবস্থা ও জায়গা' : 'Routine, status and places'} subtitle={bn ? 'সহকারী আপনার সম্পর্কে কী বলতে পারবে' : 'What the assistant may say about you'} onRefresh={cfg.reload} refreshing={cfg.loading && !!c}>
      <Status loading={cfg.loading && !c} error={c ? null : cfg.error} onRetry={cfg.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {c ? (
        <>
          <Hero icon="clock-outline" eyebrow={bn ? 'এখনকার অবস্থা' : 'Right now'} title={labelOf(nowKey)} subtitle={srcText || undefined} />

          <Card icon="tag-outline" title={bn ? 'আমার অবস্থা' : 'My statuses'}>
            <InfoHint text={bn ? 'নিজের অবস্থা যোগ করুন, যেমন “দোকানে”। বাক্যে {owner} লিখলে সেখানে আপনার নাম বসবে। ফ্রি, ঘুম, মিটিং, নামাজ ও গাড়ি চালানো মুছা যায় না।' : 'Add your own status, like "At the shop". Write {owner} in the sentence and your name goes there. The built-in ones cannot be deleted.'} />
            {statuses.map((x) => row('tag-outline', x.label, x.say, (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <AppIconButton icon="pencil-outline" label={bn ? 'বদলান' : 'Edit'} onPress={() => setSt({ id: x.key, label: x.label, say: x.say })} />
                {BUILTIN.includes(x.key) ? null : <AppIconButton icon="delete-outline" variant="danger" label={bn ? 'মুছুন' : 'Delete'} onPress={() => void save({ statuses: statuses.filter((y) => y.key !== x.key) })} />}
              </View>
            ), x.key))}
            {st ? (
              <View style={{ gap: 10 }}>
                <Field label={bn ? 'নাম' : 'Name'} value={st.label} onChangeText={(v) => setSt({ ...st, label: v })} placeholder={bn ? 'যেমন: দোকানে' : 'e.g. At the shop'} />
                <Field label={bn ? 'সহকারী যা বলবে' : 'What it says'} value={st.say} onChangeText={(v) => setSt({ ...st, say: v })} placeholder={bn ? '{owner} এখন দোকানে আছেন।' : '{owner} is at the shop now.'} multiline />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <AppButton variant="secondary" label={bn ? 'বাতিল' : 'Cancel'} onPress={() => setSt(null)} style={{ flex: 1 }} />
                  <AppButton icon="check" label={bn ? 'সংরক্ষণ' : 'Save'} disabled={!st.label.trim() || !st.say.trim()} onPress={() => void saveStatus()} style={{ flex: 1 }} />
                </View>
              </View>
            ) : <AppButton variant="secondary" icon="plus" label={bn ? 'নতুন অবস্থা' : 'New status'} onPress={() => setSt({ id: null, label: '', say: '' })} />}
          </Card>

          <Card icon="calendar-clock" title={bn ? 'সাপ্তাহিক সময়সূচি' : 'Weekly schedule'}>
            <InfoHint text={bn ? 'নির্দিষ্ট দিন ও সময়ে অবস্থা নিজে থেকে বদলাবে। যেমন প্রতিদিন রাত ১০টা থেকে ভোর ৬টা ঘুম।' : 'On chosen days and times the status changes by itself, for example sleeping every night 22:00 to 06:00.'} />
            {schedule.map((b, i) => row('calendar-clock', b.days.map((d) => (bn ? DAYS_BN : DAYS_EN)[d] ?? '').join(' '), `${b.from} - ${b.to}, ${labelOf(b.status)}`,
              <AppIconButton icon="delete-outline" variant="danger" label={bn ? 'মুছুন' : 'Delete'} onPress={() => void save({ schedule: schedule.filter((_, j) => j !== i) })} />, `${i}-${b.from}`))}
            {blk ? (
              <View style={{ gap: 10 }}>
                <View>
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>{bn ? 'কোন কোন দিন' : 'Which days'}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {DAYS_BN.map((d, i) => <Chip key={d} label={bn ? d : (DAYS_EN[i] ?? d)} active={blk.days.includes(i)} onPress={() => setBlk({ ...blk, days: blk.days.includes(i) ? blk.days.filter((x) => x !== i) : [...blk.days, i] })} />)}
                  </View>
                </View>
                <TimePick label={bn ? 'শুরু' : 'From'} value={blk.from} onChange={(v) => setBlk({ ...blk, from: v })} />
                <TimePick label={bn ? 'শেষ' : 'To'} value={blk.to} onChange={(v) => setBlk({ ...blk, to: v })} />
                <ChipGroup<string> label={bn ? 'অবস্থা' : 'Status'} options={statuses.map((x) => x.key)} value={blk.status} labelOf={labelOf} onChange={(k) => setBlk({ ...blk, status: k ?? blk.status })} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <AppButton variant="secondary" label={bn ? 'বাতিল' : 'Cancel'} onPress={() => setBlk(null)} style={{ flex: 1 }} />
                  <AppButton icon="check" label={bn ? 'সংরক্ষণ' : 'Save'} disabled={!blk.days.length} onPress={() => void saveBlock()} style={{ flex: 1 }} />
                </View>
              </View>
            ) : <AppButton variant="secondary" icon="plus" label={bn ? 'নতুন সময়' : 'New time block'} onPress={() => setBlk({ days: [], from: '22:00', to: '06:00', status: statuses.find((x) => x.key === 'sleeping')?.key ?? statuses[0]?.key ?? 'free' })} />}
          </Card>

          <Card icon="map-marker-outline" title={bn ? 'সংরক্ষিত জায়গা' : 'Saved places'}>
            <InfoHint text={bn ? 'আপনি কোনো সংরক্ষিত জায়গার কাছে থাকলে তবেই সহকারী বলবে আপনি কোথায়। অন্য সময় কখনও জায়গা বলা হয় না।' : 'The assistant only says where you are when you are at a saved place. Otherwise your location is never shared.'} />
            {places.map((x) => row('map-marker-outline', x.label, `${x.say} (${x.radius_m >= 1000 ? `${x.radius_m / 1000} km` : `${x.radius_m} m`})`,
              <AppIconButton icon="delete-outline" variant="danger" label={bn ? 'মুছুন' : 'Delete'} onPress={() => void save({ places: places.filter((y) => y.key !== x.key) })} />, x.key))}
            <Field label={bn ? 'জায়গার নাম' : 'Place name'} value={pl.label} onChangeText={(v) => setPl({ ...pl, label: v })} placeholder={bn ? 'যেমন: দোকান' : 'e.g. Shop'} />
            <Field label={bn ? 'সহকারী যা বলবে' : 'What it says'} value={pl.say} onChangeText={(v) => setPl({ ...pl, say: v })} placeholder={bn ? '{owner} এখন দোকানে আছেন।' : '{owner} is at the shop.'} multiline />
            <ChipGroup<(typeof RADII)[number]> label={bn ? 'কতটা কাছে থাকলে' : 'How close'} options={RADII} value={pl.radius as (typeof RADII)[number]} labelOf={(r) => (r === '1000' ? '1 km' : `${r} m`)} onChange={(r) => { if (r) setPl({ ...pl, radius: r }); }} />
            <AppButton variant="secondary" icon="crosshairs-gps" loading={locBusy} label={bn ? 'এখনকার জায়গা সংরক্ষণ করুন' : 'Save my current place'} onPress={() => void captureHere()} />
            {pl.lat != null && pl.lng != null ? <Text style={{ fontSize: 12, color: colors.success }}>{bn ? `জায়গা নেওয়া হয়েছে (${pl.lat}, ${pl.lng})` : `Location captured (${pl.lat}, ${pl.lng})`}</Text> : null}
            <AppButton icon="check" label={bn ? 'জায়গা যোগ করুন' : 'Add place'} disabled={!pl.label.trim() || !pl.say.trim() || pl.lat == null} onPress={() => void savePlace()} />
          </Card>
        </>
      ) : null}
    </Page>
  );
}
