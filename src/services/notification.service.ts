import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
const TASK_CHANNEL_ID='task-reminders';
// The navy the logo is actually drawn on, sampled from the brand file. This was a green
// left over from an older design: every reminder landed in the shade tinted a colour that
// appears nowhere else in the app, right beside a launcher icon that is navy and gold.
// The name is kept so nothing downstream has to be renamed for a colour change.
const BRAND_GREEN='#0C3C85';
if(typeof Notifications.setNotificationHandler==='function'){Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false})});}
export async function initializeNotifications():Promise<void>{if(Platform.OS!=='android')return;try{await Notifications.setNotificationChannelAsync(TASK_CHANNEL_ID,{name:'Task reminders · টাস্ক রিমাইন্ডার',description:'Apon task reminders · Apon টাস্ক রিমাইন্ডার',importance:Notifications.AndroidImportance.HIGH,vibrationPattern:[0,250,250,250],lockscreenVisibility:Notifications.AndroidNotificationVisibility.PUBLIC,enableVibrate:true,showBadge:true});}catch{}}
/**
 * Whether notifications are allowed.
 *
 * Checks only — it never shows the system dialog. Asking belongs to the permissions
 * screen, where the reason is on the page beside the button; a dialog raised by a
 * background sync arrives with no explanation and is simply denied.
 */
export async function hasNotificationPermission():Promise<boolean>{try{const current=await Notifications.getPermissionsAsync();return current.granted;}catch{return false;}}


export { TASK_CHANNEL_ID, BRAND_GREEN };
