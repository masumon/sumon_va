// Files attached to a debt account or a ledger row.
//
// This used to be a second implementation of the app's attachment store, written against
// its own `dr_attachments` table — copying files, inserting rows, cleaning up on failure,
// all a second time. It exists now only to name the two owner kinds this module uses and
// to hand them to the shared store, which is where every module's files live.
//
// The owner kinds are namespaced (`DEBT_ACCOUNT`, not `ACCOUNT`) so a later module can
// have accounts of its own without the two colliding in one table.

import type { SQLiteDatabase } from 'expo-sqlite';
import {
  addAttachments,
  listAttachments,
  registerAttachmentOwner,
  removeAttachment,
  removeAttachmentsForOwner,
  shareAttachment,
  type Attachment,
} from '../attachment-service';

export type DebtAttachmentOwner = 'ACCOUNT' | 'TRANSACTION';

const OWNER_KIND: Record<DebtAttachmentOwner, string> = {
  ACCOUNT: 'DEBT_ACCOUNT',
  TRANSACTION: 'DEBT_TRANSACTION',
};

// Teach the shared store how to check these owners exist, so a file is never copied into
// app storage for a record that has since been deleted.
registerAttachmentOwner('DEBT_ACCOUNT', async (db, ownerId) => {
  const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM dr_accounts WHERE id = ? AND deleted_at IS NULL LIMIT 1', ownerId);
  return Boolean(row);
});
registerAttachmentOwner('DEBT_TRANSACTION', async (db, ownerId) => {
  const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM dr_transactions WHERE id = ? AND deleted_at IS NULL LIMIT 1', ownerId);
  return Boolean(row);
});

export async function listDebtAttachments(db: SQLiteDatabase, owner: DebtAttachmentOwner, ownerId: string): Promise<Attachment[]> {
  return listAttachments(db, OWNER_KIND[owner], ownerId);
}

export async function addDebtAttachments(db: SQLiteDatabase, owner: DebtAttachmentOwner, ownerId: string): Promise<Attachment[]> {
  return addAttachments(db, OWNER_KIND[owner], ownerId);
}

export async function removeDebtAttachment(db: SQLiteDatabase, attachment: Attachment): Promise<boolean> {
  return removeAttachment(db, attachment);
}

export async function removeDebtAttachmentsForOwner(db: SQLiteDatabase, owner: DebtAttachmentOwner, ownerId: string): Promise<number> {
  return removeAttachmentsForOwner(db, OWNER_KIND[owner], ownerId);
}

/** Open a stored file with whatever app the device uses for its type. */
export async function openDebtAttachment(attachment: Attachment): Promise<void> {
  await shareAttachment(attachment);
}

export type { Attachment };
/** @deprecated Use `Attachment` — kept while the debt screens still name it. */
export type DebtAttachment = Attachment;

/** "১.২ MB" / "820 KB" — a size a person reads, not a byte count. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
