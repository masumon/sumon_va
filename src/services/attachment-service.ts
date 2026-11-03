import type { SQLiteDatabase } from 'expo-sqlite';
import { exclusiveTransaction } from '../database/atomic';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * What a file can hang off.
 *
 * A plain string, because a file belongs to every domain there is — a prescription, a
 * loan agreement, a salary slip, a certificate — and a union listed here would have to be
 * edited for each new module. The table no longer restricts it either; what a module must
 * do instead is register how to check its owners exist (see `registerAttachmentOwner`).
 */
export type AttachmentOwner=string;

/**
 * How to confirm an owner still exists, per kind.
 *
 * Files are copied into app storage before the row is written, so writing one against a
 * record that has been deleted would strand the file on disk. Tasks and memories are
 * registered below; a module registers its own at startup rather than editing this file.
 */
const ownerCheckers=new Map<string,(db:SQLiteDatabase,ownerId:string)=>Promise<boolean>>();

export function registerAttachmentOwner(kind:string,exists:(db:SQLiteDatabase,ownerId:string)=>Promise<boolean>):void{ownerCheckers.set(kind,exists);}

const existsInTable=(table:string)=>async(db:SQLiteDatabase,ownerId:string):Promise<boolean>=>{const row=await db.getFirstAsync<{id:string}>(`SELECT id FROM ${table} WHERE id=? LIMIT 1`,ownerId);return Boolean(row);};
registerAttachmentOwner('TASK',existsInTable('tasks'));
registerAttachmentOwner('MEMORY',existsInTable('memories'));
export interface Attachment{id:string;ownerType:AttachmentOwner;ownerId:string;name:string;mimeType:string;size:number|null;uri:string;createdAt:string;}
export interface StagedAttachment{id:string;name:string;mimeType:string;size:number|null;uri:string;createdAt:string;}
export class AttachmentUploadError extends Error{readonly selectedCount:number;readonly copiedCount:number;readonly persistedCount:number;readonly rolledBackCount:number;readonly cleanupFailures:number;constructor(message:string,status:{selectedCount:number;copiedCount:number;persistedCount:number;rolledBackCount:number;cleanupFailures:number}){super(message);this.name='AttachmentUploadError';this.selectedCount=status.selectedCount;this.copiedCount=status.copiedCount;this.persistedCount=status.persistedCount;this.rolledBackCount=status.rolledBackCount;this.cleanupFailures=status.cleanupFailures;}}
type AttachmentRow={id:string;owner_type:AttachmentOwner;owner_id:string;name:string;mime_type:string;size:number|null;uri:string;created_at:string};
const toAttachment=(row:AttachmentRow):Attachment=>({id:row.id,ownerType:row.owner_type,ownerId:row.owner_id,name:row.name,mimeType:row.mime_type,size:row.size,uri:row.uri,createdAt:row.created_at});
const safeName=(name:string)=>name.replace(/[^a-zA-Z0-9._-]+/gu,'_').slice(0,160)||'file';
const id=()=>`${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
const attachmentDirectory=()=>new Directory(Paths.document,'attachments');
// An unregistered kind is trusted: a module that has not registered a checker is still
// allowed to attach, it just does not get the stranded-file guard.
async function ownerExists(db:SQLiteDatabase,ownerType:AttachmentOwner,ownerId:string):Promise<boolean>{const check=ownerCheckers.get(ownerType);if(!check)return true;return check(db,ownerId);}
async function deleteFile(uri:string):Promise<void>{const file=new File(uri);if(file.exists)file.delete();}
async function cleanupFiles(uris:string[]):Promise<number>{let failures=0;for(const uri of uris){try{await deleteFile(uri)}catch{failures+=1}}return failures;}
export async function deleteAttachmentFiles(items:Pick<Attachment,'uri'>[]):Promise<number>{return cleanupFiles(items.map(item=>item.uri));}
export async function listAttachments(db:SQLiteDatabase,ownerType:AttachmentOwner,ownerId:string):Promise<Attachment[]>{const rows=await db.getAllAsync<AttachmentRow>('SELECT id,owner_type,owner_id,name,mime_type,size,uri,created_at FROM attachments WHERE owner_type=? AND owner_id=? ORDER BY created_at DESC',ownerType,ownerId);return rows.map(toAttachment);}
export async function stageAttachments():Promise<StagedAttachment[]>{const result=await DocumentPicker.getDocumentAsync({type:'*/*',multiple:true,copyToCacheDirectory:true});if(result.canceled||!result.assets?.length)return [];const directory=attachmentDirectory();directory.create({intermediates:true,idempotent:true});const staged:StagedAttachment[]=[];const copiedUris:string[]=[];try{for(const asset of result.assets){const attachmentId=id();const destination=new File(directory,`${attachmentId}-${safeName(asset.name)}`);const source=new File(asset.uri);source.copy(destination);copiedUris.push(destination.uri);staged.push({id:attachmentId,name:asset.name,mimeType:asset.mimeType??'application/octet-stream',size:destination.size??asset.size??null,uri:destination.uri,createdAt:new Date().toISOString()});}return staged}catch{const cleanupFailures=await cleanupFiles(copiedUris);throw new AttachmentUploadError('Attachment staging failed',{selectedCount:result.assets.length,copiedCount:copiedUris.length,persistedCount:0,rolledBackCount:copiedUris.length-cleanupFailures,cleanupFailures});}}
/**
 * Photograph something and stage it, or pick the picture from the gallery.
 *
 * `source: 'camera'` needs the camera permission; `'gallery'` needs none on Android 13+,
 * because the system photo picker hands back only the image the user chose. Either way
 * the file is copied into app storage first, so the record it will belong to can still be
 * abandoned without leaving a half-saved row behind.
 *
 * Returns an empty array when the user backs out, which is not an error.
 */
/** Thrown when the user has not granted what the picker needs, so the screen can say so. */
export class AttachmentPermissionError extends Error{
  readonly source:'camera'|'gallery';
  constructor(source:'camera'|'gallery'){super(`${source} permission not granted`);this.name='AttachmentPermissionError';this.source=source;}
}

/** `forReading`: full quality for OCR — JPEG at 0.7 blurred small print (RC.1 QA). No crop step: Android's crop screen showed no visible OK button on the user's phone (RC.2). */
export async function stagePhoto(source:'camera'|'gallery'='camera',forReading=false):Promise<StagedAttachment[]>{
  // Ask before opening. `launchCameraAsync` does not request on its own — it simply fails —
  // so tapping "photograph the receipt" produced "could not save the photo" and never a
  // permission prompt. The reason has to reach the user at the moment they asked for the
  // thing, or the feature just looks broken.
  const permission=source==='camera'
    ?await ImagePicker.requestCameraPermissionsAsync()
    :await ImagePicker.requestMediaLibraryPermissionsAsync();
  if(!permission.granted)throw new AttachmentPermissionError(source);

  const result=source==='camera'
    ?await ImagePicker.launchCameraAsync({mediaTypes:['images'],quality:forReading?1:0.7,exif:false})
    :await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:forReading?1:0.7,allowsMultipleSelection:!forReading,exif:false});
  if(result.canceled||!result.assets?.length)return [];
  const directory=attachmentDirectory();
  directory.create({intermediates:true,idempotent:true});
  const staged:StagedAttachment[]=[];
  const copiedUris:string[]=[];
  try{
    for(const asset of result.assets){
      const attachmentId=id();
      const stamp=new Date().toISOString().replace(/[:.]/gu,'-').slice(0,19);
      const name=asset.fileName??`photo-${stamp}.jpg`;
      const destination=new File(directory,`${attachmentId}-${safeName(name)}`);
      new File(asset.uri).copy(destination);
      copiedUris.push(destination.uri);
      // `asset.fileSize` is the picker's own report, which on some OEMs still describes
      // the pre-compression source once `quality<1` makes it re-encode — `destination.size`
      // is a real stat of the file this app just copied, so it can never drift from it.
      staged.push({id:attachmentId,name,mimeType:asset.mimeType??'image/jpeg',size:destination.size??asset.fileSize??null,uri:destination.uri,createdAt:new Date().toISOString()});
    }
    return staged;
  }catch{
    const cleanupFailures=await cleanupFiles(copiedUris);
    throw new AttachmentUploadError('Photo staging failed',{selectedCount:result.assets.length,copiedCount:copiedUris.length,persistedCount:0,rolledBackCount:copiedUris.length-cleanupFailures,cleanupFailures});
  }
}

/** Photograph something and attach it straight to a record that already exists. */
export async function addPhotoAttachment(db:SQLiteDatabase,ownerType:AttachmentOwner,ownerId:string,source:'camera'|'gallery'='camera'):Promise<Attachment[]>{
  if(!(await ownerExists(db,ownerType,ownerId)))throw new Error('Attachment owner does not exist');
  const staged=await stagePhoto(source);
  if(!staged.length)return [];
  return finalizeStagedAttachments(db,ownerType,ownerId,staged);
}

export async function discardStagedAttachments(items:StagedAttachment[]):Promise<void>{const cleanupFailures=await cleanupFiles(items.map(item=>item.uri));if(cleanupFailures)throw new Error('Attachment cleanup failed');}
export async function finalizeStagedAttachments(db:SQLiteDatabase,ownerType:AttachmentOwner,ownerId:string,items:StagedAttachment[]):Promise<Attachment[]>{if(!items.length)return [];if(!(await ownerExists(db,ownerType,ownerId)))throw new Error('Attachment owner does not exist');let persistedCount=0;try{await exclusiveTransaction(db, async()=>{for(const item of items){await db.runAsync('INSERT INTO attachments (id,owner_type,owner_id,name,mime_type,size,uri,created_at) VALUES (?,?,?,?,?,?,?,?)',item.id,ownerType,ownerId,item.name,item.mimeType,item.size,item.uri,item.createdAt);persistedCount+=1;}});return items.map(item=>({...item,ownerType,ownerId}));}catch{const cleanupFailures=await cleanupFiles(items.map(item=>item.uri));throw new AttachmentUploadError('Attachment database insertion failed',{selectedCount:items.length,copiedCount:items.length,persistedCount,rolledBackCount:items.length,cleanupFailures});}}
export async function addAttachments(db:SQLiteDatabase,ownerType:AttachmentOwner,ownerId:string):Promise<Attachment[]>{if(!(await ownerExists(db,ownerType,ownerId)))throw new Error('Attachment owner does not exist');const staged=await stageAttachments();if(!staged.length)return [];return finalizeStagedAttachments(db,ownerType,ownerId,staged)}
export async function removeAttachment(db:SQLiteDatabase,attachment:Attachment):Promise<boolean>{const result=await db.runAsync('DELETE FROM attachments WHERE id=?',attachment.id);if(result.changes>0){try{await deleteFile(attachment.uri)}catch{}return true}return false;}
export async function removeAttachmentsForOwner(db:SQLiteDatabase,ownerType:AttachmentOwner,ownerId:string):Promise<number>{const items=await listAttachments(db,ownerType,ownerId);if(!items.length)return 0;let changes=0;await exclusiveTransaction(db, async()=>{const result=await db.runAsync('DELETE FROM attachments WHERE owner_type=? AND owner_id=?',ownerType,ownerId);changes=result.changes;});await deleteAttachmentFiles(items);return changes;}
export function getAvailableAttachmentStorage():number{return Paths.availableDiskSpace;}
export async function shareAttachment(attachment:Attachment):Promise<void>{if(!(await Sharing.isAvailableAsync()))throw new Error('File sharing is unavailable on this device');await Sharing.shareAsync(attachment.uri,{mimeType:attachment.mimeType,dialogTitle:attachment.name});}
