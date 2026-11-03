import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { Card, ChipGroup, EmptyNote, Field, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { formatBangladeshDateTime } from '../src/i18n/date-time';
import { va } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero, HeroStat } from '../src/va/Hero';
import { Page, Status } from '../src/va/Page';

type Show = 'open' | 'done';

/** What you promised people (the assistant writes some of these from their messages; you can add your own). */
export default function TasksScreen() {
  const { bn, colors, language } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [show, setShow] = useState<Show>('open');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useLoad(() => va.tasks(show), `tasks-${show}`, 20000);
  const open = useLoad(() => va.tasks('open'), 'tasks-open', 20000);
  const ov = useLoad(() => va.overview(), 'tasks-overview', 30000);
  const late = ov.data?.tasks_late ?? 0;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await Promise.all([list.reload(), open.reload()]); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', 'danger'); }
    finally { setBusy(false); }
  };

  return (
    <Page title={bn ? 'কাজের তালিকা' : 'Tasks'} subtitle={bn ? 'কাকে কী দেওয়ার কথা দিয়েছেন' : 'What you promised to whom'} onRefresh={() => { void list.reload(); void open.reload(); }} refreshing={list.loading && !!list.data}>
      <Hero icon="checkbox-marked-circle-outline" title={bn ? 'আপনার কাজ' : 'Your tasks'} subtitle={late ? (bn ? `${late}টির সময় পার হয়ে গেছে` : `${late} overdue`) : (bn ? 'সময়মতো চলছে ✓' : 'On track ✓')}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <HeroStat value={String(open.data?.length ?? 0)} label={bn ? 'বাকি' : 'Open'} />
          <HeroStat value={String(late)} label={bn ? 'দেরি' : 'Overdue'} />
        </View>
      </Hero>
      <Card title={bn ? 'নতুন কাজ' : 'New task'}>
        <Field label="" value={title} onChangeText={setTitle} placeholder={bn ? 'যেমন: রহিমকে দাম জানানো' : 'e.g. Send Rahim the price'} />
        <View style={{ marginTop: 8 }}><AppButton label={bn ? 'যোগ করুন' : 'Add'} icon="plus" loading={busy} disabled={!title.trim()} onPress={() => void act(async () => { await va.addTask(title.trim()); setTitle(''); })} /></View>
      </Card>
      <ChipGroup<Show> options={['open', 'done']} value={show} labelOf={(k) => (k === 'open' ? (bn ? 'বাকি' : 'Open') : (bn ? 'শেষ' : 'Done'))} onChange={(v) => { if (v) setShow(v); }} />
      <Status loading={list.loading && !list.data} error={list.data ? null : list.error} onRetry={list.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {list.data && list.data.length === 0 ? <EmptyNote icon="check-all" text={show === 'open' ? (bn ? 'কোনো কাজ বাকি নেই 🎉' : 'Nothing left to do 🎉') : (bn ? 'এখনও কিছু শেষ হয়নি' : 'Nothing done yet')} /> : null}
      {(list.data ?? []).map((t) => (
        <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: t.is_done }} accessibilityLabel={t.title} onPress={() => void act(() => va.toggleTask(t.id))} hitSlop={8}>
            <AppIcon name={t.is_done ? 'check-circle' : 'circle-outline'} size={28} color={t.is_done ? colors.success : colors.primary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600', textDecorationLine: t.is_done ? 'line-through' : 'none', opacity: t.is_done ? 0.6 : 1 }}>{t.title}</Text>
            <Text style={{ opacity: 0.6, fontSize: 12 }}>
              {[t.contact_name || t.contact_phone, t.due_at ? formatBangladeshDateTime(t.due_at, language) : null, t.source === 'ai' ? (bn ? 'সহকারী লিখেছে' : 'written by the assistant') : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'মুছুন' : 'Delete'} onPress={() => void act(() => va.removeTask(t.id))} hitSlop={8}><AppIcon name="trash-can-outline" size={22} color={colors.textMuted} /></Pressable>
        </View>
      ))}
    </Page>
  );
}
