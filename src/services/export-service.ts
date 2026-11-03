import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';
import { listAllTasks } from './task-repository';
import { listAllMemories } from './memory-repository';
import { buildCsv, buildJson, buildMarkdown, type ExportFormat } from './export-format';

export type { ExportFormat } from './export-format';
export type ExportResult = 'shared' | 'unavailable';

// Read-only: pulls the whole library, formats it (export-format.ts), writes one file to
// the cache dir and hands it to the OS share sheet. No schema, no store, nothing leaves
// the device except through the share the user picks.
async function buildFile(db: SQLiteDatabase, format: ExportFormat): Promise<{ uri: string; mime: string; uti: string }> {
  const [tasks, memories] = await Promise.all([listAllTasks(db), listAllMemories(db)]);
  const now = new Date().toISOString();
  const stamp = now.slice(0, 10);
  const spec = format === 'json'
    ? { content: buildJson(tasks, memories, now), name: `apon-${stamp}.json`, mime: 'application/json', uti: 'public.json' }
    : format === 'csv'
      ? { content: buildCsv(tasks, memories), name: `apon-${stamp}.csv`, mime: 'text/csv', uti: 'public.comma-separated-values-text' }
      : { content: buildMarkdown(tasks, memories, now), name: `apon-${stamp}.md`, mime: 'text/markdown', uti: 'net.daringfireball.markdown' };
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const uri = `${dir}${spec.name}`;
  await FileSystem.writeAsStringAsync(uri, spec.content);
  return { uri, mime: spec.mime, uti: spec.uti };
}

export async function shareExport(db: SQLiteDatabase, format: ExportFormat): Promise<ExportResult> {
  const { uri, mime, uti } = await buildFile(db, format);
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: 'Export a copy', UTI: uti });
  return 'shared';
}
