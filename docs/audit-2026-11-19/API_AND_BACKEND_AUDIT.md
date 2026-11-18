# API_AND_BACKEND_AUDIT.md — Sumon VA

## ১. ব্যাকএন্ড ও এপিআই যাচাই (`server/`)
- **লাইভ সার্ভার প্রোব (`https://va-api.aboenterprise.com`):**
  - `GET /health` → `HTTP 200` (`Sumon VA API`)
  - `GET /health/db` → `HTTP 200` (`database: connected`)
  - `POST /api/v1/admin/wa/analyze-media` → `HTTP 401` (নতুন রুট Render-এ লাইভ ও ডিভাইস/মালিক অথ-সুরক্ষিত)
  - `POST /api/v1/telegram/webhook` → `HTTP 403` (সিক্রেট ছাড়া ব্লকড)
- **অটোমেটেড টেস্ট (`pytest`):**
  - সর্বশেষ `main` (`fa392db`)-এ `cd server; python -m pytest -q` → **৪৪২টি টেস্ট পাস, ০টি ফেল** (`9.47s`)।
- **ব্রেইন ও নিরাপত্তা লজিক:**
  - ৪-স্তরের নিরাপত্তা: মাস্টার সুইচ (`enabled`) → গ্লোবাল মোড (`auto`/`shadow`) → প্ল্যাটফর্ম/ক্যাটাগরি সুইচ → কন্টাক্ট (`is_family`, `personal`, `is_blocked`, এবং `obligations.py` দাপ্তরিক নোটিশ কখনোই অটো-উত্তর পায় না)।
  - `f0.py`-এ ঢাকা সময় (`%I:%M %p`) ও বন্ধুভাবাপন্ন `FRIENDLY_HELP` যুক্ত এবং `wa_brain.py` ও `promo.py` উন্নত।
- **বাকি সীমা:** Render ফ্রি প্ল্যান ১৫ মিনিট নিষ্ক্রিয় থাকলে ঘুমিয়ে পড়ে (ফোনের `PollService` চালু থাকলে জেগে থাকে, তবে ফোনের নেট বন্ধ থাকলে বাইরের পিঙ্গার নেই)।
