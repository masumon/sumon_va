# PERFORMANCE_AUDIT.md — Sumon VA

## ১. পরিমাপকৃত পারফরম্যান্স (মাপা প্রমাণ)
- **APK সাইজ (`dist\sumon-va-arm64.apk`):** `25.20 MB` (শুধু `arm64-v8a` ABI)।
- **অ্যাপ চালু হওয়ার সময় (`10EDAX04RL0002X`, `am start -W`):** `TotalTime: 2336 ms` (`WaitTime: 2364 ms`, `LaunchState: WARM`)।
- **সার্ভার টেস্ট স্যুইট (`pytest`):** `442 passed` in `9.47s`।
- **কোড-লেভেল পারফরম্যান্স পর্যবেক্ষণ:**
  - `routes/index.tsx` (হোম) মাউন্টে ৭টি সমান্তরাল API কল করে (`overview`, `family`, `urgent`, `work`, `biz`, `tasks`, `cfg`)। ফ্রি Render সার্ভারে ঘুম ভাঙার সময় প্রথম লোড ধীর হতে পারে (`P2`)।
  - `routes/inbox.tsx`, `routes/alerts.tsx`, `routes/tasks.tsx`, `routes/contact.tsx` এখনো `FlatList`-এর বদলে `ScrollView` + `.map()` ব্যবহার করে—হাজারের বেশি আইটেম হলে রেন্ডার ভারী হতে পারে (`P2`)।
  - `AppHeader.tsx` অ্যানিমেশন `AppState !== 'active'` ও `reduceMotion` অবস্থায় থামিয়ে দেয়, যা ব্যাটারি বাঁচায়।
