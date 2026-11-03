// Opens one saved file full screen — where a "report downloaded" notification leads
// (src/services/download-notification.ts). The same viewer every other screen uses, so a
// PDF reads page by page with zoom, and Share sends it on.

import { useEffect } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { MediaViewer } from '../src/ui/MediaViewer';
import { useAppPreferences } from '../src/app/AppPreferences';

export default function FileViewScreen() {
  const { colors } = useAppPreferences();
  const params = useLocalSearchParams<{ uri?: string; name?: string; mimeType?: string }>();
  const uri = typeof params.uri === 'string' ? params.uri : '';
  const name = typeof params.name === 'string' ? params.name : '';
  const mimeType = typeof params.mimeType === 'string' ? params.mimeType : 'application/pdf';
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  // A notification for a file that no longer names one: nothing to show, go back.
  useEffect(() => { if (!uri) close(); }, [uri]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <MediaViewer
        item={uri ? { uri, name, mimeType } : null}
        onClose={close}
        onShare={(item) => { void Sharing.shareAsync(item.uri, { mimeType: item.mimeType, dialogTitle: item.name }).catch(() => undefined); }}
      />
    </View>
  );
}
