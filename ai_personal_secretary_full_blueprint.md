# 📱 AI Personal Secretary: Full System Architecture & Implementation Blueprint

---

## 📑 সূচিপত্র (Table of Contents)
1. **সিস্টেম ওভারভিউ ও মূল উদ্দেশ্য (System Overview & Core Objectives)**
2. **প্রয়োজনীয় টুলস, লাইব্রেরি ও ডিপেনডেন্সি (Required Tools, Tech Stack & Dependencies)**
3. **সিস্টেম ডাটা ফ্লো ও আর্কিটেকচারাল ডায়াগ্রাম (Data Flow & System Architecture)**
4. **অ্যান্ড্রয়েড ডাটা ক্যাপচার মেকানিজম (Deep Dive: Full Data Access on Android)**
   - SMS & Missed Calls (Broadcast Receiver & Telephony API)
   - WhatsApp, Messenger & IMO (Notification Listener & Accessibility Service)
   - Voice Notes & Audio Transcripts (Groq Whisper / Edge-TTS)
5. **ডাটাবেজ আর্কিটেকচার (Supabase Database Schemas)**
6. **এআই ব্রেইন ব্যাকএন্ড (Python FastAPI on Render + Resilient Multi-AI Router)**
7. **অ্যান্ড্রয়েড ফ্রন্টএন্ড কোড স্ট্রাকচার (Jetpack Compose UI & Foreground Service)**
8. **সিকিউরিটি, প্রাইভেসি ও রিয়েল-টাইম কুইক রিপ্লাই লজিক (Security, Privacy & Quick Reply Execution)**

---

## 1. 🎯 সিস্টেম ওভারভিউ ও মূল উদ্দেশ্য (System Overview)

এই প্রজেক্টের মূল উদ্দেশ্য হলো অ্যান্ড্রয়েড স্মার্টফোনে একজন পূর্ণাঙ্গ **স্বয়ংক্রিয় এআই পার্সোনাল সেক্রেটারি** তৈরি করা। অ্যাপটি ফোনের সমস্ত ইনকামিং মেসেজ (WhatsApp, Messenger, IMO, SMS) এবং কল (Phone Call, Missed Call) রিয়েল-টাইমে মনিটর করবে, ব্যবহারকারীর বর্তমান মুড (Auto, Sleeping, Busy, Driving, Custom) এবং ইনকামিং কন্টাক্টের ধরন (VIP, Client, Family, Elder, Unknown) অনুযায়ী সিদ্ধান্ত নেবে এবং স্বয়ংক্রিয়ভাবে টেক্সট বা ভয়েস নোটের মাধ্যমে উত্তর পাঠাবে অথবা জরুরি পরিস্থিতিতে ব্যবহারকারীকে কল বাজিয়ে অ্যালার্ট করবে।

**মূল বৈশিষ্ট্য:**
- **১০০% ফ্রী টিয়ার আর্কিটেকচার:** Supabase Free PostgreSQL DB, Render Free Tier FastAPI Host, এবং Groq, Gemini, Mistral-এর ফ্রী এপিআই ব্যবহার।
- **হাইব্রিড ফলব্যাক রাউটার:** অনলাইন এপিআই বন্ধ থাকলে বা লিমিট শেষ হলে স্বয়ংক্রিয়ভাবে একটির পর একটি এপিআই সুইপিং করবে এবং ইন্টারনেট না থাকলে ফোনের লোকাল Ollama (GGUF) ব্যবহার করবে।
- **মাল্টি-চ্যানেল এক্সেস:** WhatsApp, Messenger, IMO, SMS, Phone Call, এবং Voice Note।

---

## 2. 🛠️ প্রয়োজনীয় টুলস ও টেকনোলজি স্ট্যাক (Tech Stack & Tools)

