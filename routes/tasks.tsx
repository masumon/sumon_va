import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../src/ui/AppText';
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

type TaskTab = 'open' | 'proposed' | 'done';
const STATES = ['in_progress', 'blocked', 'delayed', 'completed'] as const;
const STATE_LABEL: Record<(typeof STATES)[number], { bn: string; en: string }> = {
  in_progress: { bn: 'চলছে', en: 'In progress' },
  blocked: { bn: 'আটকে আছে', en: 'Blocked' },
  delayed: { bn: 'দেরি হচ্ছে', en: 'Delayed' },
  completed: { bn: 'শেষ', en: 'Completed' },
};

/** 3-tab Smart Tasks screen: Confirmed Open · AI/Official Proposed · Completed. */
export default function TasksScreen() {
  const { bn, colors, language, design } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [tab, setTab] = useState<TaskTab>('open');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [askDelete, setAskDelete] = useState<{ id: string; title: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [state, setState] = useState<(typeof STATES)[number] | null>(null);
  const [progress, setProgress] = useState('');
  const [blocker, setBlocker] = useState('');
  const open = useLoad(() => va.tasks('open'), 'tasks-open', 20000);
  const done = useLoad(() => va.tasks('done'), 'tasks-done', 20000);
  const ov = useLoad(() => va.overview(), 'tasks-overview', 30000);
  const late = ov.data?.tasks_late ?? 0;

  const openRows = open.data ?? [];
  const confirmedOpen = openRows.filter((t) => !t.proposed);
  const proposedOpen = openRows.filter((t) => !!t.proposed);
  const doneRows = done.data ?? [];
  const shown = tab === 'open' ? confirmedOpen : tab === 'proposed' ? proposedOpen : doneRows;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await Promise.all([open.reload(), done.reload(), ov.reload()]); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
    finally { setBusy(false); }
  };

  return (
    <Page
      title={bn ? 'কাজের তালিকা' : 'Tasks'}
      hideHeader
      onRefresh={() => { void open.reload(); void done.reload(); void ov.reload(); }}
      refreshing={(open.loading || done.loading) && !!(open.data || done.data)}
    >
      <Hero
        icon="checkbox-marked-circle-outline"
        title={bn ? 'কাজের তালিকা' : 'Your tasks'}
        subtitle={late ? (bn ? `${num(late, true)}টির সময় পার হয়ে গেছে` : `${late} overdue`) : (bn ? 'সময়মতো চলছে ✓' : 'On track ✓')}
      >
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <HeroStat value={formatBangladeshNumber(confirmedOpen.length, language)} label={bn ? 'নিশ্চিত বাকি' : 'Open'} />
          <HeroStat value={formatBangladeshNumber(proposedOpen.length, language)} label={bn ? 'প্রস্তাবিত (AI)' : 'Proposed'} />
          <HeroStat value={formatBangladeshNumber(late, language)} label={bn ? 'দেরি' : 'Overdue'} />
        </View>
      </Hero>

      {/* Compact Quick-Add Task Row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 8,
          borderRadius: design.radiusCard,
          borderWidth: 1,
          borderColor: design.cardBorder,
          backgroundColor: colors.surface,
        }}
      >
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={bn ? 'নতুন কাজ লিখুন (যেমন: রহিমকে দাম জানানো)…' : 'Add a new task…'}
          placeholderTextColor={colors.textMuted}
          style={{
            flex: 1,
            minHeight: 42,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: colors.surfaceMuted,
            color: colors.textPrimary,
            fontSize: 13.5,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bn ? 'যোগ করুন' : 'Add'}
          disabled={!title.trim() || busy}
          onPress={() => void act(async () => { await va.addTask(title.trim()); setTitle(''); showSnackbar(bn ? '✓ নতুন কাজ যোগ হয়েছে' : '✓ Task added', 'success'); })}
          style={{
            height: 42,
            paddingHorizontal: 14,
            borderRadius: 10,
            backgroundColor: colors.primary,
            opacity: !title.trim() || busy ? 0.5 : 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.onPrimary }}>{bn ? '+ যোগ' : '+ Add'}</Text>
        </Pressable>
      </View>

      {/* 3 Smart Task Tabs */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[
          { k: 'open' as TaskTab, bn: `বাকি (${num(confirmedOpen.length, true)})`, en: `Open (${confirmedOpen.length})` },
          { k: 'proposed' as TaskTab, bn: `প্রস্তাবিত (${num(proposedOpen.length, true)})`, en: `Proposed (${proposedOpen.length})` },
          { k: 'done' as TaskTab, bn: `শেষ (${num(doneRows.length, true)})`, en: `Done (${doneRows.length})` },
        ].map((t) => {
          const active = tab === t.k;
          return (
            <Pressable
              key={t.k}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(t.k)}
              style={{
                flex: 1,
                minHeight: 38,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.primary : colors.surface,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '800', color: active ? colors.onPrimary : colors.textPrimary }}>
                {bn ? t.bn : t.en}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Status loading={(tab === 'done' ? done.loading && !done.data : open.loading && !open.data)} error={tab === 'done' ? (done.data ? null : done.error) : (open.data ? null : open.error)} onRetry={() => { void open.reload(); void done.reload(); }} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {shown.length === 0 && !(tab === 'done' ? done.loading : open.loading) ? (
        <EmptyNote
          icon="check-all"
          text={
            tab === 'open'
              ? (bn ? 'কোনো নিশ্চিত কাজ বাকি নেই ✓' : 'No open tasks ✓')
              : tab === 'proposed'
                ? (bn ? 'কোনো প্রস্তাবিত কাজ অপেক্ষায় নেই ✓' : 'No proposed tasks ✓')
                : (bn ? 'এখনো কিছু শেষ হয়নি' : 'Nothing done yet')
          }
        />
      ) : null}

      {shown.map((t) => (
        <View key={t.id} style={{ gap: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: t.is_done }}
              accessibilityLabel={t.title}
              onPress={() => void act(() => va.toggleTask(t.id))}
              hitSlop={8}
              style={{ minWidth: 42, minHeight: 42, alignItems: 'center', justifyContent: 'center' }}
            >
              <AppIcon name={t.is_done ? 'check-circle' : 'circle-outline'} size={26} color={t.is_done ? colors.success : colors.primary} />
            </Pressable>
            <View style={{ flex: 1 }}>
              {t.contact_name || t.contact_phone ? (
                <Text numberOfLines={1} style={{ fontWeight: '800', fontSize: 13.5, color: colors.primary, opacity: t.is_done ? 0.6 : 1 }}>
                  {t.contact_name || t.contact_phone}
                </Text>
              ) : null}
              {t.proposed ? (
                <View style={{ alignSelf: 'flex-start', marginVertical: 2 }}>
                  <AppBadge label={bn ? 'প্রস্তাবিত (AI/দাপ্তরিক)' : 'Proposed'} tone="warning" />
                </View>
              ) : null}
              <Text style={{ fontWeight: '600', fontSize: 14, textDecorationLine: t.is_done ? 'line-through' : 'none', opacity: t.is_done ? 0.6 : 1 }}>
                {t.title}
              </Text>
              <Text style={{ opacity: 0.65, fontSize: 11.5, marginTop: 2 }}>
                {[t.due_at ? formatBangladeshDateTime(t.due_at, language) : null, t.source === 'ai' ? (bn ? 'সহকারী লিখেছে' : 'written by assistant') : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            {t.proposed && !t.is_done ? (
              <AppButton label={bn ? '✓ নিশ্চিত করুন' : '✓ Confirm'} disabled={busy} onPress={() => void act(async () => { await va.confirmTask(t.id); showSnackbar(bn ? '✓ কাজটি নিশ্চিত করা হয়েছে' : '✓ Task confirmed', 'success'); })} style={{ minHeight: 40 }} />
            ) : null}
            {!t.is_done ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={bn ? 'অগ্রগতি লিখুন' : 'Add progress'}
                onPress={() => { setEditId(editId === t.id ? null : t.id); setState(null); setProgress(''); setBlocker(''); }}
                hitSlop={8}
                style={{ minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' }}
              >
                <AppIcon name="progress-pencil" size={20} color={colors.textMuted} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={bn ? 'মুছুন' : 'Delete'}
              onPress={() => setAskDelete({ id: t.id, title: t.title })}
              hitSlop={8}
              style={{ minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' }}
            >
              <AppIcon name="trash-can-outline" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>
      ))}

      {editId ? (
        <Card title={bn ? 'কাজের অগ্রগতি' : 'Task progress'}>
          <Text style={{ opacity: 0.7, marginBottom: 6 }}>
            {bn ? 'এটা শুধু আপনিই লিখতে পারেন। কেউ জিজ্ঞেস করলে সহকারী এটা দেখেই সত্যি উত্তর দেবে।' : 'Only you can write this.'}
          </Text>
          <ChipGroup<(typeof STATES)[number]> options={STATES} value={state} labelOf={(k) => (bn ? STATE_LABEL[k].bn : STATE_LABEL[k].en)} onChange={(k) => setState(k ?? null)} />
          <Field label={bn ? 'কতদূর হলো' : 'Progress so far'} value={progress} onChangeText={setProgress} multiline />
          <Field label={bn ? 'কী আটকে আছে (থাকলে)' : 'What is blocking it'} value={blocker} onChangeText={setBlocker} multiline />
          <View style={{ gap: 8, marginTop: 8 }}>
            <AppButton
              label={bn ? 'সংরক্ষণ' : 'Save'}
              loading={busy}
              disabled={!state && !progress.trim() && !blocker.trim()}
              onPress={() => void act(async () => {
                await va.taskProgress(editId, { ...(state ? { status: state } : {}), ...(progress.trim() ? { progress: progress.trim() } : {}), ...(blocker.trim() ? { blocker: blocker.trim() } : {}) });
                setEditId(null);
                showSnackbar(bn ? 'সংরক্ষণ হয়েছে' : 'Saved', 'success');
              })}
            />
            <AppButton variant="secondary" label={bn ? 'বন্ধ করুন' : 'Close'} onPress={() => setEditId(null)} />
          </View>
        </Card>
      ) : null}

      <AppConfirmDialog
        visible={!!askDelete}
        title={bn ? 'কাজটি মুছবেন?' : 'Delete this task?'}
        description={askDelete?.title}
        confirmLabel={bn ? 'মুছুন' : 'Delete'}
        cancelLabel={bn ? 'না' : 'No'}
        danger
        icon="trash-can-outline"
        onCancel={() => setAskDelete(null)}
        onConfirm={() => { const id = askDelete?.id; setAskDelete(null); if (id) void act(() => va.removeTask(id)); }}
      />
    </Page>
  );
}
