import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { Card, ChipGroup, EmptyNote, Field, useKit } from '../src/ui/AppKit';
import { useAppFeedback, AppConfirmDialog } from '../src/ui/AppFeedback';
import { formatBangladeshDateTime, formatBangladeshNumber } from '../src/i18n/date-time';
import { va, errTone } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero, HeroStat } from '../src/va/Hero';
import { Page, Status } from '../src/va/Page';
import { num } from '../src/va/bd';

type Show = 'open' | 'done';
const STATES = ['in_progress', 'blocked', 'delayed', 'completed'] as const;
const STATE_LABEL: Record<(typeof STATES)[number], { bn: string; en: string }> = {
  in_progress: { bn: 'চলছে', en: 'In progress' }, blocked: { bn: 'আটকে আছে', en: 'Blocked' }, delayed: { bn: 'দেরি হচ্ছে', en: 'Delayed' }, completed: { bn: 'শেষ', en: 'Completed' },
};

/** What you promised people (the assistant writes some of these from their messages; you can add your own). */
export default function TasksScreen() {
  const { bn, colors, language } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [show, setShow] = useState<Show>('open');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [askDelete, setAskDelete] = useState<{ id: string; title: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [state, setState] = useState<(typeof STATES)[number] | null>(null);
  const [progress, setProgress] = useState('');
  const [blocker, setBlocker] = useState('');
  const list = useLoad(() => va.tasks(show), `tasks-${show}`, 20000);
  const open = useLoad(() => va.tasks('open'), 'tasks-open', 20000);
  const ov = useLoad(() => va.overview(), 'tasks-overview', 30000);
  const late = ov.data?.tasks_late ?? 0;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await Promise.all([list.reload(), open.reload()]); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
    finally { setBusy(false); }
  };

  return (
    <Page title={bn ? 'কাজের তালিকা' : 'Tasks'} subtitle={bn ? 'কাকে কী কথা দিয়েছেন' : 'What you promised to whom'} onRefresh={() => { void list.reload(); void open.reload(); }} refreshing={list.loading && !!list.data}>
      <Hero icon="checkbox-marked-circle-outline" title={bn ? 'আপনার কাজ' : 'Your tasks'} subtitle={late ? (bn ? `${num(late, true)}টির সময় পার হয়ে গেছে` : `${late} overdue`) : (bn ? 'সময়মতো চলছে ✓' : 'On track ✓')}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <HeroStat value={formatBangladeshNumber(open.data?.length ?? 0, language)} label={bn ? 'বাকি' : 'Open'} />
          <HeroStat value={formatBangladeshNumber(late, language)} label={bn ? 'দেরি' : 'Overdue'} />
        </View>
      </Hero>
      <Card title={bn ? 'নতুন কাজ' : 'New task'}>
        <Field label="" value={title} onChangeText={setTitle} placeholder={bn ? 'যেমন: রহিমকে দাম জানানো' : 'e.g. Send Rahim the price'} />
        <View style={{ marginTop: 8 }}><AppButton label={bn ? 'যোগ করুন' : 'Add'} icon="plus" loading={busy} disabled={!title.trim()} onPress={() => void act(async () => { await va.addTask(title.trim()); setTitle(''); })} /></View>
      </Card>
      <ChipGroup<Show> options={['open', 'done']} value={show} labelOf={(k) => (k === 'open' ? (bn ? 'বাকি' : 'Open') : (bn ? 'শেষ' : 'Done'))} onChange={(v) => { if (v) setShow(v); }} />
      <Status loading={list.loading && !list.data} error={list.data ? null : list.error} onRetry={list.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {list.data && list.data.length === 0 ? <EmptyNote icon="check-all" text={show === 'open' ? (bn ? 'কোনো কাজ বাকি নেই ✓' : 'Nothing left to do ✓') : (bn ? 'এখনও কিছু শেষ হয়নি' : 'Nothing done yet')} /> : null}
      {(list.data ?? []).map((t) => (
        <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: t.is_done }} accessibilityLabel={t.title} onPress={() => void act(() => va.toggleTask(t.id))} hitSlop={8} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name={t.is_done ? 'check-circle' : 'circle-outline'} size={28} color={t.is_done ? colors.success : colors.primary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            {t.contact_name || t.contact_phone ? <Text numberOfLines={1} style={{ fontWeight: '800', fontSize: 15, opacity: t.is_done ? 0.6 : 1 }}>{t.contact_name || t.contact_phone}</Text> : null}
            {t.proposed ? <View style={{ alignSelf: 'flex-start', marginBottom: 4 }}><AppBadge label={bn ? 'প্রস্তাবিত' : 'Proposed'} tone="warning" /></View> : null}
            <Text style={{ fontWeight: t.contact_name || t.contact_phone ? '400' : '600', textDecorationLine: t.is_done ? 'line-through' : 'none', opacity: t.is_done ? 0.6 : 1 }}>{t.title}</Text>
            <Text style={{ opacity: 0.6, fontSize: 12 }}>
              {[t.due_at ? formatBangladeshDateTime(t.due_at, language) : null, t.source === 'ai' ? (bn ? 'সহকারী লিখেছে' : 'written by the assistant') : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {t.proposed && !t.is_done ? <AppButton variant="secondary" label={bn ? 'নিশ্চিত করুন' : 'Confirm'} disabled={busy} onPress={() => void act(() => va.confirmTask(t.id))} style={{ minHeight: 48 }} /> : null}
          {!t.is_done ? (
            <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'অগ্রগতি লিখুন' : 'Add progress'} onPress={() => { setEditId(editId === t.id ? null : t.id); setState(null); setProgress(''); setBlocker(''); }} hitSlop={8} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name="progress-pencil" size={22} color={colors.textMuted} />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'মুছুন' : 'Delete'} onPress={() => setAskDelete({ id: t.id, title: t.title })} hitSlop={8} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="trash-can-outline" size={22} color={colors.textMuted} /></Pressable>
        </View>
      ))}
      {editId ? (
        <Card title={bn ? 'কাজের অগ্রগতি' : 'Task progress'}>
          <Text style={{ opacity: 0.7, marginBottom: 6 }}>{bn ? 'এটা শুধু আপনিই লিখতে পারেন। কেউ জিজ্ঞেস করলে সহকারী এটা দেখেই সত্যি উত্তর দেবে।' : 'Only you can write this. The assistant uses it to answer honestly when someone asks.'}</Text>
          <ChipGroup<(typeof STATES)[number]> options={STATES} value={state} labelOf={(k) => (bn ? STATE_LABEL[k].bn : STATE_LABEL[k].en)} onChange={(k) => setState(k ?? null)} />
          <Field label={bn ? 'কতদূর হলো' : 'Progress so far'} value={progress} onChangeText={setProgress} multiline />
          <Field label={bn ? 'কী আটকে আছে (থাকলে)' : 'What is blocking it (if anything)'} value={blocker} onChangeText={setBlocker} multiline />
          <View style={{ gap: 8, marginTop: 8 }}>
            <AppButton label={bn ? 'সংরক্ষণ' : 'Save'} loading={busy} disabled={!state && !progress.trim() && !blocker.trim()}
              onPress={() => void act(async () => { await va.taskProgress(editId, { ...(state ? { status: state } : {}), ...(progress.trim() ? { progress: progress.trim() } : {}), ...(blocker.trim() ? { blocker: blocker.trim() } : {}) }); setEditId(null); showSnackbar(bn ? 'সংরক্ষণ হয়েছে' : 'Saved', 'success'); })} />
            <AppButton variant="secondary" label={bn ? 'বন্ধ করুন' : 'Close'} onPress={() => setEditId(null)} />
          </View>
        </Card>
      ) : null}
      <AppConfirmDialog visible={!!askDelete} title={bn ? 'কাজটি মুছবেন?' : 'Delete this task?'} description={askDelete?.title} confirmLabel={bn ? 'মুছুন' : 'Delete'} cancelLabel={bn ? 'না' : 'No'} danger icon="trash-can-outline"
        onCancel={() => setAskDelete(null)} onConfirm={() => { const id = askDelete?.id; setAskDelete(null); if (id) void act(() => va.removeTask(id)); }} />
    </Page>
  );
}