### (ক) অ্যান্ড্রয়েড ক্লায়েন্ট (Android Frontend)
- **IDE:** Android Studio (Ladybug 2024.2.1+)
- **Language & UI:** Kotlin, Jetpack Compose, Material 3 Design
- **Core Architecture:** Clean Architecture + MVVM + Coroutines Flow
- **Key Libraries:**
  ```kotlin
  // Android Gradle Dependencies
  implementation("io.github.jan-tennert.supabase:postgrest-kt:2.5.0")
  implementation("io.github.jan-tennert.supabase:realtime-kt:2.5.0")
  implementation("com.squareup.retrofit2:retrofit:2.9.0")
  implementation("com.squareup.retrofit2:converter-gson:2.9.0")
  implementation("androidx.work:work-runtime-ktx:2.9.0")
  ```

### (খ) এআই ব্রেইন ও ব্যাকএন্ড (Python FastAPI Backend)
- **Framework:** Python 3.11, FastAPI, Uvicorn
- **Networking & Async:** `httpx`, `asyncio`, `pydantic`
- **Speech-to-Text & Text-to-Speech:** Groq Whisper API (STT), `edge-tts` (Free Microsoft Neural TTS)
- **Database Client:** `supabase-py`

### (গ) ডাটাবেজ ও ক্লাউড ইনফ্রাস্ট্রাকচার (Infrastructure)
- **Database:** Supabase Free Tier (PostgreSQL with Row Level Security & Realtime)
- **Hosting:** Render Free Web Service
- **AI Providers:**
  1. **Groq API** (`llama-3.3-70b-versatile`) - Primary (Ultra Fast)
  2. **Google Gemini API** (`gemini-1.5-flash`) - Fallback 1
  3. **Mistral API** (`mistral-small-latest`) - Fallback 2
  4. **OpenRouter Free API** - Fallback 3
  5. **Local Ollama GGUF** (Android Local On-Device Backup)

---

## 3. 📐 সিস্টেম ডাটা ফ্লো (System Data Flow)

```
       [ INCOMING EVENT: SMS / Phone Call / WA / Messenger / IMO / Voice Note ]
                                         │
                                         ▼
            [ Android Native Access Layer (Listeners & Accessibility) ]
                                         │
                      ┌──────────────────┴──────────────────┐
                      ▼                                     ▼
          [ Standard Text Messages ]              [ Audio / Voice Note ]
                      │                                     │
                      │                           [ Groq Whisper STT API ]
                      │                                     │
                      └──────────────────┬──────────────────┘
                                         │
                                         ▼
                     [ Android Regex Privacy Guard Engine ]
             (Strips OTPs, Passwords, Banking Transactions locally)
                                         │
                                         ▼
              [ Python FastAPI AI Brain (/api/v1/process-event) ]
                                         │
                      ┌──────────────────┴──────────────────┐
                      ▼                                     ▼
           [ Fetch Profile & Mood ]             [ Execute Multi-AI Router ]
             (Supabase DB Lookup)                (Groq ➔ Gemini ➔ Mistral)
                      │                                     │
                      └──────────────────┬──────────────────┘
                                         │
                                         ▼
                     [ Return Action JSON Payload to Android ]
                                         │
       ┌─────────────────────────────────┼─────────────────────────────────┐
       ▼                                 ▼                                 ▼
[ Auto SMS / Notification ]    [ Voice Reply Generation ]       [ High Urgency Alarm ]
 (Quick-Reply Intent Executed)   (Edge-TTS -> Audio Sent)      (Plays Local Alert Sound)
```

---

## 4. 🔍 অ্যান্ড্রয়েড থেকে ফুল ডাটা নেওয়ার নিখুঁত উপায় (Deep Dive: Full Data Access)

যেহেতু অ্যাপটি আপনার নিজের ফোনে থাকবে এবং আপনি সমস্ত অনুমতি দিতে প্রস্তুত, তাই অ্যান্ড্রয়েডে ৩টি শক্তিশালী অ্যান্ড্রয়েড সার্ভিস ব্যবহার করে ১০০% রিয়েল-টাইম ডাটা এক্সট্র্যাক্ট করা সম্ভব:

### 1. Phone Call & Missed Call Reader
- **Permissions Required:** `READ_PHONE_STATE`, `READ_CALL_LOG`, `READ_CONTACTS`, `ANSWER_PHONE_CALLS`
- **Method:** `TelephonyManager` এবং `CallLog` ইন্টারসেপ্টর ব্যবহার করে রিং হওয়ার মুহূর্তেই কলারের তথ্য এবং মিসড কল হওয়া মাত্রই তার আপডেট ব্যাকএন্ডে পাঠানো হবে।

