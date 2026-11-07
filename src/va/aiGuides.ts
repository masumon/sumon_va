/**
 * "How to get a key" for every AI provider: link, what you need, Bangla steps, what the key starts with.
 * Copied from the ABO admin (masumon/abo-enterprise frontend/src/lib/aiHub.ts, 2026-11-07) so the phone app
 * explains it the same way. Ids match the server's provider ids (server/app/assistant/ai_providers.py).
 */
export type ProviderGuide = {
  id: string; name: string; tier: "free" | "paid"; recommended?: boolean; tagline: string; needs: string;
  link: string; linkLabel: string; steps: string[]; keyHint?: string; needsAccount?: boolean; needsBase?: boolean; keyOptional?: boolean;
};

export const PROVIDER_GUIDES: ProviderGuide[] = [
  {
    id: "gemini", name: "Google Gemini", tier: "free", recommended: true,
    tagline: "ফ্রি · বাংলায় সেরা · ছবি বোঝে", needs: "শুধু একটি Gmail অ্যাকাউন্ট — কার্ড বা ফোন লাগে না",
    link: "https://aistudio.google.com/apikey", linkLabel: "Google AI Studio খুলুন",
    steps: ["নিচের বোতামে চাপুন — Google AI Studio খুলবে", "আপনার Gmail দিয়ে লগইন করুন (প্রথমবার শর্তে “রাজি” চাপুন)",
      "“Create API key” চাপুন, তারপর কী-এর পাশের কপি (⧉) বোতাম চাপুন", "এখানে ফিরে “পেস্ট” চাপুন, তারপর “যোগ করুন”"],
    keyHint: "AIza… বা AQ. দিয়ে শুরু",
  },
  {
    id: "groq", name: "Groq", tier: "free", recommended: true,
    tagline: "ফ্রি · খুব দ্রুত", needs: "ইমেইল বা Google অ্যাকাউন্ট — কার্ড লাগে না",
    link: "https://console.groq.com/keys", linkLabel: "Groq Console খুলুন",
    steps: ["নিচের বোতামে চাপুন, Google বা ইমেইল দিয়ে লগইন করুন", "“Create API Key” চাপুন, যেকোনো নাম দিয়ে “Submit”",
      "কী সাথে সাথে কপি করুন — এটা একবারই দেখায়", "এখানে ফিরে “পেস্ট” চাপুন, তারপর “যোগ করুন”"],
    keyHint: "gsk_ দিয়ে শুরু",
  },
  {
    id: "openrouter", name: "OpenRouter", tier: "free", recommended: true,
    tagline: "ফ্রি · এক কী-তে অনেক ফ্রি মডেল", needs: "ইমেইল বা Google অ্যাকাউন্ট — কার্ড লাগে না (দিনে ~৫০ বার ফ্রি)",
    link: "https://openrouter.ai/keys", linkLabel: "OpenRouter খুলুন",
    steps: ["নিচের বোতামে চাপুন, Google বা ইমেইল দিয়ে লগইন করুন", "“Create API Key” চাপুন, নাম দিয়ে “Create”",
      "কী কপি করুন", "এখানে ফিরে “পেস্ট” চাপুন, তারপর “যোগ করুন”"],
    keyHint: "sk-or- দিয়ে শুরু",
  },
  {
    id: "nvidia", name: "NVIDIA", tier: "free",
    tagline: "ফ্রি · ১০০+ বড় মডেল", needs: "ইমেইল — কার্ড লাগে না",
    link: "https://build.nvidia.com/", linkLabel: "NVIDIA Build খুলুন",
    steps: ["নিচের বোতামে চাপুন, “Login” করে অ্যাকাউন্ট খুলুন", "যেকোনো মডেলে চাপুন, তারপর “Get API Key” → “Generate Key”",
      "কী কপি করুন", "এখানে ফিরে “পেস্ট” চাপুন, তারপর “যোগ করুন”"],
    keyHint: "nvapi- দিয়ে শুরু",
  },
  {
    id: "cloudflare", name: "Cloudflare Workers AI", tier: "free", needsAccount: true,
    tagline: "ফ্রি · দিনে ১০,০০০ ইউনিট", needs: "আপনার Cloudflare অ্যাকাউন্ট (আগে থেকেই আছে)",
    link: "https://dash.cloudflare.com/profile/api-tokens", linkLabel: "Cloudflare API Tokens খুলুন",
    steps: ["নিচের বোতামে চাপুন → “Create Token”", "“Workers AI” টেমপ্লেটের পাশে “Use template” → “Continue” → “Create Token”",
      "টোকেন কপি করে নিচের প্রথম ঘরে পেস্ট করুন", "Cloudflare-এর হোম পাতার ডান পাশে “Account ID” কপি করে দ্বিতীয় ঘরে দিন"],
  },
  {
    id: "mistral", name: "Mistral", tier: "free",
    tagline: "ফ্রি মাসিক কোটা", needs: "ইমেইল + ফোন নম্বর যাচাই",
    link: "https://console.mistral.ai/api-keys", linkLabel: "Mistral Console খুলুন",
    steps: ["নিচের বোতামে চাপুন, অ্যাকাউন্ট খুলুন", "ফ্রি “Experiment” প্ল্যান বেছে ফোন নম্বর যাচাই করুন",
      "“Create new key” চাপুন, কী কপি করুন", "এখানে ফিরে “পেস্ট” চাপুন, তারপর “যোগ করুন”"],
  },
  {
    id: "vercel", name: "Vercel AI Gateway", tier: "free",
    tagline: "মাসে $৫ ফ্রি ক্রেডিট · অনেক মডেল", needs: "আপনার Vercel অ্যাকাউন্ট (আগে থেকেই আছে)",
    link: "https://vercel.com/dashboard", linkLabel: "Vercel খুলুন",
    steps: ["নিচের বোতামে চাপুন, উপরের মেনু থেকে “AI Gateway” খুলুন", "“API Keys” → “Create key”",
      "কী কপি করুন", "এখানে ফিরে “পেস্ট” চাপুন, তারপর “যোগ করুন”"],
    keyHint: "vck_ দিয়ে শুরু",
  },
  {
    id: "openai", name: "ChatGPT (OpenAI)", tier: "paid",
    tagline: "পেইড · খুব ভালো মান", needs: "কার্ড দিয়ে কিছু টাকা জমা (Billing)",
    link: "https://platform.openai.com/api-keys", linkLabel: "OpenAI খুলুন",
    steps: ["লগইন করে “Billing”-এ কিছু ক্রেডিট কিনুন", "“API keys” → “Create new secret key”", "কী কপি করুন", "এখানে “পেস্ট” → “যোগ করুন”"],
    keyHint: "sk- দিয়ে শুরু",
  },
  {
    id: "anthropic", name: "Claude (Anthropic)", tier: "paid",
    tagline: "পেইড · লেখায় খুব ভালো", needs: "কার্ড দিয়ে ক্রেডিট কেনা",
    link: "https://console.anthropic.com/settings/keys", linkLabel: "Anthropic Console খুলুন",
    steps: ["লগইন করে “Billing”-এ ক্রেডিট কিনুন", "“Create Key” চাপুন", "কী কপি করুন", "এখানে “পেস্ট” → “যোগ করুন”"],
    keyHint: "sk-ant- দিয়ে শুরু",
  },
  {
    id: "deepseek", name: "DeepSeek", tier: "paid",
    tagline: "পেইড · খুব সস্তা", needs: "অল্প টাকা টপ-আপ",
    link: "https://platform.deepseek.com/api_keys", linkLabel: "DeepSeek খুলুন",
    steps: ["লগইন করে “Top up” করুন", "“Create new API key”", "কী কপি করুন", "এখানে “পেস্ট” → “যোগ করুন”"],
  },
  {
    id: "xai", name: "Grok (xAI)", tier: "paid",
    tagline: "পেইড", needs: "কার্ড দিয়ে ক্রেডিট কেনা",
    link: "https://console.x.ai/", linkLabel: "xAI Console খুলুন",
    steps: ["লগইন করে ক্রেডিট কিনুন", "“API Keys” → “Create API Key”", "কী কপি করুন", "এখানে “পেস্ট” → “যোগ করুন”"],
    keyHint: "xai- দিয়ে শুরু",
  },
  {
    id: "local", name: "নিজের কম্পিউটারের AI", tier: "free", needsBase: true, keyOptional: true,
    tagline: "সীমাহীন ফ্রি · কম্পিউটার চালু থাকলে", needs: "৮–১৬ GB RAM-এর কম্পিউটার + ফ্রি Cloudflare Tunnel",
    link: "https://ollama.com/download", linkLabel: "Ollama ডাউনলোড",
    steps: ["Ollama ইনস্টল করুন, তারপর কমান্ডে লিখুন: ollama pull qwen3:8b (বা gemma3:12b)",
      "cloudflared ইনস্টল করে লিখুন: cloudflared tunnel --url http://localhost:11434",
      "যে https://….trycloudflare.com ঠিকানা দেখাবে, তার শেষে /v1 লাগিয়ে নিচের “ঠিকানা” ঘরে দিন",
      "কী খালি রাখতে পারেন। কম্পিউটার বন্ধ হলে সিস্টেম নিজে অন্য AI ব্যবহার করবে"],
  },
  {
    id: "custom", name: "অন্য যেকোনো (OpenAI-সামঞ্জস্যপূর্ণ)", tier: "free", needsBase: true,
    tagline: "LM Studio, Together, Fireworks ইত্যাদি", needs: "সার্ভারের ঠিকানা (Base URL) ও কী",
    link: "https://lmstudio.ai/", linkLabel: "LM Studio দেখুন",
    steps: ["সেবাটির ড্যাশবোর্ড থেকে API কী ও Base URL কপি করুন", "নিচে ঠিকানা ও কী দিন", "“যোগ করুন” চাপুন — মডেল নিজে খুঁজে নেবে"],
  },
];

export const guideOf = (id: string) => PROVIDER_GUIDES.find((g) => g.id === id);
