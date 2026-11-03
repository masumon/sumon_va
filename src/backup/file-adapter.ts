import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { strFromU8 } from 'fflate';
import type { M7BackupDocument } from './m7-format';
import { parseM7BackupDocument } from './m7-format';
import { base64ToBytes, bytesToBase64 } from '../services/backup-archive-service';
import { isEncryptedArchive } from './crypto';
const BACKUP_MIME='application/json';
const ARCHIVE_MIME='application/zip';
const ENCRYPTED_MIME='application/octet-stream';
const BACKUP_PREFIX='apon-backup-';
const ARCHIVE_PREFIX='apon-backup-';
export async function writeBackupFile(document:M7BackupDocument):Promise<string>{const filename=`${BACKUP_PREFIX}${document.createdAt.replace(/[:.]/g,'-')}.json`;const file=new File(Paths.document,filename);file.create({intermediates:true,overwrite:true});file.write(JSON.stringify(document,null,2));return file.uri}
export async function writeBackupArchiveFile(bytes:Uint8Array,createdAt:string,encrypted=false):Promise<string>{const ext=encrypted?'ombak':'zip';const filename=`${ARCHIVE_PREFIX}${createdAt.replace(/[:.]/g,'-')}.${ext}`;const file=new File(Paths.document,filename);file.create({intermediates:true,overwrite:true});file.write(bytes);return file.uri}
export async function shareBackupFile(uri:string):Promise<void>{if(!(await Sharing.isAvailableAsync()))throw new Error('File sharing is unavailable on this device');await Sharing.shareAsync(uri,{mimeType:BACKUP_MIME,dialogTitle:'Share Apon backup'})}
export async function shareBackupArchiveFile(uri:string,encrypted=false):Promise<void>{if(!(await Sharing.isAvailableAsync()))throw new Error('File sharing is unavailable on this device');await Sharing.shareAsync(uri,{mimeType:encrypted?ENCRYPTED_MIME:ARCHIVE_MIME,dialogTitle:'Share Apon backup archive'})}
export type PickedBackup={kind:'json';document:M7BackupDocument}|{kind:'archive';bytes:Uint8Array}|{kind:'encrypted';bytes:Uint8Array};
export async function pickBackupBundle():Promise<PickedBackup|null>{const result=await DocumentPicker.getDocumentAsync({type:[BACKUP_MIME,ARCHIVE_MIME,ENCRYPTED_MIME,'text/json','*/*'],copyToCacheDirectory:true,multiple:false});if(result.canceled)return null;const uri=result.assets[0]?.uri;if(!uri)throw new Error('Selected backup file has no URI');const bytes=base64ToBytes(await new File(uri).base64());if(isEncryptedArchive(bytes))return{kind:'encrypted',bytes};if(bytes.length>=2&&bytes[0]===0x50&&bytes[1]===0x4b)return{kind:'archive',bytes};let document:M7BackupDocument;try{document=parseM7BackupDocument(JSON.parse(strFromU8(bytes)))}catch(error){throw new Error(error instanceof Error?`Invalid backup file: ${error.message}`:'Invalid backup file')}return{kind:'json',document}}
export async function pickBackupFile():Promise<M7BackupDocument|null>{const picked=await pickBackupBundle();return picked?.kind==='json'?picked.document:null}
export function encodeSelectedBackup(bytes:Uint8Array):string{return bytesToBase64(bytes)}
