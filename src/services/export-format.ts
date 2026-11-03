import type { Task } from '../types/task-model';
import type { Memory } from '../types/memory-model';

// Pure string builders for the "export a copy" feature — no filesystem, no native modules,
// so they stay unit-testable. The IO wrapper lives in export-service.ts.

export type ExportFormat = 'markdown' | 'json' | 'csv';

const TASK_STATUS_ORDER: Task['status'][] = ['INBOX', 'PLANNED', 'IN_PROGRESS', 'RESCHEDULED', 'COMPLETED', 'CANCELLED', 'ARCHIVED'];
const MEMORY_KIND_ORDER: Memory['kind'][] = ['NOTE', 'FACT', 'PREFERENCE', 'EVENT', 'REFLECTION'];

function csvField(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/gu, '""')}"` : s;
}
function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(',');
}

export function buildTasksCsv(tasks: Task[]): string {
  const head = csvRow(['id', 'title', 'notes', 'status', 'priority', 'dueAt', 'plannedDate', 'completedAt', 'recurrence', 'createdAt', 'updatedAt']);
  const rows = tasks.map(t => csvRow([t.id, t.title, t.notes, t.status, t.priority, t.dueAt, t.plannedDate, t.completedAt, t.recurrence ?? '', t.createdAt, t.updatedAt]));
  return [head, ...rows].join('\n');
}
export function buildMemoriesCsv(memories: Memory[]): string {
  const head = csvRow(['id', 'title', 'content', 'kind', 'source', 'tags', 'importance', 'archived', 'createdAt', 'updatedAt']);
  const rows = memories.map(m => csvRow([m.id, m.title, m.content, m.kind, m.source, m.tags.join(' '), m.importance, m.archived ? 'yes' : 'no', m.createdAt, m.updatedAt]));
  return [head, ...rows].join('\n');
}
export function buildCsv(tasks: Task[], memories: Memory[]): string {
  return `# TASKS\n${buildTasksCsv(tasks)}\n\n# MEMORIES\n${buildMemoriesCsv(memories)}\n`;
}

export function buildJson(tasks: Task[], memories: Memory[], exportedAt: string): string {
  return JSON.stringify(
    { app: 'Apon', format: 'export/v1', exportedAt, counts: { tasks: tasks.length, memories: memories.length }, tasks, memories },
    null,
    2,
  );
}

function humanDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: iso.length > 10 ? '2-digit' : undefined, minute: iso.length > 10 ? '2-digit' : undefined, hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/gu, ' ');

export function buildMarkdown(tasks: Task[], memories: Memory[], exportedAt: string): string {
  const lines: string[] = [];
  lines.push('# Apon — export', '', `_Exported ${humanDate(exportedAt)} · ${tasks.length} tasks · ${memories.length} memories_`, '');

  lines.push(`## Tasks (${tasks.length})`, '');
  for (const status of TASK_STATUS_ORDER) {
    const group = tasks.filter(t => t.status === status);
    if (!group.length) continue;
    lines.push(`### ${titleCase(status)}`, '');
    for (const t of group) {
      const box = t.status === 'COMPLETED' ? '[x]' : '[ ]';
      const meta = [
        t.priority !== 'MEDIUM' ? t.priority.toLowerCase() : null,
        t.dueAt ? `due ${humanDate(t.dueAt)}` : t.plannedDate ? `planned ${humanDate(t.plannedDate)}` : null,
        t.recurrence ? `repeats ${t.recurrence.toLowerCase()}` : null,
      ].filter(Boolean).join(' · ');
      lines.push(`- ${box} **${t.title}**${meta ? ` — ${meta}` : ''}`);
      if (t.notes?.trim()) for (const nl of t.notes.trim().split('\n')) lines.push(`  > ${nl}`);
    }
    lines.push('');
  }

  lines.push(`## Memories (${memories.length})`, '');
  for (const kind of MEMORY_KIND_ORDER) {
    const group = memories.filter(m => m.kind === kind);
    if (!group.length) continue;
    lines.push(`### ${titleCase(kind)}`, '');
    for (const m of group) {
      const head = m.title?.trim() ? `**${m.title.trim()}** — ` : '';
      const tags = m.tags.length ? ` _(${m.tags.map(x => `#${x}`).join(' ')})_` : '';
      const body = m.content.replace(/\n+/gu, ' ').trim();
      lines.push(`- ${head}${body}${tags}`);
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim() + '\n';
}
