# ০৬. NLP ও বাংলা/বাংলিশ ভাষা বোঝার অডিট (`NLP & Bangla Audit`)

**মূল ফাইল:** `server/app/assistant/f0.py`, `server/app/assistant/names.py`, `server/app/assistant/wa_brain.py`, `server/app/assistant/promises.py`, `server/app/assistant/obligations.py`, `server/app/assistant/promo.py`

---

## ১. বাস্তব বেঞ্চমার্ক: আজকের ফিক্সের আগে বনাম পরে (১৯ নমুনা পরীক্ষা)

| # | ইউজারের কমান্ড (বাংলা / বাংলিশ / ইংরেজি) | আগের ফলাফল (`90e5ef3`) | আজকের ফলাফল (২০২৬-১১-১৯) |
|---|---|---|---|
| ১ | `রহিমকে বলো কাল আসব` | `reply` (`PASS`) | `reply` (`PASS`) |
| ২ | `rahim ke bolo kal asbo` | `unknown` (`FAIL` — AI ছাড়া পারত না) | **`reply`** (`name="rahim"`, `msg="kal asbo"`) — `PASS` |
| ৩ | `জরুরি কি আছে` | `alerts` (`PASS`) | `alerts` (`PASS`) |
| ৪ | **`জরুরী কি আছে`** (দীর্ঘ ঈ-কার বানান) | `unknown` (`FAIL`) | **`alerts`** — `PASS` |
| ৫ | `কার উত্তর বাকি` | `pending` (`PASS`) | `pending` (`PASS`) |
| ৬ | `kar uttor baki` | `unknown` (`FAIL`) | **`pending`** — `PASS` |
| ৭ | `আমার কাজ কী` | `tasks` (`PASS`) | `tasks` (`PASS`) |
| ৮ | `amar kaj ki` | `unknown` (`FAIL`) | **`tasks`** — `PASS` |
| ৯ | `খসড়া দেখাও` | `drafts` (`PASS`) | `drafts` (`PASS`) |
| ১০ | `khosra dekhao` | `unknown` (`FAIL`) | **`drafts`** — `PASS` |
| ১১ | `মিসড কল কে দিয়েছে` | `missed_calls` (`PASS`) | `missed_calls` (`PASS`) |
| ১২ | `missed call ke diyeche` | `missed_calls` (`PASS`) | `missed_calls` (`PASS`) |
| ১৩ | `রহিম সম্পর্কে মনে রাখো সে মিরপুরে থাকে` | `unknown` (`FAIL` — লেখার কমান্ড ছিল না) | **`remember`** (`name="রহিম"`, `msg="সে মিরপুরে থাকে"`) — `PASS` |
| ১৪ | `কাজ যোগ করো কাল রহিমকে ফোন দিতে হবে` | `unknown` (`FAIL`) | **`add_task`** (আগামীকালের তারিখসহ টাস্ক তৈরি) — `PASS` |
| ১৫ | `মনে করিয়ে দিও কাল বিকালে মিটিং` | `unknown` (`FAIL`) | **`add_task`** (কাল বিকাল ৪:০০ টাস্ক তৈরি) — `PASS` |
| ১৬ | `খুঁজে দাও টাকা` | `unknown` (`FAIL`) | **`search`** (`msg="টাকা"`) — `PASS` |
| ১৭ | `সহকারীর অবস্থা কী` | `system` (`PASS`) | `system` (`PASS`) |
| ১৮ | `sohokarir obostha ki` | `unknown` (`FAIL`) | **`system`** — `PASS` |
| ১৯ | `টাকা নিয়ে কে কী বলেছে` | `unknown` (AI-তে যায়) | `unknown` (`f0.ai_parse` এ যায় — ওপেন-এন্ডেড প্রশ্ন) |

**বেঞ্চমার্কের সারসংক্ষেপ:** রুল-ভিত্তিক NLP বোঝার ক্ষমতা **৮/১৯ (`৪২.১%`)** থেকে বেড়ে **১৮/১৯ (`৯৪.৭%`)** হয়েছে (AI সংযোগ বা ইন্টারনেট ছাড়াই)।

---

## ২. ক্রস-স্ক্রিপ্ট নাম মিলানো (`names.py` + `f0.resolve()`)

- **যাচাইকৃত `names.py` আচরণ:**
  - `names.name_key("রহিম")` → `"rahim"` এবং `names.name_key("Rohim")` → `"rahim"` → `similar == True`।
  - `names.name_key("রহীম ভাই")` → `"rahim"` (সন্মানসূচক `"ভাই"` বাদ) → `similar(..., "Rahim") == True`।
  - কিন্তু `"Md Abdur Rahim"` → key `"abdurrahim"` হওয়ার কারণে `similar("রহিম", "Md Abdur Rahim")` আসত `False`!
- **আজকের সার্জিক্যাল ফিক্স (`f0.py` `resolve()` + `_fuzzy_match()`):**
  - প্রথমে `WaContact.name.ilike(f"%{name}%")` চলে; না পেলে ৫০০ কন্ট্যাক্টের ওপর ফনেটিক, **ওয়ার্ড-টোকেন (`"Abdur Rahim"` এর `"Rahim"` বনাম `"রহিম"`)**, **মালিকের লেখা alias (`profile.aliases`)**, এবং **ফোন নম্বরের শেষের অঙ্ক** মিলিয়ে মানুষ খোঁজে।
  - একাধিক মানুষ মিললে (`Md Abdur Rahim` + `Rahim Mia`) নিরাপদে `choices` ফেরত দেয় এবং কোনো খসড়া বানায় না (`PASS`, `test_f0_nlp_memory.py`-তে প্রমাণিত)।

---

## ৩. বাংলা আস্থা-লেবেল ও বাংলা অঙ্ক

- `f0.py` `_reply()` আগে শুধু `answer`-এ `brain.bn_digits()` চালাত, `items[].subtitle`-এ ইংরেজি অঙ্ক (`2টি অপঠিত`, `1টি মিসড কল`) রয়ে যেত। এখন `subtitle`-ও বাংলা অঙ্কে রূপান্তরিত হয় (`২টি অপঠিত`, `১টি মিসড কল`)।
- `"আম্মু সম্পর্কে কী জানো"` উত্তরে আগে `"আস্থা high"` দেখাত; এখন `_CONF_BN` ব্যবহার করে **`"আস্থা নিশ্চিত"` / `"মাঝারি"` / `"কম"`** দেখায় (`PASS`)।
- `promises.detect_promise()`: `"শুক্রবার টাকা পাঠাব"` সঠিকভাবে ধরে (`kind="money"`, `due_at=2026-11-20 10:00+06:00`), তবে `"কাল রহিমকে ফোন দিতে হবে"`-এর মতো `"হবে"` বাধ্যবাধকতা আউটগোয়িং প্রতিশ্রুতি হিসেবে ধরে না (`P2`)।
