// Task and memory cards open the same read-first preview the health lists use
// (RecordPreview) — the user's rule: a card behaves like Health's in every module. The
// full page each card used to open directly is one tap away and keeps every action it had
// (steps, files, delete with its own confirmation), so nothing a person could do is lost.

import { router } from 'expo-router';
import { create } from 'zustand';
import { RecordPreview } from './RecordPreview';
import { useAppPreferences } from '../app/AppPreferences';
import { formatBangladeshDate, formatBangladeshDateTime } from '../i18n/date-time';
import { taskCopy } from '../i18n/task';
import type { Task } from '../types/task-model';
import type { Memory } from '../types/memory-model';
import { tagLabel } from './TagSuggestions';

const REPEAT_BN: Record<string, string> = { DAILY: 'প্রতিদিন', WEEKDAYS: 'কাজের দিনে (রবি–বৃহস্পতি)', WEEKLY: 'প্রতি সপ্তাহে', MONTHLY: 'প্রতি মাসে' };
const REPEAT_EN: Record<string, string> = { DAILY: 'Every day', WEEKDAYS: 'Weekdays (Sun–Thu)', WEEKLY: 'Every week', MONTHLY: 'Every month' };

export function TaskPreview({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { language } = useAppPreferences();
  const bn = language === 'bn';
  if (!task) return null;
  const copy = taskCopy(language);
  return (
    <RecordPreview
      visible
      icon="checkbox-marked-circle-outline"
      title={task.title}
      subtitle={copy.statusLabels[task.status]}
      rows={[
        { label: bn ? 'কখন' : 'When', value: task.dueAt ? formatBangladeshDateTime(task.dueAt, language) : task.plannedDate ? formatBangladeshDate(`${task.plannedDate}T00:00:00`, language) : null, strong: true },
        { label: bn ? 'গুরুত্ব' : 'Priority', value: copy.priorityLabels[task.priority] },
        { label: bn ? 'পুনরাবৃত্তি' : 'Repeats', value: task.recurrence ? (bn ? REPEAT_BN : REPEAT_EN)[task.recurrence] : null },
        { label: bn ? 'নোট' : 'Notes', value: task.notes },
      ]}
      editIcon="open-in-new"
      editLabel={bn ? 'খুলুন — বদলান, ধাপ, ফাইল' : 'Open — edit, steps, files'}
      onEdit={() => { const id = task.id; onClose(); router.push({ pathname: '/task-detail', params: { id } } as never); }}
      onClose={onClose}
    />
  );
}

export function MemoryPreview({ memory, onClose }: { memory: Memory | null; onClose: () => void }) {
  const { language } = useAppPreferences();
  const bn = language === 'bn';
  if (!memory) return null;
  return (
    <RecordPreview
      visible
      icon="bookmark-outline"
      title={memory.title?.trim() || memory.content.split('\n')[0]!.slice(0, 80)}
      subtitle={formatBangladeshDate(memory.createdAt, language)}
      rows={[
        { label: bn ? 'লেখা' : 'Text', value: memory.content, strong: true },
        { label: bn ? 'ট্যাগ' : 'Tags', value: memory.tags.length ? memory.tags.map((t) => tagLabel(t, bn)).join(', ') : null },
      ]}
      editIcon="open-in-new"
      editLabel={bn ? 'খুলুন — বদলান, ফাইল' : 'Open — edit, files'}
      onEdit={() => { const id = memory.id; onClose(); router.push({ pathname: '/memory-detail', params: { id } } as never); }}
      onClose={onClose}
    />
  );
}

// One preview open at a time, opened from any list row without threading a callback
// through memoized rows; the host is mounted once in the root layout.
type Open = { kind: 'task'; task: Task } | { kind: 'memory'; memory: Memory } | null;
export const usePreview = create<{ open: Open; show: (o: Open) => void }>((set) => ({ open: null, show: (open) => set({ open }) }));
export const openTaskPreview = (task: Task) => usePreview.getState().show({ kind: 'task', task });
export const openMemoryPreview = (memory: Memory) => usePreview.getState().show({ kind: 'memory', memory });

export function PreviewHost() {
  const open = usePreview((s) => s.open);
  const close = () => usePreview.getState().show(null);
  if (open?.kind === 'task') return <TaskPreview task={open.task} onClose={close} />;
  if (open?.kind === 'memory') return <MemoryPreview memory={open.memory} onClose={close} />;
  return null;
}