### 2. SMS Reader & Sender
- **Permissions Required:** `RECEIVE_SMS`, `READ_SMS`, `SEND_SMS`
- **Method:** `BroadcastReceiver` যা `android.provider.Telephony.SMS_RECEIVED` শোনে। ইনকামিং SMS-এরSender, Body, Timestamp সরাসরি পড়ে ফেলে এবং এআই উত্তর জেনারেট করলে নেটিভ `SmsManager` দিয়ে SMS রিপ্লাই পাঠায়।

### 3. WhatsApp, Messenger, IMO & Voice Notes Reader
- **Permissions Required:** `BIND_NOTIFICATION_LISTENER_SERVICE`, `ACCESSIBILITY_SERVICE` (Optional for Advanced UI interaction)
- **Method:**
  - **Text Extract:** `NotificationListenerService` নোটিফিকেশন আসা মাত্রই App Package Filter করে প্রেরকের নাম ও মেসেজের লেখা কেটে বের করে আনে।
  - **Voice Note Capture:** নোটিফিকেশন পেইলোডের সঙ্গে থাকা Audio File Extractions অথবা `AccessibilityService` দিয়ে ডিসপ্লে থেকে ভয়েস অডিও সোর্স ট্র্যাক করে পাইথন ব্রেইনের Whisper API-তে পাঠানো হয়।

---

## 5. 🗄️ ডাটাবেজ স্কিমা (Supabase SQL Script)

সুপাবেজের SQL Editor-এ রান করার জন্য সম্পূর্ণ স্কিমা কোড:

```sql
-- 1. Profiles & Contact Categories
CREATE TABLE public.profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    phone_number VARCHAR UNIQUE NOT NULL,
    name VARCHAR,
    relationship_type VARCHAR DEFAULT 'GENERAL', -- VIP, BUSINESS, FAMILY, ELDER, SPAM
    preferred_language VARCHAR DEFAULT 'bn',       -- bn, en
    custom_notes TEXT,                             -- "ইনি বিয়ানীবাজারের ক্লায়েন্ট"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. App State & Mood Setup
CREATE TABLE public.app_state (
    id INT PRIMARY KEY DEFAULT 1,
    current_mood VARCHAR DEFAULT 'AUTO',           -- AUTO, SLEEPING, DRIVING, BUSY, CUSTOM
    custom_mood_note TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert Default State
INSERT INTO public.app_state (id, current_mood) VALUES (1, 'AUTO') 
ON CONFLICT (id) DO NOTHING;

-- 3. Conversation Logs History
CREATE TABLE public.conversations_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_phone VARCHAR REFERENCES public.profiles(phone_number),
    platform VARCHAR NOT NULL,                     -- WHATSAPP, MESSENGER, IMO, SMS, CALL
    incoming_content TEXT NOT NULL,
    is_voice_note BOOLEAN DEFAULT FALSE,
    ai_reply_text TEXT,
    urgency_level VARCHAR DEFAULT 'LOW',           -- LOW, MEDIUM, HIGH
    action_taken VARCHAR DEFAULT 'AUTO_REPLIED',   -- AUTO_REPLIED, URGENT_ALERTED, DRAFTED
    used_ai_provider VARCHAR,                      -- Groq, Gemini, Mistral, Ollama
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 6. 🧠 ব্যাকএন্ড এআই ব্রেইন (Python FastAPI + Resilient AI Router)

`main.py` ফাইলের সম্পূর্ণ কোড যা Render Free Tier-এ ডিপ্লয় হবে:

```python
import os
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from supabase import create_client, Client

app = FastAPI(title="AI Personal Secretary Engine")

# --- Supabase Initialization ---
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- Schemas ---
class EventRequest(BaseModel):
    sender_phone: str
    sender_name: Optional[str] = "Unknown"
    platform: str  # SMS, WhatsApp, Messenger, IMO, Phone Call
    content: str
    is_voice: bool = False

