# ACCESSIBILITY_AUDIT.md — Sumon VA

## ১. মূল্যায়ন (WCAG 2.2 ও Android TalkBack মানদণ্ড)
- **টাচ টার্গেট (`>= 48dp`):**
  - `AppHeader.tsx` সব বোতাম (`48×48dp`), `PrimaryNav.tsx` ট্যাব, `ChipHit` (`48dp`), `Drawer.tsx` pill (`48dp` ফিক্সড), `InfoHint.tsx` (`44dp` + `hitSlop: 4` = `52dp` ফিক্সড), `inbox.tsx` সক্রিয় ফিল্টার চিপ (`48dp` ফিক্সড)। -> **PASS**।
- **বাংলা ফন্ট ও পঠনযোগ্যতা:**
  - `Noto Sans Bengali` (ওজন 400–700, `src/theme/index.ts`) এবং `Inter` সংখ্যায় ব্যবহৃত।
  - `AppHeader.tsx`-এর `9+` ব্যাজ ও `about.tsx`-এর সংস্করণ সংখ্যা `75737f3` কমিটে বাংলা অঙ্কে (`৯+`, `০.১.০`) ফিক্স করা হয়েছে।
- **স্ক্রিন রিডার ও TalkBack:**
  - `AppHeader.tsx`, `PrimaryNav.tsx`, `f0.tsx`, `setup.tsx`, `tasks.tsx`, `alerts.tsx`-এ বাংলা `accessibilityLabel` ও `accessibilityRole` দেওয়া আছে (ফোনের `uiautomator dump`-এ সব `content-desc` পাওয়া গেছে)।
- **রঙ ও কনট্রাস্ট:**
  - `lightColors`, `darkColors`, `dimColors` (`src/theme/index.ts`) WCAG AA >= 4.5:1 মেনে তৈরি। `reduceMotion` সম্মান করে অ্যানিমেশন থামানো হয় (`AppHeader.tsx`)।
- **সীমাবদ্ধতা:**
  - TalkBack চালু করে ফোনে প্রতিটি স্ক্রিনে সোয়াইপ টেস্ট ও `1.5x` সিস্টেম ফন্ট স্কেল টেস্ট এই সেশনে চালানো হয়নি (`NOT TESTED LIVE`)।
