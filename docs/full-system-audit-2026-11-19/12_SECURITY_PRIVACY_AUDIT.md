# ১২. নিরাপত্তা ও ডেটা গোপনীয়তা অডিট (`Security & Privacy Audit`)

**অবস্থান:** `server/app/assistant/privacy.py`, `Core.kt`, `Receivers.kt`, `routes/_layout.tsx`, `src/ui/LockGate.tsx`, `src/backup/crypto.ts`, `AndroidManifest.xml`

---

## ১. যাচাইকৃত শক্তিশালী নিরাপত্তা নিয়ন্ত্রণসমূহ (`PASS`)

| নিরাপত্তা স্তর | বাস্তবায়ন ও ফাইল | যাচাই ফলাফল |
|---|---|---|
| **পারিবারিক/ব্যক্তিগত চ্যাট এনক্রিপশন** | `privacy.py`: Fernet `enc1:` (`SECRET_KEY` ভিত্তিক), `f0.py` (`remember`), `wa_assistant.py` | `PASS` (ডেটাবেজে প্লেইনটেক্সট থাকে না, `test_f0_nlp_memory.py` ও `test_wave0.py`) |
| **AI ডাটা লিক প্রতিরোধ** | `privacy.is_private()` চ্যাট AI-তে যায় না; `privacy.mask_secrets()` OTP/পিন মাস্ক করে; `ai_hub.py` শুধু HTTPS Custom AI অনুমোদন করে | `PASS` |
| **অ্যাপ-লক ও ব্রুট-ফোর্স সুরক্ষা** | `src/backup/crypto.ts` (`PBKDF2-HMAC-SHA256`, ২০k/১৫০k ইটারেশন, `expo-crypto` CSPRNG); `LockGate.tsx` (৫ বার ভুল চেষ্টায় ৩০সে → ১৫মি ব্রেক) | `PASS` (রিস্টার্টে ব্রেক রিসেট হয়—নিচে `P2`) |
| **স্ক্রিনশট ও রিসেন্ট-অ্যাপস প্রিভিউ ব্লক** | `routes/_layout.tsx:52-57` → নেটিভ `setSecure(block)` (`FLAG_SECURE`) + `expo-screen-capture` (QA বিল্ড `EXPO_PUBLIC_QA=1` ছাড়া সর্বদা চালু) | `PASS` |
| **ডিভাইস টোকেন ও Keystore বিচ্ছিন্নতা** | `Core.kt:21-45`: টোকেন Android Keystore-ব্যাকড `va_secure`-এ থাকে; JS কোড কখনো raw টোকেন পায় না | `PASS` |
| **অ্যান্ড্রয়েড অটো-ব্যাকআপ এক্সক্লুশন** | `backup_rules.xml` & `data_extraction_rules.xml` থেকে `va_secure.xml`, `appLock.xml`, `database` ও `attachments/` বাদ দেওয়া | `PASS` |
| **জাল মিসড-কল ও Telegram স্পুফ রোধ** | `Receivers.kt:250-260` `CallLog.Calls.MISSED_TYPE` মিলিয়ে নেয়; Telegram webhook সিক্রেট ছাড়া `403` দেয় | `PASS` |
| **Supabase ডাটাবেজ বিচ্ছিন্নতা** | সব ১৪টি টেবিলে **RLS ON (`0 policies`)** — পাবলিক Supabase Key দিয়ে সরাসরি কোনো ডেটা পড়া যায় না | `PASS` |
| **রিপোজিটরিতে গোপন চাবি (Secrets)** | গিট-এ কোনো `.env`, API Key বা Keystore কমিট নেই (`_private/` ইগনোর করা) | `PASS` |

---

## ২. চিহ্নিত নিরাপত্তা দুর্বলতা ও ঝুঁকি (`P2` / `P3`)

1. **`src/backup/crypto.ts:6` সরাসরি `package.json` ডিপেন্ডেন্সি না থাকা (`P2`):**  
   `import { sha256 } from 'js-sha256';` ট্রানজিটিভ `node_modules` থেকে কাজ করছে, কিন্তু `package.json`-এ `js-sha256` ডিক্লেয়ার করা নেই! কখনো `npm/pnpm` প্রুনিং বা লকফাইল আপডেট হলে বিল্ড বা টাইপ-চেক ভেঙে যেতে পারে।  
   - **সমাধান (অনুমতি সাপেক্ষে):** `package.json`-এ `"js-sha256"` যুক্ত করা অথবা Pure-TS/WebCrypto HMAC ব্যবহার করা।
2. **PIN Wrong-Try Brake কেবল ইন-মেমোরি (`LockGate.tsx:19`) [`P2`]:**  
   ৫ বার ভুল PIN দিলে ৩০ সেকেন্ড–১৫ মিনিট লক-টাইমার কেবল RAM-এ (`brake = { fails: 0, until: 0 }`) থাকে; কেউ অ্যাপ জোর করে বন্ধ (`Force Stop`) করে আবার খুললে চেষ্টা-সংখ্যা শূন্য হয়ে যায়। `SQLite` বা `va_secure`-এ টাইমস্ট্যাম্প রাখলে তা সম্পূর্ণ রোধ করা যাবে।
3. **`AndroidManifest.xml`-এ `allowBackup="true"` (`android/app/src/main/AndroidManifest.xml:20`) ও Exported `CallReceiver` [`P3`]:**  
   - `va_secure.xml` ও `appLock.xml` এক্সক্লুডেড হওয়ায় গোপন টোকেন গুগল ড্রাইভে যায় না, তবে সর্বোচ্চ হার্ডেনিংয়ের জন্য ব্যক্তিগত নিরাপত্তা অ্যাপে `allowBackup="false"` রাখা পরিচ্ছন্ন।
   - `CallReceiver` (`va-bridge` Manifest line 55)-এ `android:exported="true"` আছে সিস্টেম ব্রডকাস্টের জন্য—প্রকৃত ঝুঁকি কম কারণ `Receivers.kt:254` রিয়েল `CallLog` যাচাই ছাড়া কিছু আপলোড করে না।
4. **কোনো বাইরের সিঙ্ক বা ডেটা লিক চেক (`PASS`):**  
   `.github/workflows/db-backup.yml` অপসারিত হয়েছে (`0e197df`) এবং কোনো থার্ড-পার্টি অ্যানালিটিক্স বা ট্র্যাকার অ্যাপে নেই।