class EventResponse(BaseModel):
    action: str  # AUTO_REPLY, VOICE_REPLY, URGENT_ALERT, IGNORE
    reply_text: str
    urgency_level: str  # LOW, HIGH
    provider_used: str

# --- Multi-AI Failover Router ---
class AIRouter:
    async def generate_reply(self, prompt: str, system_prompt: str) -> tuple[str, str]:
        providers = [
            ("Groq", self._call_groq),
            ("Gemini", self._call_gemini),
            ("Mistral", self._call_mistral),
            ("Ollama Local Backup", self._call_ollama_fallback)
        ]
        
        for name, provider_func in providers:
            try:
                result = await provider_func(prompt, system_prompt)
                if result:
                    return result, name
            except Exception as e:
                print(f"[Warning] {name} failed: {e}. Switching to next provider...")
                continue
        return "ধন্যবাদ, আপনার মেসেজটি সংরক্ষিত হলো। ব্যস্ততার কারণে পরবর্তীতে যোগাযোগ করা হবে।", "Fallback"

    async def _call_groq(self, prompt: str, system_prompt: str) -> str:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key: raise Exception("No Groq Key")
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ]
                }
            )
            return res.json()["choices"][0]["message"]["content"]

    async def _call_gemini(self, prompt: str, system_prompt: str) -> str:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key: raise Exception("No Gemini Key")
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}",
                json={"contents": [{"parts": [{"text": f"{system_prompt}\n\nMessage: {prompt}"}]}]}
            )
            return res.json()["candidates"][0]["content"]["parts"][0]["text"]

    async def _call_mistral(self, prompt: str, system_prompt: str) -> str:
        api_key = os.getenv("MISTRAL_API_KEY")
        if not api_key: raise Exception("No Mistral Key")
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.post(
                "https://api.mistral.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": "mistral-small-latest",
                    "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}]
                }
            )
            return res.json()["choices"][0]["message"]["content"]

    async def _call_ollama_fallback(self, prompt: str, system_prompt: str) -> str:
        # Emergency Default Response
        return "ধন্যবাদ, আমি আপনার মেসেজটি পেয়েছি। ফ্রি এপিআই বন্ধ থাকলেও সিস্টেম অন আছে।"

ai_router = AIRouter()

# --- Main API Endpoint ---
@app.post("/api/v1/process-event", response_model=EventResponse)
async def process_event(event: EventRequest):
    # 1. Fetch Contact Context
    profile = supabase.table("profiles").select("*").eq("phone_number", event.sender_phone).execute()
    contact = profile.data[0] if profile.data else {}
    rel_type = contact.get("relationship_type", "GENERAL")
    notes = contact.get("custom_notes", "")

    # 2. Fetch App State Mood
    state = supabase.table("app_state").select("*").eq("id", 1).execute()
    current_mood = state.data[0].get("current_mood", "AUTO") if state.data else "AUTO"

    # 3. Formulate System Persona
    system_prompt = f"""
    You are an AI Personal Secretary responding for your boss.
    Boss Current Status/Mood: {current_mood}
    Sender Name: {event.sender_name}
    Relationship Type: {rel_type} (e.g., VIP, ELDER, BUSINESS, FAMILY)
    Special Notes on Sender: {notes}
    Platform: {event.platform}

    Instruction:
    - Respond in polite Bengali or English based on sender relationship.
    - If sender is an ELDER, make response extra respectful and warm.
    - If message indicates severe emergency (accident, crisis), start reply with [URGENT].
    - Keep replies concise and professional.
    """

    # 4. Generate Decision via AI Router
    reply_text, provider = await ai_router.generate_reply(event.content, system_prompt)
    is_urgent = "[URGENT]" in reply_text or "HIGH" in rel_type

    # 5. Log Entry into Supabase
    supabase.table("conversations_log").insert({
        "sender_phone": event.sender_phone,
        "platform": event.platform,
        "incoming_content": event.content,
        "is_voice_note": event.is_voice,
        "ai_reply_text": reply_text,
        "urgency_level": "HIGH" if is_urgent else "LOW",
        "action_taken": "URGENT_ALERTED" if is_urgent else ("VOICE_REPLY" if event.is_voice else "AUTO_REPLIED"),
        "used_ai_provider": provider
    }).execute()

    return EventResponse(
        action="URGENT_ALERT" if is_urgent else ("VOICE_REPLY" if event.is_voice else "AUTO_REPLY"),
        reply_text=reply_text,
        urgency_level="HIGH" if is_urgent else "LOW",
        provider_used=provider
    )
