import type { ReactElement } from 'react';
import { Appearance } from 'react-native';
import { openDatabaseAsync } from 'expo-sqlite';
import { SEPARATE_CONNECTION } from '../services/db-connection';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { QuickAddWidget, type QuickAddWidgetProps } from './QuickAddWidget';

// Headless entry point for the home-screen widget. Android calls this when a widget is
// added, refreshed or resized; we just re-render the layout. Clicks use the library's
// built-in OPEN_URI action and never reach here.

const WIDGETS: Record<string, (props: QuickAddWidgetProps) => ReactElement> = {
  QuickAdd: QuickAddWidget,
};

/**
 * There is no React tree here — no `AppPreferences` context — so the widget's own colors
 * and language used to be hardcoded, and stayed navy-and-Bengali no matter what the app
 * itself was set to (F-096). The preferences live in the same SQLite file the app writes
 * to (`app_preferences`, a plain key/value table — see `AppPreferences.tsx`), and that file
 * is just as reachable from this headless context, so this reads the same two keys the app
 * would and falls back to the app's own defaults (Bengali, light) if the database or the
 * rows are not there yet.
 */
async function readPreferences(): Promise<QuickAddWidgetProps> {
  // Its own connection, closed when done: the old shared, never-closed one was left for
  // GC, and collecting it closed the app's live connection (NF-06, see db-connection.ts).
  let db: Awaited<ReturnType<typeof openDatabaseAsync>> | undefined;
  try {
    db = await openDatabaseAsync('offline-memory.db', SEPARATE_CONNECTION);
    const rows = await db.getAllAsync<{ key: string; value: string }>(
      "SELECT key, value FROM app_preferences WHERE key IN ('language', 'themeMode')",
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const language = byKey.language === 'en' ? 'en' : 'bn';
    const themeMode = byKey.themeMode;
    const dark = themeMode === 'dark' || (themeMode !== 'light' && Appearance.getColorScheme() === 'dark');
    return { language, dark };
  } catch {
    // A widget added before the app has ever run has no database yet — the app's own
    // defaults (Bengali, light) are the correct fallback, not a broken-looking widget.
    return { language: 'bn', dark: false };
  } finally {
    await db?.closeAsync().catch(() => {});
  }
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const Widget = WIDGETS[props.widgetInfo.widgetName];
  if (!Widget) return;
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(<Widget {...(await readPreferences())} />);
      break;
    default:
      break;
  }
}
