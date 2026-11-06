# TRANSFER.md — ABO থেকে Sumon VA আলাদা করার কাজের তালিকা (জীবন্ত ফাইল)

> এই ফাইল দেখে আমরা দুজন (সুমন + Claude) কাজ করি। বিস্তারিত পরিকল্পনা: `docs/SERVER_SEPARATION_MASTER_PLAN.md`. ক্রম, ঝুঁকি, rollback সেখানে।
> **আপডেটের নিয়ম:** সুমন বললে "আমার কাজ শেষ" → Claude তার ধাপ `[x]` করে তারিখ বসায়। Claude নিজের কাজ শেষ করলে নিজেই আপডেট করে। কোনো ধাপ আন্দাজে `[x]` হবে না: যাচাই করা হলে তবেই।
> **কোনো secret (পাসওয়ার্ড, token, DB লিংক, API key) এই ফাইলে বা চ্যাটে নয়।** শুধু নাম লেখা থাকে; মান বসে সরাসরি Render এ।

Last updated: 2026-11-06 (সার্ভার ও অ্যাপ নতুন ঠিকানায় চলছে; ফোনে Telegram সাইন-ইন সফল; বাকি: merge+deploy, পরের বিল্ড, আসল পরীক্ষা, ABO এজেন্টের কাজ, প্রজেক্ট নিয়ম ফাইনাল)

## ১. লক্ষ্য (এক লাইনে)
ABO এর ওয়েবসাইট, অ্যাডমিন, WhatsApp assistant যেমন আছে তেমন থাকবে। Sumon VA পাবে নিজের GitHub repo, নিজের Render, নিজের Supabase, নিজের Telegram বট, নিজের ইমেইল পথ, নিজের ঠিকানা `va-api.aboenterprise.com`। ABO এর ডাটাবেসে সে সরাসরি ঢুকবে না।

## ২. সিদ্ধান্ত যা হয়ে গেছে
| বিষয় | সিদ্ধান্ত | কে বলেছেন |
|---|---|---|
| GitHub | আলাদা repo `masumon/sumon_va` (আছে) | সুমন |
| Render | আলাদা workspace/অ্যাকাউন্ট (সুমনের আছে) | সুমন |
| Supabase | আলাদা নতুন ফ্রি প্রজেক্ট `sumon-va` | সুমন |
| Brain (AI, নিয়ম, টাস্ক) | সব কপি হবে, নতুন সার্ভারে চলবে | সুমন |
| Telegram | নতুন আলাদা বট | সুমন |
| সাবডোমেইন | `va-api.aboenterprise.com` | সুমন |
| ব্যবসায়িক সংখ্যা (অর্ডার, বুকিং, লিড, চাকরির আবেদন) | ABO তে ছোট শুধু-পড়ার API (ডিফল্টে বন্ধ, টোকেন দিলে চালু); শুধু ABO এর এই ৪ সংখ্যা, আর কিছু নয় | সুমন |
| সাইন-ইন | ইমেইল কোড লাগবে না। শুধু Google passkey + Telegram বট (@SumonVA_bot) + pairing কোড। তাই Resend key (S4) বাদ | সুমন 2026-11-06 |
| ডিভাইস জোড়া (pair) | মূল ABO ওয়েবসাইটের অ্যাডমিনে "সুমন VA" ট্যাব থেকে; ABO সার্ভার নতুন Sumon VA সার্ভারকে সার্ভিস টোকেনে ডাকবে | সুমন 2026-11-06 |
| ইমেইল আসা (ইনবক্স) | Cloudflare Email Routing + Worker (নিচে §৫) | সুমন |

