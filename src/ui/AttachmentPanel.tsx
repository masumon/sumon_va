import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { getContentUriAsync } from 'expo-file-system/legacy';
import { useSQLiteContext } from 'expo-sqlite';
import { AppState } from './AppSurface';
import { useAppFeedback } from './AppFeedback';
import { useAppPreferences } from '../app/AppPreferences';
import { attachmentCopy } from '../i18n/attachments';
import { listAttachments, removeAttachment, shareAttachment, type Attachment, type AttachmentOwner } from '../services/attachment-service';
import { addFrom, type AttachSource } from '../services/attachment-sources';
import { FileGallery } from './FileGallery';

/** A saved record's photos and files — loaded, added and removed here, drawn by FileGallery. */
export function AttachmentPanel({ ownerType, ownerId, title, hint }: { ownerType: AttachmentOwner; ownerId: string; title?: string; hint?: string }) {
  const db = useSQLiteContext();
  const { language } = useAppPreferences();
  const copy = attachmentCopy(language);
  const { showSnackbar } = useAppFeedback();
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems(await listAttachments(db, ownerType, ownerId)); setError(null); } catch { setError(copy.loadError); }
  }, [copy.loadError, db, ownerId, ownerType]);
  useEffect(() => {
    let active = true;
    void listAttachments(db, ownerType, ownerId)
      .then((value) => { if (active) { setItems(value); setError(null); } })
      .catch(() => { if (active) setError(copy.loadError); });
    return () => { active = false; };
  }, [copy.loadError, db, ownerId, ownerType]);

  const add = async (source: AttachSource) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const added = await addFrom(db, ownerType, ownerId, source);
      if (added.length) { setItems((current) => [...added, ...current]); showSnackbar(copy.added(added.length), 'success'); }
    } catch { showSnackbar(copy.addError, 'danger'); } finally { setBusy(false); }
  };
  const remove = async (item: Attachment) => {
    setBusy(true);
    try {
      if (await removeAttachment(db, item)) { setItems((current) => current.filter((value) => value.id !== item.id)); showSnackbar(copy.removed, 'success'); }
    } catch { showSnackbar(copy.removeError, 'danger'); } finally { setBusy(false); }
  };
  const share = async (item: Attachment) => { try { await shareAttachment(item); } catch { showSnackbar(copy.shareError, 'danger'); } };
  // A file the app cannot show itself goes to whichever app on the phone can.
  const openOther = async (item: Attachment) => {
    try {
      if (Platform.OS === 'android' && item.uri.startsWith('file://')) {
        const contentUri = await getContentUriAsync(item.uri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, flags: 1, type: item.mimeType || undefined });
        return;
      }
      await Linking.openURL(item.uri);
    } catch { await share(item); }
  };
  const byId = (g: { id: string }) => items.find((x) => x.id === g.id);

  return (
    <View>
      <FileGallery
        items={items}
        busy={busy}
        title={title}
        hint={hint}
        onPick={(source) => void add(source)}
        onShare={(g) => { const it = byId(g); if (it) void share(it); }}
        onRemove={(g) => { const it = byId(g); if (it) void remove(it); }}
        onOpenOther={(g) => { const it = byId(g); if (it) void openOther(it); }}
      />
      {error ? <AppState title={copy.problem} description={error} icon="alert-circle-outline" actionLabel={copy.retry} onAction={() => void load()} /> : null}
    </View>
  );
}
