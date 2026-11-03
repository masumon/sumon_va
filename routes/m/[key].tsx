import { useLocalSearchParams } from 'expo-router';
import { AppState } from '../../src/ui/AppSurface';
import { ModuleScreen } from '../../src/va/ModuleScreen';
import { moduleByKey } from '../../src/va/modules';

/** /m/whatsapp, /m/messenger, /m/telegram, /m/sms … — one screen component, one module definition per route. */
export default function ModuleRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const mod = moduleByKey(String(key));
  return mod ? <ModuleScreen mod={mod} /> : <AppState icon="help-circle-outline" title="—" />;
}