## ৩. এখনো খোলা প্রশ্ন (উত্তর লাগবে)
- [x] **Q1 (সুমন) 2026-11-06: `admin@sumon.com`** (শুধু অ্যাকাউন্টের পরিচয়, কোড যাবে না; `ADMIN_EMAIL` এ বসবে): নতুন সার্ভারে মালিকের অ্যাকাউন্টের ইমেইল কোনটা? (এখন শুধু অ্যাকাউন্টের পরিচয় ও passkey এর মালিক; কোড পাঠানো হবে না; পাসওয়ার্ড নয়)
- [ ] **Q2 (সুমন):** Cloudflare এ ইনবক্সের জন্য নতুন ঠিকানা কী হবে? (যেমন `inbox@` বা `sumon@aboenterprise.com`; ABO এর বর্তমান ঠিকানা ছোঁয়া হবে না)
- [ ] **Q3 (সুমন):** Cloudflare Dashboard এ Worker `abo-mail-to-inbox` → "Edit code" থেকে কোডটা পেস্ট করুন (এতে secret নেই; secret আলাদা binding)। এটা কপি করে নতুন Worker বানাব।
- [ ] **Q4 (Claude):** ABO main এ release branch `feature/sumon-va-release-2026-11-06` merge হয়েছে কিনা `gh` দিয়ে দেখা।
- [x] **Q5 (Claude) 2026-11-06:** `privacy.seal` (enc1:), AI-hub কী (`ai_hub_connections`), `wa_secrets_enc` সব Fernet, চাবি `SECRET_KEY` থেকে (`totp_crypto.py`)। তাই পুরোনো ডেটা কপির সময় ABO এর পুরোনো `SECRET_KEY` দিয়ে খুলে নতুন `SECRET_KEY` দিয়ে আবার এনক্রিপ্ট করতে হবে (C9; স্ক্রিপ্ট সুমনের পিসিতে চলবে; দুই চাবি কখনো চ্যাটে নয়)। নতুন সার্ভারে ABO এর `SECRET_KEY` বসানো হবে না (আলাদা থাকার নিয়ম)।

## ৪. ঠিকানার মানচিত্র
| কী | ABO (ছোঁয়া হবে না) | Sumon VA (নতুন) |
|---|---|---|
| Repo | `masumon/abo-enterprise` | `masumon/sumon_va` (অ্যাপ root এ, সার্ভার `server/` এ) |
| সার্ভার | Render `abo-enterprise-api` | Render `sumon-va-api` (নতুন workspace) |
| ডাটাবেস | Supabase (ABO) | Supabase `sumon-va` (নতুন) |
| API ঠিকানা | `api.aboenterprise.com` | `va-api.aboenterprise.com` |
| Telegram বট | বর্তমান বট (webhook ABO তে বাঁধা) | নতুন বট |
| ইমেইল পাঠানো | Resend/SMTP | নেই (প্রয়োজন নেই) |
| ইমেইল আসা | Worker `abo-mail-to-inbox` → `api.aboenterprise.com/api/v1/email/inbound` (header `X-Inbound-Secret`) | নতুন Worker (কপি) → `va-api.aboenterprise.com/api/v1/email/inbound`, নিজের নতুন secret |
| ব্যাকআপ | `db-backup.yml` | একই workflow, নিজের secret |

## ৫. ইমেইল (Cloudflare) কীভাবে চলে: যা বুঝেছি
- Worker `abo-mail-to-inbox` আসা ইমেইল নিয়ে ABO সার্ভারের `POST /api/v1/email/inbound` এ পাঠায়, header `X-Inbound-Secret` এর মান সার্ভারের `EMAIL_INBOUND_SECRET` এর সঙ্গে মিললে তবেই গ্রহণ। Worker এর `SECRET` binding এই মান ধরে (সর্বশেষ deploy: "Add secret: SECRET")।
- সার্ভারে আসা মেইল `imap_mail.parse_raw` দিয়ে পড়ে, ফিল্টার করে, ইনবক্সে রাখে। Gmail IMAP আরেকটা পথ (এখন বাধ্যতামূলক নয়)।
- **নতুন সার্ভারের জন্য:** ABO এর Worker ছোঁয়া হবে না। নতুন Worker `sumon-va-mail-to-inbox` বানিয়ে Q2 এর ঠিকানায় Email Routing এ বসানো; লক্ষ্য URL ও secret নতুন। একই ঠিকানা দুই Worker এ একসঙ্গে যায় না, তাই cutover এ ঠিকানার rule বদলাতে হবে।

