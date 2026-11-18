# ANDROID_DEVICE_TEST_REPORT.md — Sumon VA

**পরীক্ষিত ডিভাইস:** `10EDAX04RL0002X` (Vivo `V2317`, Android)  
**ইনস্টল করা বিল্ড:** `versionCode=46`, `versionName=1.0.0`, `lastUpdateTime=2026-11-19 02:01:46` (`25.20 MB`)  
**নোট:** `75737f3` / `fa392db`-এর ৫টি ভিজ্যুয়াল ফিক্স এই বিল্ডের পরে করা হয়েছে, তাই সেগুলো এখনো নতুন APK হিসেবে ফোনে ইনস্টল করা হয়নি।

## ১. ডিভাইসে সরাসরি পরীক্ষার ফল
- **অ্যাপ চালু ও মেমরি:** `am start -W` -> `TotalTime: 2336 ms` (`Status: ok`)। `PID 18888`, `logcat` (`ReactNativeJS:E`, `AndroidRuntime:E`)-এ **০টি ক্র্যাশ**।
- **ব্যাকগ্রাউন্ড সার্ভিস:**
  - `VaNotificationListener` (`c:android`) → **সক্রিয়**
  - `PollService` (`isForeground=true`, `channel=va_service`, সবুজ) → **সক্রিয়**
- **অনুমতিসমূহ (`dumpsys package` + `setup.tsx`):**
  - ফোনের `setup.tsx`-এ **`জরুরি ৬/৬ ✓ · মোট ১৩/১৩`**; সব গুরুত্বপূর্ণ রানটাইম অনুমতি (`READ_SMS`, `RECEIVE_SMS`, `SEND_SMS`, `READ_PHONE_STATE`, `READ_CALL_LOG`, `POST_NOTIFICATIONS`, `READ_CONTACTS`, `ACCESS_FINE_LOCATION`) **`granted=true`**।
- **১৬টি স্ক্রিন লাইভ ওয়াকথ্রু (`uiautomator dump`):**
  - `f0`, `inbox`, `rules`, `setup`, `more`, `channels`, `health`, `tasks`, `alerts`, `m/whatsapp`, `routine`, `scripts`, `simulate`, `report`, `settings`, `about` — সবগুলো সফলভাবে খুলেছে এবং বাস্তব ডেটা দেখিয়েছে।
- **বাকি লাইভ পরীক্ষা (নতুন APK ইনস্টলের পর করণীয়):**
  1. বাস্তব WhatsApp অ্যাপ থেকে `Share → সুমন সহকারী` দিয়ে ভয়েস ও ছবি পরীক্ষা।
  2. অন্য ফোন থেকে `"জরুরী"` লিখে মেসেজ পাঠিয়ে লক-স্ক্রিন অ্যালার্ম রিং যাচাই।
  3. স্ক্রিনশট আটকানো (`FLAG_SECURE`) ও অফলাইন→অনলাইন টেস্ট।