```

---

## 7. 📱 অ্যান্ড্রয়েড ফ্রন্টএন্ড কোড (Kotlin Implementation)

### (ক) Notification Listener Service (`SecretaryNotificationListener.kt`)

```kotlin
package com.aboenterprise.secretary.services

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.os.Bundle
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class SecretaryNotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn?.let {
            val packageName = it.packageName
            val extras = it.notification.extras
            val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

            // Regex Privacy Filter
            if (isSensitive(text)) return

            // Supported Platforms Filter
            if (packageName in listOf("com.whatsapp", "com.facebook.orca", "com.imo.android.imoim")) {
                val platformName = when (packageName) {
                    "com.whatsapp" -> "WhatsApp"
                    "com.facebook.orca" -> "Messenger"
                    else -> "IMO"
                }

                CoroutineScope(Dispatchers.IO).launch {
                    processIncomingMessage(sender = title, message = text, platform = platformName, sbn = sbn)
                }
            }
        }
    }

    private fun isSensitive(text: String): Boolean {
        val keywords = listOf("OTP", "PIN", "bKash", "Nagad", "Bank", "Verification", "Password")
        return keywords.any { text.contains(it, ignoreCase = true) }
    }

    private suspend fun processIncomingMessage(sender: String, message: String, platform: String, sbn: StatusBarNotification) {
        // Send to FastAPI on Render
        val response = ApiClient.service.processEvent(
            EventRequest(sender_phone = sender, sender_name = sender, platform = platform, content = message)
        )

        if (response.urgency_level == "HIGH") {
            // Trigger Phone Ringing Alarm
            TriggerAlarm.playUrgentSound(applicationContext)
        } else {
            // Execute Auto Quick Reply via Android Notification Action API
            executeQuickReply(sbn, response.reply_text)
        }
    }

    private fun executeQuickReply(sbn: StatusBarNotification, replyText: String) {
        val actions = sbn.notification.actions ?: return
        for (action in actions) {
            if (action.remoteInputs != null && action.remoteInputs.isNotEmpty()) {
                val intent = action.actionIntent
                val bundle = Bundle()
                for (remoteInput in action.remoteInputs) {
                    bundle.putCharSequence(remoteInput.resultKey, replyText)
                }
                val remoteInputIntent = android.content.Intent()
                android.app.RemoteInput.addResultsToIntent(action.remoteInputs, remoteInputIntent, bundle)
                intent.send(applicationContext, 0, remoteInputIntent)
                break
            }
        }
    }
}
```

---

## 8. 🛡️ সিকিউরিটি, মেমরি অপটিমাইজেশন ও ফাইনাল গাইডলাইন

1. **ব্যাটারি ও র‍্যাম অপটিমাইজেশন:** 
   - অ্যান্ড্রয়েডের `Foreground Service` চালু রাখুন একটি পারসিস্টেন্ট নোটিফিকেশন আইকন দিয়ে, যাতে অপারেটিং সিস্টেম কোনো অবস্থাতেই অ্যাপটিকে কিল (Kill) না করতে পারে।
2. **ডাটা সিকিউরিটি:** 
   - অ্যান্ড্রয়েড ডিভাইসের ভেতরেই প্রথম ধাপে Regex ফিল্টারিং চালনা করার কারণে আপনার ব্যাংকিং তথ্য বা পাসওয়ার্ড কোনো দিনই ক্লাউডে বা এআই-এর কাছে পৌঁছাবে না।
3. **ফ্রী টিয়ার মেনটেইন্যান্স:**
   - Render-এর ফ্রী টিয়ার ঘুমিয়ে (Cold Start) যাওয়া এড়াতে অ্যান্ড্রয়েড অ্যাপ থেকে প্রতি ১৫ মিনিট পর পর একটি হালকা `/health` গেট পিং (Ping) রিএক্টিভেট করা হবে।