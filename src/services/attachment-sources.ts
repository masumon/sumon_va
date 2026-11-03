import type { SQLiteDatabase } from 'expo-sqlite';
import {
  addAttachments, addPhotoAttachment, stageAttachments, stagePhoto,
  type Attachment, type AttachmentOwner, type StagedAttachment,
} from './attachment-service';

// B-10: one way to add a file anywhere in the app — camera, gallery or any file — so a
// task, a memory, a money entry, a test report and a debt all offer the same three.

export type AttachSource = 'camera' | 'gallery' | 'file';

/** For a record not saved yet: pick, keep aside, save together with the record. */
export async function stageFrom(source: AttachSource): Promise<StagedAttachment[]> {
  return source === 'file' ? stageAttachments() : stagePhoto(source);
}

/** For a record that already exists: pick and attach straight away. */
export async function addFrom(db: SQLiteDatabase, ownerType: AttachmentOwner, ownerId: string, source: AttachSource): Promise<Attachment[]> {
  return source === 'file' ? addAttachments(db, ownerType, ownerId) : addPhotoAttachment(db, ownerType, ownerId, source);
}
