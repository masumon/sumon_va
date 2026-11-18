# ০৭. পার্সোনাল মেমোরি, RAG ও তথ্য অনুসন্ধান অডিট (`Memory & RAG Audit`)

**অবস্থান:** `server/app/assistant/memory.py`, `extract.py`, `identity.py`, `names.py`, `f0.py`, `server/app/models/wa.py` (`WaNote`, `WaContact.profile`, `WaTask`)

---

## ১. পার্সোনাল মেমোরি (`Personal Memory`) স্থাপত্য ও যাচাই

| নিয়ম / বৈশিষ্ট্য | বাস্তব কোড ও প্রমাণ | স্ট্যাটাস |
|---|---|---|
| উৎস (`provenance`) আলাদা রাখা | `memory.add()`: `owner`, `ai`, `imported`, `platform`; AI অনুমান কখনো `high` হয় না (`medium`-এ সীমাবদ্ধ) | `PASS` |
| মালিকের তথ্য কখনো AI দিয়ে মোছা হয় না | `provenance != "owner"` এবং `f.get("provenance") == "owner"` হলে AI/ইমপোর্ট ফ্যাক্ট স্কিপ হয় | `PASS` |
| ডুপ্লিকেট রোধ ও সংশোধন ইতিহাস | `_norm(text)` দিয়ে ডুপ্লিকেট ঠেকায়; `memory.correct()` পুরোনো কথা `history`-তে রাখে, `remove()` স্থায়ীভাবে মুছে ফেলে | `PASS` |
| ব্যক্তিগত চ্যাটের মেমোরি এনক্রিপশন | `wa_assistant.py` ও আজকের `f0.py` (`remember`) উভয়ই `privacy.is_private(c)` হলে `enc1:` সিল করে রাখে | `PASS` |
| কথোপকথন থেকে স্বয়ংক্রিয় অনুমান | `extract.py` রুল-ভিত্তিকভাবে `"আমি ... থাকি"` ইত্যাদি থেকে `confidence="low"` ফ্যাক্ট তোলে (ব্যক্তিগত চ্যাট বাদে) | `PASS` |
| কমান্ড দিয়ে সরাসরি মেমোরি সেভ (`F0`) | আজকে যুক্ত: `"রহিম সম্পর্কে মনে রাখো ..."` → `owner`, `high`, পুনরাবৃত্তি রোধসহ (`test_f0_nlp_memory.py`) | `PASS` |

---

## ২. আজকের আপগ্রেড: ৪-উৎসের সার্চ ইঞ্জিন (`Multi-Source Search`)

- **আগের দুর্বলতা (`P1`):** `f0.py`-এর গ্লোবাল সার্চ (`খুঁজো ...`) কেবল `WaMessage.body` (যেখানে `status != "imported"`) খুঁজত। ফলে:
  - ভয়েস মেসেজের বাংলা ট্রান্সক্রিপ্ট (`WaMessage.transcript`) সার্চে আসত না।
  - ইমপোর্ট করা পুরোনো WhatsApp চ্যাট (`status == "imported"`) বাদ পড়ে যেত।
  - সংরক্ষিত মেমোরি ফ্যাক্ট (`WaContact.profile["facts"]`), মালিকের নোট (`WaNote`), ও খোলা কাজ (`WaTask`) সার্চে পাওয়া যেত না।
- **আজকের সমাধান (`f0._overview_intents`):** এখন `"খুঁজো <শব্দ>"` বা `"search <word>"` দিলে নিচের ৪টি উৎস থেকে একত্রে সর্বোচ্চ ১২টি ফলাফল আনে:
  1. **বার্তা, ভয়েস ট্রান্সক্রিপ্ট ও ইমপোর্ট ইতিহাস** (`WaMessage.body` অথবা `WaMessage.transcript`, ট্যাগ `· ভয়েস` / `· ইমপোর্ট`)
  2. **পার্সোনাল মেমোরি ফ্যাক্ট** (`WaContact.profile["facts"]`, ট্যাগ `স্মৃতি · <মানুষ>`)
  3. **সক্রিয় নোট** (`WaNote.is_active == True`, ট্যাগ `নোট · <মানুষ>`)
  4. **খোলা কাজ** (`WaTask.is_done == False`, ট্যাগ `কাজ · সময় ...`)
- **গোপনীয়তা সুরক্ষা (`PASS`):** চারটি উৎসেই `privacy.is_private(c)` (পরিবার ও ব্যক্তিগত চ্যাট) কঠোরভাবে বাদ রাখা হয়েছে, যা নতুন `test_f0_multisource_search_and_private_exclusion` টেস্টে প্রমাণিত (`PASS`)।

---

## ৩. Vector / Embedding RAG অবস্থা (`NOT IMPLEMENTED`)

> [!NOTE]
> **সৎ অবস্থান:** প্রজেক্টে বর্তমানে **Vector Embeddings (`pgvector`), Chunking, বা Semantic Similarity Search নেই (`NOT IMPLEMENTED`)**। `Supabase` `Sumon_va`-তেও ভেক্টর কলাম/টেবিল নেই। বর্তমান সার্চ হলো ক্রস-স্ক্রিপ্ট ফনেটিক নাম-ম্যাচিং + ৪-উৎসের `ILIKE`/substring অনুসন্ধান + `f0.ai_parse`।

**ভবিষ্যতে Vector RAG চাইলে নিরাপদ রোডম্যাপ (অনুমোদন সাপেক্ষে):**
1. **ভবিষ্যৎ SQL:** Supabase-এ `CREATE EXTENSION IF NOT EXISTS vector;` এবং একটি আলাদা `knowledge_chunks` টেবিল (শুধু নন-প্রাইভেট সারসংক্ষেপের জন্য; প্রাইভেট/পারিবারিক চ্যাট কখনো এমবেড হবে না)।
2. **উদ্ধৃতি (Citations):** প্রতিটি চাঙ্কে `source_type` (`message` | `fact` | `note` | `task`) ও `source_id` রাখা, যাতে উত্তর সবসময় প্রমাণসহ (`date` + `sender`) দেখায়।
3. **বর্তমান সুপারিশ:** ব্যক্তিগত একক-মালিকের ডেটার আকারে (কয়েকশ/কয়েক হাজার মেসেজ) আজকের ৪-উৎস মাল্টি-সার্চ + ফনেটিক নাম ম্যাচিং কম খরচে, শূন্য অতিরিক্ত ল্যাটেন্সিতে (`pgvector` ছাড়াই) প্রায় সব দৈনন্দিন প্রয়োজন মেটাতে সক্ষম।
