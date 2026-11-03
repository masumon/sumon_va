import type { SQLiteDatabase } from 'expo-sqlite';
import { Paths } from 'expo-file-system';
export interface AttachmentStorageSummary{count:number;knownBytes:number;availableBytes:number;}
export async function getAttachmentStorageSummary(db:SQLiteDatabase):Promise<AttachmentStorageSummary>{const row=await db.getFirstAsync<{count:number;known_bytes:number|null}>('SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS known_bytes FROM attachments');return{count:Number(row?.count??0),knownBytes:Number(row?.known_bytes??0),availableBytes:Number(Paths.availableDiskSpace??0)}}
