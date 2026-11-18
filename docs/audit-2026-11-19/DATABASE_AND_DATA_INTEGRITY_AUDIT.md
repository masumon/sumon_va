# DATABASE_AND_DATA_INTEGRITY_AUDIT.md — Sumon VA

## ১. ডাটাবেজ কাঠামো ও নিরাপত্তা (`server/manual_sql/` ও `SUMON_VA_SYSTEM_KNOWLEDGE.md`)
- **ডাটাবেজ:** Supabase Postgres (`Sumon_va`), ১৪টি টেবিল (`0001_sumon_va_schema.sql`), সাথে `0002_contact_person_link.sql` (`wa_contacts.person_id`) ও `0003_task_details.sql` (`wa_tasks`-এ ৭টি nullable কলাম)।
- **Row Level Security (RLS):** সব ১৪টি টেবিলে `RLS ON` এবং `0 policies` (সরাসরি পাবলিক অ্যাক্সেস সম্পূর্ণ বন্ধ, শুধু সার্ভারের direct DB role পড়তে/লিখতে পারে)।
- **সংবেদনশীল তথ্য সুরক্ষা:** ব্যক্তিগত চ্যাট `enc1:` দিয়ে সিল করা থাকে (`privacy.py`); AI কীগুলো `SECRET_KEY`-ভিত্তিক Fernet এনক্রিপশনে `settings` টেবিলে থাকে; OTP/নম্বর/ইমেইল AI-এর আগে মাস্ক হয়।
- **ডাটা অখণ্ডতা (Integrity):**
  - `server/app/models/models.py`-এ পুরোনো ABO দোকানের ~৪৯টি ORM ক্লাস এখনো রয়ে গেছে (যা `Sumon_va` ডাটাবেজে নেই)—ভুল করে কোনো কোডে import করলে runtime error হতে পারে (`P2` টেকনিক্যাল ঋণ)।
  - Supabase ফ্রি প্ল্যানে **স্বয়ংক্রিয় দৈনিক ব্যাকআপ নেই** (`P1` অপারেশনাল ঝুঁকি—মালিকের হাতে ব্যাকআপ আছে, GitHub Actions অটো-ব্যাকআপ এখনো বাকি)।
- **ফোন লোকাল স্টোরেজ:**
  - ডিভাইস টোকেন `Android Keystore`-ভিত্তিক `EncryptedSharedPreferences`-এ (`va_secure.xml`) সংরক্ষিত; `data_extraction_rules.xml` ও `backup_rules.xml`-এ ক্লাউড ব্যাকআপ থেকে বাদ দেওয়া আছে।
