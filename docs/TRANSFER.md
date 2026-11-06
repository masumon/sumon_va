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
| Brain নির্দেশ | `Brain_Prompt.md` v2.0 মূল নির্দেশ; নিরাপদ কাজ নিজে নিজে, প্রোডাকশন SQL/deploy/সংবেদনশীল permission/পেইড/ভাঙা বদল আলাদা অনুমোদনে (`PROJECT_RULES §৯`) | সুমন 2026-11-06 |
| F0 | `/f0`-ই Sitting Room / Personal AI Brain-এর Command Center; অন্য মডিউল আলাদা স্ক্রিনে, F0 থেকে প্রয়োজনমতো ব্যবহার | সুমন 2026-11-06 |
| SQL পদ্ধতি | Claude SQL দেয় (একটি একটি), সুমন Supabase-এ চালায়, ফল জানায়, Claude মেলায়; Preflight → Execution → Verification | সুমন 2026-11-06 |
| গিটের বাইরে | `_private/`, অডিট/ডিজাইন ফোল্ডার, keystore, লগ কখনো গিটে নয় ("সব পুশ" বললেও); `Brain_Prompt*.md` গিটে আছে (`f5e4ac4`) | সুমন+Claude 2026-11-06 |

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
| 17 | সুমন | একটি আসল টেস্ট SMS লাইভ সার্ভার দিয়ে (ইনবক্সে আসে কি না) | বাকি |
| 18 | Claude+সুমন | লাইভ RLS যাচাই: Claude শুধু-পড়ার SQL দেবে, সুমন চালাবে | বাকি |
| 19 | সুমন | "সহকারী চালু" (প্রথমে draft/shadow মোড)। বন্ধ থাকলে Brain কিছুই করে না | বাকি |
| 20 | Claude | ব্রেইন Phase ১–৭ কোড (`Brain_Prompt.md`) | [x] 2026-11-06: ৩৬৭ টেস্ট পাস, `tsc`/`eslint` ত্রুটিহীন, merge ও deploy (PR #8, `main` `2fc9d21`), লাইভে নতুন রুট ৪০১। **ডিভাইসে যাচাই হয়নি** |
| 21 | সুমন | SQL `0002` ও `0003` Supabase-এ চালানো | [x] 2026-11-06 চালিয়েছেন ও যাচাই (contacts ৪, tasks ১ অপরিবর্তিত) |
| 22 | Claude | ব্রেইন অ্যাপ-অংশ (F0, কার্ড, টাস্ক বোতাম, Kotlin সংকেত) বিল্ড ও ফোনে পরীক্ষা: `docs/BRAIN_ROLLOUT_PLAN.md` §২ | বাকি, #4-এর বিল্ডের সঙ্গে |
| 23 | Claude | `Brain_Prompt §২৩`-এর বাকি ডেলিভারেবল (আর্কিটেকচার ম্যাপ, ১৮-ডোমেইন ফাইল, API/Webhook রিপোর্ট, permission ম্যাট্রিক্স, ডিপেন্ডেন্সি, নিরাপত্তা, টেস্ট, বিল্ড রিপোর্ট, ব্যবহার-গাইড) | বাকি |
| 24 | সুমন | সিদ্ধান্ত: Find-Hub-ধরনের সুরক্ষা, `READ_SMS`, স্বয়ংক্রিয় ব্যাকআপ, F0-তে কী আগে আনা (`docs/REMAINING_WORK.md` §৮) | বাকি |
| 2026-11-06 | সুমন | merge ও Render deploy সম্পন্ন (ফিচার branch 477fe2c পর্যন্ত); বিল্ড পরে |
| 2026-11-06 | সুমন+Claude | `START_HERE.md` ও `PROJECT_RULES.md` ফাইনাল; `CLAUDE.md` এর শুরুতে লিংক; নতুন যে-ই আসবে সে আগে START_HERE পড়বে, কাজ শেষে TRANSFER ও HANDOFF আপডেট করবে |
| 2026-11-06 | সুমন+Claude | ABO এজেন্টের কাজ শেষ (সুমনের কথা + Claude এর ABO main যাচাই, ব্যাকএন্ড অংশ)। পরের ধাপ: #8 `VA_INTEGRATION_TOKEN` দুই Render এ, তারপর ট্যাব দিয়ে ফোন জোড়া পরীক্ষা |
| 2026-11-06 | সুমন | ABO এর ফ্রন্টএন্ড ট্যাব ও ABO টেস্ট কাজ করে (সুমন যাচাই করেছে); টোকেন দুই Render এ বসানো |
| 2026-11-06 | সুমন | ABO এর পুরোনো env মোছা ও ডেটা মোছার SQL শেষ (সুমন জানিয়েছে); Claude দেখেছে ABO ও নতুন সার্ভারের `/health` ও ওয়েবসাইট সাড়া দিচ্ছে |
| 2026-11-06 | সুমন+Claude | নিয়ম যোগ: প্রতিটি কাজ শেষ হওয়ার সঙ্গে সঙ্গে TRANSFER, HANDOFF ও স্মৃতি আপডেট (PROJECT_RULES §০, START_HERE, CLAUDE.md) |
| 2026-11-06 | সুমন | নিশ্চিত: ABO ডাটাবেসের ব্যাকআপ SQL চালানোর আগে নেওয়া হয়েছিল, সব ঠিক আছে। ABO থেকে আলাদা করার কাজ সম্পূর্ণ। পরের ধাপ: বিল্ড (সুমনের "বিল্ড করো" র অপেক্ষা) |
| 2026-11-06 | Claude | **ব্রেইন Phase 1 (মিসড-কল প্রসঙ্গ):** নতুন `server/app/assistant/call_context.py` (বিশুদ্ধ ফাংশন), `wa_flow._process`-এ সংযোগ, `wa_config`-এ `calls` সেটিং (burst_min 10, escalate_after 0, reply false)। স্কিমা/SQL/অনুমতি অপরিবর্তিত। `pytest`: ২৯৪ পাস (আগে ২৭৫ + নতুন ১৯), আমি নিজে চালিয়েছি। যাচাই হয়নি: ফোনে/ইমুলেটরে আসল কল, Render-এ চলা (ডেপ্লয় হয়নি), "সহকারী চালু" বন্ধ থাকলে `_process` কিছুই করে না। কমিট হয়নি (working tree-তে)। পরের ধাপ: Phase 2 (উত্তর-যাচাই, গ্রুপিং, পড়া-রিমাইন্ডার); ব্যাকআপ-সিদ্ধান্ত Phase 3-এর আগে |
| 2026-11-06 | Claude | **ব্রেইন Phase 2 (সার্ভার-অংশ):** নতুন `assistant/thread_state.py` (উত্তর-অবস্থা: none/assistant_only/new_inbound/adequate/partial/uncertain; গ্রুপিং-টেক্সট; "উত্তর বাকি" রিমাইন্ডার-শর্ত), `wa_flow`-এ `_group_gate` (৫ মিনিট, জরুরি/কল/গ্রুপ অপেক্ষা করে না), `send_unanswered_reminders` (cron, ডিফল্ট বন্ধ, "পড়েছে" কখনো বলে না), `alerts.push_owner(label=)`, `wa_config`-এ `grouping`/`reminders`। স্কিমা/SQL/অনুমতি অপরিবর্তিত। `pytest`: ৩১৩ পাস (আমি চালিয়েছি)। যাচাই হয়নি: ফোন/এমুলেটর, Render, ফোন-পাশের "নোটিফিকেশন সরানো" সংকেত (কোডই হয়নি), কমিট হয়নি। পরের ধাপ: Phase 3 (টাস্ক) — আগে ব্যাকআপ সিদ্ধান্ত |
| 2026-11-06 | Claude | **ব্রেইন Phase 3a (টাস্ক, স্কিমা ছাড়া):** নতুন `assistant/assignments.py` (অন্যের চাওয়া কাজ শনাক্ত, "কাজের কী হলো" শনাক্ত, অবস্থা-নোট; `promises.py`-এর পার্সার পুনর্ব্যবহার), `wa_flow._process`-এ সংযোগ (`source="proposed"` টাস্ক, নিজে কখনো নিশ্চিত হয় না; অবস্থা-প্রশ্নে মালিককে অ্যালার্ট, ব্যক্তিকে কিছু প্রতিশ্রুতি নয়), নতুন রুট `POST /admin/wa/tasks/{id}/confirm`, টাস্ক-তালিকায় `proposed` ফিল্ড (যোগ-মাত্র)। কোনো SQL লাগেনি। `pytest`: ৩২৭ পাস (আমি চালিয়েছি), `_process`-এর পুরো পথ SQLite-এ পরীক্ষিত (মিসড-কলসহ)। যাচাই হয়নি: অ্যাপে "নিশ্চিত করুন" বোতাম (অ্যাপ বদলায়নি, বিল্ড লাগবে), ফোন/Render, টাস্কের অগ্রগতি/বাধা/assigner কলাম (SQL লাগবে, ব্যাকআপের পর), টাস্ক-ফলোআপ রিমাইন্ডার। কমিট হয়নি |
| 2026-11-06 | Claude | **ব্রেইন Phase 4 (পরিচয় একীকরণ):** নতুন `assistant/identity.py`; একই নম্বর (high) নিজে যুক্ত, একই নাম (medium) শুধু প্রস্তাব, ভিন্ন নম্বর/গ্রুপ কখনো নয়; যুক্ত করা ফেরানো যায়, কিছু মোছে না; খাতা `settings.identity_log`। রুট: `GET /admin/wa/identity/suggestions`, `POST .../identity/link`, `POST .../identity/unlink/{cid}`, `GET /admin/wa/contacts/{cid}/identity`। মিসড-কল প্রসঙ্গ এখন পুরো ব্যক্তির (SMS+WhatsApp…) ইতিহাস দেখে। **SQL প্রস্তুত, চালানো হয়নি, মালিকের কাজ:** `server/manual_sql/0002_contact_person_link.sql` (+ `_ROLLBACK.sql`; একটি nullable কলাম + ইনডেক্স; ব্যাকআপ মালিক নিশ্চিত করেছে)। কলাম না থাকলেও কোড স্বাভাবিক চলে (টেস্টে প্রমাণিত), শুধু লিংকের রুট 409 বলে "0002 চালানো হয়নি"। `pytest`: ৩৪০ পাস (আমি চালিয়েছি)। যাচাই হয়নি: আসল Supabase-এ SQL, অ্যাপে লিংক-UI (নেই), ফোন/Render। কমিট হয়নি |
| 2026-11-06 | Claude+এজেন্ট | **ব্রেইন: সব কোডভিত্তিক ধাপ শেষ (SQL/বিল্ড/push/deploy ছাড়া):** সার্ভার: `memory.py` (তথ্যের উৎস/আস্থা/সংশোধন-ইতিহাস, `profile.facts`), `relationship.py` (সম্পর্কের লক্ষণ, অনুমান-লেবেল), `f0.py` + `POST /admin/wa/f0/command` (শুধু খসড়া, পাঠানো অনুমোদনে), `history_import.py` + `POST .../import-history` (তারিখসহ এক্সপোর্ট, ডুপ্লিকেট-মুক্ত, প্রসঙ্গ-মাত্র), `task_details.py` + `POST .../tasks/{id}/progress` + টাস্ক-সময় রিমাইন্ডার, `seen` সংকেত গ্রহণ, `explain_mode` (কোন নিয়ম জিতল), SQL `0003` প্রস্তুত। বাগ ঠিক: `learn` রুট `profile` মুছে দিত (এখন facts বাঁচে)। অ্যাপ (এজেন্ট): `routes/f0.tsx`, `src/va/ContactMemory.tsx`, টাস্কে "নিশ্চিত করুন", Kotlin `onNotificationRemoved`। `pytest` ৩৬২ পাস, `npx tsc --noEmit` ও `npx eslint routes src modules` ত্রুটিহীন (আমি চালিয়েছি)। যাচাই হয়নি: Kotlin কম্পাইল, ফোন/এমুলেটর, Supabase-এ SQL 0002/0003, Render, নতুন UI-র থিম/ফন্ট। কমিট হয়নি। ক্রম: docs/BRAIN_ROLLOUT_PLAN.md |
| 2026-11-06 | Claude | **চূড়ান্ত অডিট (কোড-সংশোধনসহ, SQL/বিল্ড/push/deploy/কমিট ছাড়া):** (১) "Sitting Room/F0" নাম প্রজেক্টের কোড বা ডকে কোথাও নেই (শুধু নির্দেশ-ফাইলে); `ai.tsx` আসলে "AI সংযোগ" স্ক্রিন; `/f0`=F0 **অপ্রমাণিত**, মালিকের সিদ্ধান্ত। (২) `call()` `message` ফেলে দেয়, কিন্তু সার্ভারের `message` ফোনকে-দেওয়া বার্তাকেও "পাঠানো হয়েছে" বলে, তাই `call()` বদলাইনি; `routes/f0.tsx` এখন বার্তার নিজের `status`/`error` থেকে বাংলা ফল দেখায় (ব্যর্থ হলে ঝুঁকি-রঙে)। (৩) `ContactMemory`: "শোধরানো/পুরনো" তথ্যে "শুধরান" বোতাম সরানো (সার্ভার ৪০৪ দিত)। রঙ-টোকেন তিন প্যালেটেই আছে (স্ট্যাটিক), চোখে দেখা হয়নি। (৪) Kotlin: `:va-bridge:compileDebugKotlin` সফল (APK নয়), ক্লাসে `onNotificationRemoved` আছে, ফোনে চালানো হয়নি। (৫) `pytest` ৩৬২ পাস, `tsc` ও `eslint routes src modules` ত্রুটিহীন (আমি চালিয়েছি) |
| 2026-11-06 | Claude | **সমন্বিত চূড়ান্ত যাচাই (SQL/বিল্ড/push/deploy/কমিট/অনুমতি যোগ ছাড়া):** F0 ও বাকি প্রবাহের মিথস্ক্রিয়ায় ৪টি প্রমাণিত বাগ ঠিক: (১) নতুন বার্তা এলে সহকারী মালিকের নিজের F0-খসড়ার লেখা ওভাররাইট করত (এখন `owner/manual` খসড়া ছোঁয় না); (২) অনুমোদনহীন F0-খসড়া `decide`-এ "মালিক উত্তর দিয়েছেন" ধরা হতো (এখন শুধু sent/queued/sending/imported); (৩) F0-তে id দিয়ে বাছলে একই ব্যক্তির অন্য চ্যানেলের উত্তর দেখা হতো না (এখন পুরো ব্যক্তি); (৪) নিজের আগের খসড়ার সতর্কতা ভুল শব্দে ("সহকারীর") ছিল। সঙ্গে UI: দুই বোতাম একই "পাঠান" নামে ছিল, ওপরেরটি এখন "নির্দেশ দিন"। F0-র সঙ্গে "Sitting Room" মেলে কি না: প্রমাণ নেই (নামটা শুধু নির্দেশ-ফাইলে), স্পেক-তুলনা BRAIN_ROLLOUT_PLAN §৫-এ, মালিকের সিদ্ধান্ত। `pytest` ৩৬৭ পাস, `tsc` ও `eslint routes src modules` ত্রুটিহীন (আমি চালিয়েছি); Kotlin কম্পাইল ০৭:৫২-এ সফল, সোর্স তারপর অপরিবর্তিত; নতুন মোছা/DROP নেই |
| 2026-11-06 | সুমন+Claude | **সিদ্ধান্ত:** `/f0`-ই Sitting Room / Personal AI Brain-এর Command Center; অন্য মডিউল আলাদা স্ক্রিনে থাকবে, F0 থেকে প্রয়োজনমতো ব্যবহার হবে। UI-র বাংলা/ইংরেজি লেখা প্রথম বিল্ডের পর স্ক্রিনশট দেখে পর্যালোচনা। `Brain_Prompt.md` ও আর্কাইভ কমিট হবে না (**পরে মালিক "যা যা আছে সব ফিচার ব্রাঞ্চে" বলায় ও দুটি কমিট হয়েছে: `f5e4ac4`**)। সব পরিবর্তন কমিট ও push (merge/deploy/SQL/বিল্ড নয়) |
| 2026-11-06 | সুমন+Claude | **SQL মাইগ্রেশন সম্পূর্ণ (মালিক নিজে Supabase `Sumon_va`-তে চালিয়েছেন, Claude চালায়নি):** `0002` (wa_contacts.person_id + ইনডেক্স): Preflight table=1, কলাম=0, contacts=4 → Execution `Success` → Verification column_ok=1, index_ok=1, contacts=4, linked=0। `0003` (wa_tasks-এ ৭টি কলাম): Preflight table=1, নতুন কলাম=0, tasks=1 → Execution `Success` → Verification new_cols_ok=7, types_ok=7, tasks=1, rows_touched=0। কোনো সারি হারায়নি বা বদলায়নি। পরের ধাপ: merge ও Render Manual Deploy (মালিকের অনুমতিতে), তারপর `/health`, `/health/db`, "সহকারী চালু", বিল্ড |
| 2026-11-06 | সুমন+Claude | **merge ও deploy সম্পন্ন (PR #8, `main`-এ `2fc9d21`; Render Manual Deploy মালিক করেছেন):** Claude নিজে যাচাই করেছে: `/health` ও `/health/db` HTTP ২০০ (ডাটাবেস সংযুক্ত); `POST /admin/wa/f0/command`, `GET /admin/wa/identity/suggestions`, `POST /admin/wa/tasks/{id}/progress`, `POST /admin/wa/contacts/{id}/import-history`, `GET /admin/wa/tasks` সবই বিনা টোকেনে ৪০১ (৪০৪ নয়) = নতুন কোড লাইভে। যাচাই হয়নি: টেস্ট SMS, টোকেন-সহ আসল কল, "সহকারী চালু" অবস্থা। পরের ধাপ: টেস্ট SMS, তারপর মালিকের সিদ্ধান্তে "সহকারী চালু" ও বিল্ড |
| 2026-11-06 | Claude | **সব ডক ও মেমরি গুছিয়ে হালনাগাদ (অন্য জায়গা থেকে কাজ ধরার জন্য; কোড বদল নেই, কমিট/push নেই):** নতুন `docs/REMAINING_WORK.md` (সব বাকি কাজ, অবস্থা, ক্রম, সিদ্ধান্ত, নিয়ম, টিপস); `START_HERE` (§৮ Brain, পড়ার ক্রম), `PROJECT_RULES` (§৯ Brain নির্দেশ ও SQL পদ্ধতি, টেস্ট-সংখ্যা ৩৬৭), `HANDOFF §০` পুরো নতুন করে (পুরোনো ও পরস্পরবিরোধী তথ্য সরানো), `TRANSFER` (§২ সিদ্ধান্ত, §১৩ নতুন সারি ১৭–২৪, কমিট-সংক্রান্ত পুরোনো লাইন সংশোধন), `BRAIN_ROLLOUT_PLAN`, `BRAIN_TRACEABILITY`, `CLAUDE.md`-এর পয়েন্টার; Claude-র মেমরি-ফাইলও। লাইভ প্রমাণ (আজ): `/health` ২০০, `/health/db` সংযুক্ত, নতুন রুট ৪০১ |