## ৬. সুমন যা তৈরি করবেন (প্রতিটি শেষে "হয়েছে" বলুন)
| # | কাজ | অবস্থা |
|---|---|---|
| S1 | Render আলাদা workspace এ খালি web service `sumon-va-api` (Free) | [x] 2026-11-06 তৈরি (root `server`; প্রথম deploy ব্যর্থ: `server/` এখনো নেই, প্রত্যাশিত); hostname `sumon-va-api.onrender.com`, Singapore, Auto-Deploy Off: সুমন নিশ্চিত করেছেন 2026-11-06 |
| S2 | Supabase নতুন ফ্রি প্রজেক্ট `sumon-va` (রিজিয়ন Render এর কাছাকাছি) | [x] 2026-11-06 তৈরি (Free, nano, Healthy; project ref `iuavcqdeysruiuwvacrw`; রিজিয়ন সুমন নিশ্চিত করেননি; SQL এখনো চালানো হয়নি, কোনো টেবিল নেই) |
| S3 | Telegram BotFather থেকে নতুন বট; **username** চ্যাটে বলবেন, token নয় | [x] 2026-11-06 বট `@SumonVA_bot` (token সুমনের কাছে, Render এ বসবে; webhook এখনো সংযুক্ত নয়) |
| S4 | ~~Resend নতুন API key~~ বাদ: ইমেইল কোড লাগবে না (সুমনের সিদ্ধান্ত 2026-11-06) | বাদ |
| S5 | Cloudflare: Render এ custom domain `va-api.aboenterprise.com` যোগের পর CNAME `va-api` → Render hostname (শুরুতে "DNS only", সার্টিফিকেট আসার পর চাইলে proxied) | [x] 2026-11-06 `va-api.aboenterprise.com` verified, HTTPS চালু, `/health` ও `assetlinks.json` ok |
| S6 | Cloudflare: নতুন Worker + Email Routing rule (Q2, Q3 এর পর, Claude কোড দেবে) | [ ] |
| S7 | cron-job.org: প্রতি মিনিটে `GET https://va-api.aboenterprise.com/api/v1/wa/cron?token=...` (token Claude নতুন SECRET_KEY থেকে বের করে বলবে; বা সার্ভারের ভেতরের লুপ ব্যবহার হলে লাগবে না) | বাদ: সার্ভারের ভেতরের লুপ (`server/app/core/scheduler.py`) করবে |
| S8 | GitHub `masumon/sumon_va` এ Actions secret `BACKUP_DATABASE_URL` | [ ] **স্থগিত (সুমনের সিদ্ধান্ত 2026-11-06: খ, আপাতত বাদ)।** এখন ডাটাবেসের কোনো ব্যাকআপ নেই (Supabase ফ্রিতে নেই)। পরে: GitHub Actions workflow `db-backup.yml` + secret `BACKUP_DATABASE_URL`। Claude মাঝে মাঝে মনে করিয়ে দেবে |
| S9 | Render env বসানো (ছক §৯): প্রতিটি secret নিজে লিখবেন | [~] 2026-11-06 মূল ৯টি বসানো (DATABASE_URL, SECRET_KEY, APP_ENV, STARTUP_BOOTSTRAP_ENABLED, ADMIN_*, FRONTEND_URL, DEVICE_PASSKEY_RP_ID); বাকি: TELEGRAM_*, ABO_*, VA_INTEGRATION_TOKEN, EMAIL_INBOUND_SECRET |
| S10 | নতুন সার্ভারে অ্যাপের AI keys আবার বসানো (অ্যাপের AI স্ক্রিনে) | [~] AI কোড ABO এর সঙ্গে হুবহু একই (diff যাচাই, ৭ ফাইল); সুমন নিজে অ্যাপের AI স্ক্রিনে কী বসাবে |
| S11 | ABO তে ছোট API PR (§৮) দেখে merge | [ ] |
| S12 | রিলিজ keystore ও পাসওয়ার্ড PC এর বাইরে ব্যাকআপ | [x] সুমন জানিয়েছে ব্যাকআপ নেওয়া আছে (2026-11-06) |
| S13 | অ্যাডমিন থেকে Audit-Emulator ডিভাইস revoke | বাদ: নতুন ডাটাবেস খালি, পুরোনো ডিভাইস সেখানে নেই |

