# ০৯. অটোমেশন ও ব্যাকগ্রাউন্ড প্রসেসিং অডিট (`Automation & Background Processing Audit`)

**ব্যাকএন্ড উপাদান:** `server/app/core/scheduler.py`, `wa_flow.py`, `ai_hub.py`, `channels/alerts.py`, `channels/telegram.py`  
**অ্যান্ড্রয়েড উপাদান:** `PollService.kt`, `VaNotificationListener.kt`, `Receivers.kt` (`SmsReceiver`, `CallReceiver`, `BootReceiver`, `ReplyBoxes`), `Guard.kt` (`GuardAdmin`)

---

## ১. ব্যাকএন্ড অটোমেশন ও শিডিউলার (`scheduler.py`)

| অটোমেশন | সময়সূচি ও মেকানিজম | বাস্তব প্রমাণ ও অবস্থা |
|---|---|---|
| **মিনিটে-মিনিটে টিক (`va-scheduler`)** | `scheduler.py` (`INTERVAL_S = 60` সে.) অ্যাপ স্টার্টআপেই চলে; আলাদা external cron-job.org লাগে না | `PASS` (ফোনের লং-পোল Render ফ্রি সার্ভারকে জাগিয়ে রাখে) |
| **বার্তা জমানো (Grouping) ও অটো-ফ্লো** | `wa_flow.run_cron(db)` বিলম্বিত গ্রুপড উত্তর, স্টাক মেসেজ সুইপ ও মেয়াদোত্তীর্ণ "ব্যস্ত" স্ট্যাটাস পরিষ্কার করে | `PASS` (ডিফল্ট গ্রুপিং উইন্ডো ৫ মিনিট) |
| **দৈনিক AI সংযোগ সেল্ফ-টেস্ট** | `scheduler.py` প্রতিদিন ঢাকা সময় সকাল ৬টার পর একবার `ai_hub.daily_check()` ব্যাকগ্রাউন্ড টাস্কে চালায় | `PASS` |
| **Telegram বট (`@SumonVA_bot`)** | `telegram.py` মালিকের সাধারণ কথাকে `f0.run()` দিয়ে চালায়; `"✅ পাঠান / 🗑 পাঠাবেন না"` (`a:` / `x:`) ও `"কোন জন?"` (`p:`) ইনলাইন বোতাম দেয় | `PASS` (লাইভ webhook `403` সুরক্ষিত, ইউনিট টেস্ট পাস) |
| **জরুরি অ্যালার্ট ও Gmail সুরক্ষা** | অ্যালার্টের লিমিট/নীরব সময় `alerts.py` নিয়ন্ত্রণ করে; **গতকাল ফিক্স (`be55ffb`):** `notif:com.google.android.gm` (Gmail) এখন আর কখনো অটো-রিপ্লাই চেষ্টা করে ব্যর্থ হয় না | `PASS` |

---

## ২. অ্যান্ড্রয়েড ব্যাকগ্রাউন্ড ও নেটিভ লিসেনার (`10EDAX04RL0002X` বাস্তব যাচাই)

1. **`PollService` (`PollService.kt:37-107`):**
   - Android 14+ (API 34+) ডিভাইসে `FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING` ব্যবহার করে (`dataSync`-এর ৬-ঘণ্টার সিস্টেম সীমা এড়াতে)।
   - `NetworkCallback` (`watchNetwork()`) বসানো আছে, যাতে ইন্টারনেট ফিরলেই `wakeLock.notifyAll()` দিয়ে তাৎক্ষণিক সিঙ্ক শুরু হয়।
   - `GET /device/poll?wait=25` লং-পোলের মাঝের সংক্ষিপ্ত বিরতিতে ক্যাপড `Awake.hold()` (WakeLock) নেয়, যাতে স্ক্রিন বন্ধ থাকলেও জরুরি অ্যালার্ট দেরিতে না আসে।
   - **রিয়েল ফোন প্রমাণ (`10EDAX04RL0002X`):** `dumpsys` অনুযায়ী `PollService (foreground)` সক্রিয় ছিল এবং ১৯ ঘণ্টায় ব্যাটারি খরচ ছিল মাত্র **`81.1 mAh`** (`~১.৬%` প্রতি ৫০০০mAh ব্যাটারির)! (`PASS`)
2. **`VaNotificationListener` ও `ReplyBoxes` (`Receivers.kt:180-201`):**
   - অনুমোদিত চ্যাট অ্যাপের নোটিফিকেশন ধরে, পেন্ডিং `RemoteInput` রিপ্লাই-বক্স মেমোরিতে রাখে (সর্বোচ্চ ২০০ চ্যাট) যাতে মালিক অ্যাপ/বট থেকে উত্তর অনুমোদন করলে সঙ্গে সঙ্গে সেই চ্যাট অ্যাপের নোটিফিকেশন-ইনপুট দিয়ে পাঠানো যায়।
   - **রিয়েল ফোন প্রমাণ:** `VaNotificationListener` `ENABLED` ও সংযুক্ত ছিল। (`PASS`)
3. **`CallReceiver` (`Receivers.kt:223-260`):**
   - রিং-স্টেট `va_secure`-এ রাখে (প্রসেস মরে গেলেও যেন মিসড কল না হারায়), এবং `IDLE` হওয়ার পর প্রকৃত `CallLog.Calls.MISSED_TYPE` যাচাই করে (`PASS` — ডিক্লাইন করা কল বা জাল ব্রডকাস্ট বাদ পড়ে)।
4. **Android 13+ ভাইব্রেশন উন্নতি (`3f46df0`):**
   - `PollService.kt`-এ API 33+ এর জন্য `VibrationAttributes` (`USAGE_ALARM`) যোগ করা হয়েছে, যা নতুন APK-তে ফোনে পৌঁছাবে।

---

## ৩. চিহ্নিত সীমাবদ্ধতা ও সুপারিশ

- **ব্যাটারি অপ্টিমাইজেশন ও OEM কিল ঝুঁকি (`P2`):** Vivo (Funtouch OS) / Xiaomi ফোনে ব্যবহারকারী `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` অনুমোদন দিলেও কখনো কখনো ব্র্যান্ডের ব্যাকগ্রাউন্ড কিলার ঘুমিয়ে দিলে `PollService` থামতে পারে; `BootReceiver` রিবুট হলে সার্ভিস চালু করে, এবং `Setup` স্ক্রিনে ১-ট্যাপ `startService()` আছে (`PASS`)।
- **নতুন APK বিল্ড দরকার:** `3f46df0`-পরবর্তী কোড ও `PollService` আপডেট সোর্সে আছে, তবে বর্তমানে ফোনের ইনস্টলড বিল্ড (`02:42:18`)-এ `3f46df0` পর্যন্ত থাকলেও `be55ffb`/`af792e6`/`90e5ef3` ও আজকের আপডেট নেই।
