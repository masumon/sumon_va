# PRIORITIZED_BUG_REGISTER.md — Sumon VA

## ১. এই অডিটে পাওয়া ও সমাধান করা/বাকি ইস্যু তালিকা

| ID | তীব্রতা | স্ক্রিন/মডিউল | সমস্যা | অবস্থা |
|---|---|---|---|---|
| **VA-01** | P1 | `server` + `f0` | Render-এ নতুন কোড Deploy ছিল না এবং ফোনে ভয়েস/ছবি পড়ার সুবিধা ছিল না | **FIXED** (`analyze-media` + `Share → সুমন সহকারী`, Render লাইভ `401`) |
| **VA-02** | P2 | `routes/health.tsx` | লোডিং শেষ হওয়ার আগেই `সব ঠিক আছে ✓` দেখাত | **FIXED in Code** (`75737f3`, নতুন APK বিল্ডের অপেক্ষায়) |
| **VA-03** | P2 | `routes/tasks.tsx` | লোডিংয়ের সময় `০ বাকি` কিন্তু `৫ দেরি` দেখাত | **FIXED in Code** (`75737f3`, নতুন APK বিল্ডের অপেক্ষায়) |
| **VA-04** | P3 | `AppHeader.tsx`, `about.tsx`, `simulate.tsx` | ব্যাজে ইংরেজি `9+`, `0.1.0`, ও শিরোনাম অমিল (`পরীক্ষা` বনাম `সহকারীকে পরখ করুন`) | **FIXED in Code** (`75737f3`, নতুন APK বিল্ডের অপেক্ষায়) |
| **VA-05** | P2 | `routes/inbox.tsx`, `contact.tsx`, `tasks.tsx` | তালিকাগুলোতে `FlatList`-এর বদলে `.map()` ব্যবহৃত হচ্ছে | **OPEN** (বড় তালিকার পারফরম্যান্স উন্নয়ন) |
| **VA-06** | P1 | `Supabase` + `Render` | অটোমেটিক দৈনিক DB ব্যাকআপ ও Render ঘুম ঠেকানোর বাইরের পিঙ্গার | **PARTIAL** (`.github/workflows/db-backup.yml` যোগ হয়েছে; GitHub Secret `BACKUP_DATABASE_URL` ও পিঙ্গার মালিক সেট করবেন) |
| **VA-07** | P2 | `server/app/models/models.py` | অব্যবহৃত ~৪৯টি ABO টেবিল ORM এখনো ফাইলে রয়ে গেছে | **OPEN** (টেকনিক্যাল ঋণ) |
| **VA-08** | P1 | ফোনে লক-স্ক্রিন অ্যালার্ম / `FLAG_SECURE` | বাস্তব অন্য ফোন থেকে `"জরুরী"` মেসেজ ও স্ক্রিনশট ব্লক লাইভ পরীক্ষা বাকি | **NOT TESTED LIVE** |