## ৭. Claude যা করবে
| # | কাজ | অবস্থা |
|---|---|---|
| C1 | ABO repo ক্লোন/পড়া (শুধু পড়া); fork-point commit `server/README` এ লিখে রাখা | [x] 2026-11-06 ABO main 9b258a45 (PR #468 merged) থেকে, GitHub ক্লোন; fork-point `server/README.md` এ |
| C2 | `server/` তৈরি: ~৫৩ মডিউল কপি, ছাঁটাই (দোকান, পেমেন্ট, কুরিয়ার, ওয়েবসাইট chatbot বাদ; `assistant/__init__.py` এর chatbot import বাদ) | [x] 2026-11-06 `server/` ৬৭ মডিউল (~১৪ হাজার লাইন); chatbot import ও দোকানের রুট বাদ; ABO order/lead লুকআপ বাদ |
| C3 | সংশ্লিষ্ট টেস্ট কপি, সব সবুজ (অফলাইনে) | [x] 2026-11-06 ২৬৭ টেস্ট সবুজ (অফলাইন) |
| C4 | `server/manual_sql/0001_sumon_va_schema.sql` (~১৪ টেবিল, RLS চালু, policy ছাড়া) | [x] 2026-11-06 `server/manual_sql/0001_sumon_va_schema.sql` (১৪ টেবিল, RLS চালু, সুমন এখনো চালাননি) |
| C5 | ছক: Render এ কোন env কী নামে (§৯ সম্পূর্ণ করা) | [x] env ছক §৯ ও বাস্তব বসানো মিলেছে |
| C6 | নতুন Worker কোড (Q3 এর পর) | বাদ: নতুন Worker লাগেনি, আগেরটার ঠিকানা বদলানো হয়েছে |
| C7a | ABO তে "সুমন VA" ট্যাব (শুধু ফ্রন্টএন্ড+ছোট backend প্রক্সি): ডিভাইস জোড়ার কোড তৈরি, ডিভাইস তালিকা/সরানো, kill switch; নতুন সার্ভারের `/integration/*` কে সার্ভিস টোকেনে ডাকে (ABO তে অ্যাডিটিভ PR, সুমন merge) | [~] 2026-11-06 সার্ভারের দিক তৈরি (`integration.py`, ৬ টেস্ট); ABO এর দিক: `docs/ABO_ADMIN_TAB_SPEC.md` অনুযায়ী ABO এজেন্ট বানাবে |
| C7 | `abo_client.py` + হোমের ব্যবসায়িক সংখ্যা ABO API থেকে | [ ] |
| C8 | ABO তে API PR (অ্যাডিটিভ, বন্ধ থাকে) + ABO এর পুরো টেস্ট সবুজ | [ ] |
| C9 | পুরোনো ডেটা শুধু-পড়ে নতুন DB তে কপি (ABO এর কিছু বদলাবে না) | বাদ: সুমন পুরোনো ডেটা চান না (2026-11-06) |
| C10 | অডিটের জানা বাগ নতুন কপিতে ঠিক (B-01 জরুরি alert, B-02 পরিবার কখনো auto-reply নয়, B-04, B-12, P-01, D-02 ...) | [ ] |
| C11 | অ্যাপ: `SERVER` বদল, নতুন সার্ভারে `base` মাইগ্রেশন/পুনরায় সাইন-ইন, নতুন passkey, `assetlinks.json` | [x] 2026-11-06 বিল্ড ৪৬ ফোনে ইনস্টল, Telegram সাইন-ইন সফল; পরের বিল্ডে ইমেইল-কোড বোতাম সরানো ও ৭৫ সেকেন্ড অপেক্ষা (কোডে হয়েছে) |
| C12 | নতুন APK: **আপনার অনুমতি নিয়ে**, আগে emulator, তারপর ফোন | [~] প্রথম বিল্ড ফোনে হয়েছে; পরের বিল্ড সুমনের অনুমতির পর |
| C13 | `docs/HANDOFF.md` আপডেট | [x] 2026-11-06 HANDOFF নতুন করে লেখা |

## ৮. ABO থেকে কী আসবে, কী আসবে না
**আসবে (কপি, ABO অক্ষত):** brain (`wa_flow`, `wa_brain`, `wa_ai`, `privacy`, `promises`, `presence`, `timectx`, `wa_config`, `wa_health`, `wa_send`, `wa_coexist`); চ্যানেল (`ingest`, `dispatch`, `alerts`, `telegram`, `phone_login`, `wake`, `email_filter`, `imap_mail`, `platforms`); AI (`ai_gemini`, `ai_hub`, `ai_providers`, `ai_catalog`, `link_import`); রুট `inbox.py`, `wa_assistant.py` (দরকারি অংশ), `ai_hub.py`, `ai_catalog.py`, `passkeys` (ডিভাইস অংশ); core (`config`, `database`, `security`, `rbac`, `rate_limit`, `email*`, `notifications`, `ops_events`, `monitoring`, `service_health`, `totp_crypto`, `admin_security`, `capabilities`, `device_auth`); টেবিল ~১৪টি: `admin_users`, `passkeys`, `settings`, `activity_logs`, `notifications`, `system_events`, `email_templates`, `wa_contacts`, `wa_messages`, `wa_notes`, `wa_tasks`, `inbox_devices`, `inbox_pair_codes`, `inbox_commands`।
**ডেটা (শুধু পড়ে কপি):** `wa_contacts` যেখানে `channel` ≠ whatsapp (সঙ্গে messages/notes/tasks), `inbox_devices`, settings এর `va_app_config`, `owner_login_phone*`, `inbox_*`। passkey কপি হবে না (নতুন হোস্টে নতুন)।
**আসবে না (ABO তে থাকবে):** দোকান, অর্ডার/বুকিং/লিডের টেবিল, পেমেন্ট, কুরিয়ার, CMS, ওয়েবসাইট chatbot, Apon/`app_releases`, WhatsApp Cloud API ও Meta।
**ABO তে নতুন (একমাত্র পরিবর্তন, আপনার merge এ):** `integrations_va.py`: ডিফল্টে 404; `VA_INTEGRATION_TOKEN` বসালে `GET /integrations/va/summary` শুধু ৪টি সংখ্যা (অপেক্ষমাণ অর্ডার, বুকিং, নতুন লিড, নতুন আবেদন)। Bearer token + সময়/HMAC, rate limit, প্রতি কল লগ। লেখা/মোছা/পেমেন্ট/ব্যবহারকারী/সেটিংস কখনো নয়।

## ৯. Render env ছক (নাম শুধু; মান সরাসরি Render এ)
`APP_ENV=production`, `STARTUP_BOOTSTRAP_ENABLED=false`, `DATABASE_URL` (Supabase session pooler, host `*.pooler.supabase.com`), `SECRET_KEY` (নতুন, ABO এর নয়), `JWT_ALGORITHM=HS256`, `ACCESS_TOKEN_EXPIRE_MINUTES=1440`, `FRONTEND_URL=https://va-api.aboenterprise.com`, `ADMIN_EMAIL` (Q1), `ADMIN_PASSWORD`, `ADMIN_NAME`, `DEVICE_PASSKEY_RP_ID=va-api.aboenterprise.com`, `DEVICE_PASSKEY_ANDROID_ORIGINS` (release + debug, মান SERVER_SEPARATION_MASTER_PLAN §3.1 এ), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_NOTIFY_EMAIL`, `VA_INTEGRATION_TOKEN` (ABO এর ডিভাইস-জোড়া ট্যাবের জন্য; ABO তেও একই মান), `EMAIL_INBOUND_SECRET` (নতুন, Worker এ একই মান), `ABO_API_BASE=https://api.aboenterprise.com`, `ABO_INTEGRATION_TOKEN` (ABO তে `VA_INTEGRATION_TOKEN` এর একই মান; ABO তে PR merge ও চালু করার পর), Render সেটিংস: root directory `server`, build `pip install -r requirements.txt`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health `/health`, Python 3.11.9, auto-deploy `main`।

## ১০. সুমন কী পারবেন না/করবেন না, আর Claude এর সীমা
- Claude Cloudflare, Render, Supabase বা GitHub Actions এ ঢুকতে পারে না। অ্যাকাউন্টের কাজ (তৈরি, DNS, secret) সুমন করবেন; Claude ধাপে ধাপে বলে দেবে।
- Claude নিজে `va-api` সাবডোমেইন তৈরি করতে পারে না। Render এ custom domain দেওয়ার পর Cloudflare এ CNAME সুমনকে বসাতে হবে (S5)।
- ফোনের বিল্ড, push, merge, deploy, DNS বদল: প্রতিটির আগে সুমনের স্পষ্ট "হ্যাঁ"।
- ABO এর ওয়েবসাইট, অ্যাডমিন, WhatsApp assistant, Apon: কিছু ভাঙা যাবে না; ABO তে একমাত্র পরিবর্তন §৮ এর API PR।

## ১১. ধাপের ক্রম (প্রতিটির আগে "go")
1. **P0** সুমন: S1–S4 তৈরি।
2. **P1** Claude: C1–C5 (`server/`, টেস্ট, SQL), ABO তে প্রভাব নেই।
3. **P2** একসঙ্গে: নতুন Supabase এ SQL → Render deploy → S5 domain → শুধু টেস্ট ডিভাইসে সাইন-ইন, ingest, poll যাচাই।
4. **P3** Claude: C8 (ABO API PR), সুমন merge ও token চালু (S11), C7 হোম সংখ্যা।
5. **P4** ইমেইল: C6, S6 (নতুন Worker, নতুন ঠিকানা)।
6. **P5** C9 ডেটা কপি।
7. **P6** C11–C12 নতুন APK, ফোনে আবার সাইন-ইন + নতুন passkey; কয়েকদিন দুই সার্ভার পাশাপাশি।
8. **Rollback:** আগের APK (`dist\`) আবার ইনস্টল; পুরোনো সার্ভারের ডেটা অক্ষত।

## ১২. পরিবর্তনের খাতা
| তারিখ | কে | কী |
|---|---|---|
| 2026-11-06 | Claude | প্রথম খসড়া; সিদ্ধান্ত ও খোলা প্রশ্ন তোলা হলো |
| 2026-11-06 | Claude+সুমন | Supabase এ 0001 SQL চালানো হয়েছে; Render প্রথম deploy সফল; `/health` ও `/health/db` ok (database connected) |
| 2026-11-06 | Claude | S1 Render, S2 Supabase, S3 বট সম্পন্ন; S4 (Resend) বাদ, ইমেইল কোড লাগবে না; pair ABO অ্যাডমিন ট্যাব থেকে (C7a) |

| 2026-11-06 | সুমন | Telegram: `@SumonVA_bot` আগের বটই (নতুন নয়); token ও secret `sumon-va-api` এ বসানো; webhook এখন `va-api.aboenterprise.com` এ বাঁধা (ইচ্ছাকৃত; ABO আর এই বট ব্যবহার করে না) |
| 2026-11-06 | Claude | কোড ঘেঁটে দেখা: নতুন সার্ভারে লাগে না: Supabase কী, Cloudinary, SMS, bKash/Nagad, GA4, VAPID, Sentry, IMAP, Resend। লাগে: DATABASE_URL, SECRET_KEY, ADMIN_*, TELEGRAM_*, EMAIL_INBOUND_SECRET, FRONTEND_URL, DEVICE_PASSKEY_RP_ID; পরে ABO_* ও VA_INTEGRATION_TOKEN। cron: সার্ভারের ভেতরের লুপ (cron-job.org লাগবে না) |
| 2026-11-06 | সুমন | ইমেইল: `info@aboenterprise.com` → Worker `abo-mail-to-inbox` → `va-api` (ABO এর কাস্টমার-মেইলও Sumon VA ইনবক্সে চাই, সিদ্ধান্ত); Gmail ফরোয়ার্ড আগের মতো; ইমেইল চ্যানেল অ্যাপ সরার পর চালু হবে |
| 2026-11-06 | Claude | AI কোড যাচাই (৭ ফাইল হুবহু ABO); S12 সুমনের কথায় সম্পন্ন; ব্যাকআপ workflow নিরাপত্তা-ব্লকে আটকা; HANDOFF নতুন করে লেখা |
| 2026-11-06 | সুমন | ডাটাবেস ব্যাকআপ workflow: খ (আপাতত বাদ), নোট রাখা হয়েছে |

## ১৩. এখনকার বাকি কাজের ক্রম (2026-11-06 রাত)
| # | কে | কাজ | অবস্থা |
|---|---|---|---|
| 1 | সুমন | GitHub এ PR merge, Render Manual Deploy (Telegram ক্যাশ ও আগের ঠিক করা সার্ভারে যাবে) | [x] 2026-11-06 সুমন জানিয়েছে merge ও deploy হয়েছে |
| 2 | সুমন | অ্যাপে AI কী বসানো, চ্যানেল/প্ল্যাটফর্ম সেটিং, "সহকারী চালু" সিদ্ধান্ত | বাকি |
| 3 | সুমন | cron-job.org এ ABO এর `/api/v1/email/cron` কাজ বন্ধ (`/wa/cron` থাকবে) | বাকি |
| 4 | Claude | **পরের বিল্ড** (সুমন: পরে করবে) (একসঙ্গে: সাইডবার ঠিক, রিফ্রেশ স্পিনার, Signal ইনস্টল-যাচাই, ইমেইল-বোতাম সরানো, ৭৫ সেকেন্ড অপেক্ষা) | সুমনের "বিল্ড করো" র অপেক্ষা |
| 5 | Claude | বিল্ডের পর ফোনে যাচাই: ক্র্যাশ নেই, সাইডবার, রিফ্রেশ, Signal, স্ক্রিনশট-আটকানো সুইচ | বিল্ডের পর |
| 6 | Claude+সুমন | আসল পরীক্ষা: নোটিফিকেশন/SMS/কল নতুন সার্ভারে পৌঁছায়, উত্তর, অ্যালার্ট, Google passkey | বিল্ডের পর |
| 7 | ABO এজেন্ট | ধাপ ১ অ্যাডমিন ট্যাব, ধাপ ২ টিয়ার-১, ধাপ ৩ টিয়ার-২ | [x] 2026-11-06 সুমন জানিয়েছে সব শেষ। Claude ABO `main` পড়ে যাচাই করেছে: `va_admin.py` আছে; `inbox.py`, `imap_mail.py`, `email_filter.py`, `telegram.py`, `device_auth.py` নেই; `sumon-va/` ফোল্ডার নেই; PR #472, #473, #474 merge; টিয়ার-৩ এর ম্যানুয়াল SQL খসড়া `0061` লেখা (সুমন নিজে চালাবে, ব্যাকআপের পর)। ফ্রন্টএন্ড ট্যাব ও ABO এর টেস্ট Claude দেখেনি |
| 8 | সুমন | ট্যাব merge হলে দুই Render এ একই `VA_INTEGRATION_TOKEN` (ABO তে সঙ্গে `VA_API_BASE`) | [x] 2026-11-06 সুমন জানিয়েছে করা হয়েছে; Claude যাচাই: নতুন সার্ভারের `/integration/devices` বিনা টোকেনে 403 (আগে 404 ছিল), মানে চালু |
| 9 | Claude | ABO এর ৪টি ব্যবসায়িক সংখ্যার (অর্ডার, বুকিং, লিড, আবেদন) শুধু-পড়ার API এর নির্দেশ ABO এজেন্টের জন্য | বাকি |
| 10 | Claude | সার্ভারের অডিটের বাগ (B-01, B-02, B-04, B-12, P-01, D-02 ইত্যাদি) | বাকি |
| 11 | Claude+সুমন | ইমেইল চ্যানেল চালু ও ইমেইল-ইনবক্স পরীক্ষা | বাকি |
| 12 | সুমন | ABO Render এর `EMAIL_IMAP_*`, `EMAIL_INBOUND_SECRET`, `DEVICE_PASSKEY_*`, `TELEGRAM_*` মোছা | [x] 2026-11-06 সুমন জানিয়েছে শেষ (Claude নিজে দেখেনি) |
| 13 | সুমন | ABO ডাটাবেসের সুমন VA ডেটা মোছা (ম্যানুয়াল SQL `0061`) | [x] 2026-11-06 সুমন জানিয়েছে শেষ (Claude নিজে দেখেনি; সুমন নিশ্চিত করেছে: ABO ব্যাকআপ SQL এর আগে নেওয়া হয়েছিল, সব ঠিক আছে) |
| 14 | সুমন | ডাটাবেস ব্যাকআপ workflow | **স্থগিত (সিদ্ধান্ত খ), মনে করানো হবে** |
| 15 | সুমন+Claude | `docs/START_HERE.md` ও `docs/PROJECT_RULES.md` ফাইনাল | [x] 2026-11-06 সুমন অনুমোদন দিয়েছে |
| 16 | Claude | পুরোনো তালিকা: অনুমতি কমানো, TalkBack, premium/warm ও ইংরেজি UI যাচাই, সিস্টেম মেইল মানুষ হিসেবে, `allowBackup` | পরে |
| 2026-11-06 | সুমন | merge ও Render deploy সম্পন্ন (ফিচার branch 477fe2c পর্যন্ত); বিল্ড পরে |
| 2026-11-06 | সুমন+Claude | `START_HERE.md` ও `PROJECT_RULES.md` ফাইনাল; `CLAUDE.md` এর শুরুতে লিংক; নতুন যে-ই আসবে সে আগে START_HERE পড়বে, কাজ শেষে TRANSFER ও HANDOFF আপডেট করবে |
| 2026-11-06 | সুমন+Claude | ABO এজেন্টের কাজ শেষ (সুমনের কথা + Claude এর ABO main যাচাই, ব্যাকএন্ড অংশ)। পরের ধাপ: #8 `VA_INTEGRATION_TOKEN` দুই Render এ, তারপর ট্যাব দিয়ে ফোন জোড়া পরীক্ষা |
| 2026-11-06 | সুমন | ABO এর ফ্রন্টএন্ড ট্যাব ও ABO টেস্ট কাজ করে (সুমন যাচাই করেছে); টোকেন দুই Render এ বসানো |
| 2026-11-06 | সুমন | ABO এর পুরোনো env মোছা ও ডেটা মোছার SQL শেষ (সুমন জানিয়েছে); Claude দেখেছে ABO ও নতুন সার্ভারের `/health` ও ওয়েবসাইট সাড়া দিচ্ছে |
| 2026-11-06 | সুমন+Claude | নিয়ম যোগ: প্রতিটি কাজ শেষ হওয়ার সঙ্গে সঙ্গে TRANSFER, HANDOFF ও স্মৃতি আপডেট (PROJECT_RULES §০, START_HERE, CLAUDE.md) |
| 2026-11-06 | সুমন | নিশ্চিত: ABO ডাটাবেসের ব্যাকআপ SQL চালানোর আগে নেওয়া হয়েছিল, সব ঠিক আছে। ABO থেকে আলাদা করার কাজ সম্পূর্ণ। পরের ধাপ: বিল্ড (সুমনের "বিল্ড করো" র অপেক্ষা) |
