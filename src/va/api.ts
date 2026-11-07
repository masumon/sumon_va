import { request } from '../../modules/va-bridge';

/** Everything the app asks of the server goes through here, and through the native bridge: the device token never reaches JavaScript. */
export class VaError extends Error {
  /** 'timeout' = the server is just slow (not a failure); 'offline' = the phone has no internet; 'other' = a real error. */
  constructor(public status: number, message: string, public kind: 'timeout' | 'offline' | 'other' = 'other') { super(message); }
}

type Envelope<T> = { data: T; message?: string };

function networkKind(reason?: string): 'timeout' | 'offline' | 'other' {
  if (reason?.includes('Timeout')) return 'timeout';
  if (reason && (reason.includes('UnknownHost') || reason.includes('ConnectException') || reason.includes('NoRoute') || reason.includes('Network'))) return 'offline';
  return 'other';
}

/** Says what really went wrong instead of a vague "no connection": timeout, no internet, or a secure-connection failure. */
function networkReason(reason?: string): string {
  if (!reason) return 'সার্ভারের সাথে সংযোগ হয়নি';
  if (reason.includes('Timeout')) return 'উত্তর আসতে সময় লাগছে। এটা ত্রুটি নয়, ফ্রি সার্ভার বা AI মাঝে মাঝে সময় নেয়। একটু পরে আবার দেখুন';
  if (reason.includes('UnknownHost') || reason.includes('ConnectException') || reason.includes('NoRoute') || reason.includes('Network')) return 'ফোনে ইন্টারনেট নেই বা দুর্বল। ইন্টারনেট চালু করে আবার চেষ্টা করুন';
  if (reason.includes('SSL') || reason.includes('Certificate')) return 'নিরাপদ সংযোগ হয়নি। ফোনের তারিখ ও সময় ঠিক আছে কি না দেখুন';
  if (reason === 'not paired') return 'এই ফোন এখনও জোড়া লাগানো নেই। আবার ঢুকুন';
  if (reason === 'path not allowed') return 'এই কাজটা অ্যাপ থেকে করা যায় না';
  return `সার্ভারের সাথে সংযোগ হয়নি (${reason})`;
}

// Short cache + shared in-flight request for a few read-only GETs. Errors are never cached; any change (non-GET) clears everything.
const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
export function clearApiCache(): void { cache.clear(); inflight.clear(); }
function cachedGet<T>(path: string, ttlMs: number): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value as T);
  const running = inflight.get(path);
  if (running) return running as Promise<T>;
  const p: Promise<T> = rawCall<T>('GET', path).then((value) => {
    if (inflight.get(path) === p) { cache.set(path, { at: Date.now(), value }); inflight.delete(path); }
    return value;
  }, (e: unknown) => {
    if (inflight.get(path) === p) inflight.delete(path);
    throw e;
  });
  inflight.set(path, p);
  return p;
}

/** A failure the server did not explain, in plain words with what to do (no bare numbers for the owner). */
function plainHttpError(status: number): string {
  if (status === 403) return 'এই কাজের অনুমতি এই ফোনের নেই।';
  if (status === 404) return 'জিনিসটা আর নেই (হয়তো আগেই মুছে গেছে বা পাঠানো হয়ে গেছে)। পাতাটা টেনে নতুন করে দেখুন।';
  if (status === 409) return 'একই কাজ এখন অন্য কোথাও চলছে, একটু পরে আবার চেষ্টা করুন।';
  if (status === 413) return 'লেখা বা ফাইলটা অনেক বড়, ছোট করে আবার দিন।';
  if (status === 422 || status === 400) return 'যা লেখা হয়েছে তা বোঝা যায়নি, ঠিক করে আবার দিন।';
  if (status === 429) return 'অনেকবার চাপা হয়েছে, এক মিনিট পর আবার চেষ্টা করুন।';
  if (status >= 500) return 'সার্ভারে এখন সমস্যা হচ্ছে বা সার্ভার জেগে উঠছে, এক মিনিট পর আবার চেষ্টা করুন।';
  return 'কাজটি হয়নি, একটু পরে আবার চেষ্টা করুন।';
}

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (method === 'GET') return rawCall<T>(method, path, body);
  clearApiCache();
  try { return await rawCall<T>(method, path, body); } finally { clearApiCache(); }
}

async function rawCall<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let r = await request<Envelope<T> & { detail?: unknown }>(method, path, body);
  // A read that only timed out (the free server was waking up) gets one more try before anything is reported.
  if (method === 'GET' && r.status === 0 && networkKind(r.reason) === 'timeout') r = await request<Envelope<T> & { detail?: unknown }>(method, path, body);
  if (r.status === 0) throw new VaError(0, networkReason(r.reason), networkKind(r.reason));
  if (r.status === 401) throw new VaError(401, 'এই ফোনের অনুমতি বাতিল হয়েছে বা মেয়াদ শেষ। আবার জোড়া লাগান');
  if (r.status < 200 || r.status >= 300) {
    const detail = (r.data as { detail?: unknown } | null)?.detail;
    throw new VaError(r.status, typeof detail === 'string' ? detail : plainHttpError(r.status));
  }
  return (r.data as Envelope<T>).data;
}

export type Channel = 'whatsapp' | 'telegram' | 'sms' | 'notif' | 'email' | 'webhook';
export type View = 'all' | 'urgent' | 'waiting' | 'drafts' | 'failed' | 'owner' | 'done' | 'blocked' | 'family' | 'vip' | 'work' | 'business' | 'personal' | 'social' | 'spam';

export type Tag = { label: string; value: string; important: boolean };
export type Category = 'business' | 'personal' | 'social' | 'spam';

export type Contact = {
  id: string; channel: Channel; category: Category | null; tags: Tag[]; phone: string; name: string | null; relation: string | null; mode: 'inherit' | 'auto' | 'draft' | 'notify' | 'telegram';
  is_vip: boolean; is_family: boolean; is_blocked: boolean; state: 'assistant' | 'owner' | 'done'; priority: number;
  need: string | null; summary: string | null; unread: number; last_message_at: string | null; preview: string;
};

export type Message = {
  id: string; direction: 'in' | 'out'; kind: string; body: string | null; transcript: string | null;
  status: 'received' | 'draft' | 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | 'discarded'; reason: string | null;
  error: string | null; created_at: string | null; note: string | null; tag: string | null; delivery: string | null;
};

export type Overview = {
  enabled: boolean; mode: 'auto' | 'shadow'; waiting: number; urgent: number; drafts: number; queued: number; failed_24h: number;
  tasks_open: number; tasks_late: number;
  alerts_held?: { count: number; items: { who: string; p: number; why: string; ts: string }[] };
  presence?: { state: 'active' | 'idle' | 'still' | 'moving' | 'unknown'; seen_at: string | null };
};

export type Limits = { urgent_per_day: number; quiet_from: string; quiet_to: string; quiet_urgent_only: boolean };

export type ChannelsInfo = {
  kill_switch_on: boolean; limits: Limits;
  channels: { key: Channel; label: string; can_auto: boolean; icon: string; messages: number }[];
  settings: { telegram: { enabled: boolean; auto: boolean }; device: { enabled: boolean; auto_sms: boolean }; email?: { enabled: boolean } };
  email?: { configured: boolean; inbound_configured?: boolean };
  telegram: { configured: boolean; owner_set: boolean; secret_set: boolean; bot?: string; url?: string; pending?: number; last_error?: string; error?: string };
  devices: { id: string; name: string; paired_at: string; last_seen_at: string | null; revoked: boolean }[];
};

export type Task = { id: string; title: string; due_at: string | null; is_done: boolean; source: string; contact_name?: string | null; contact_phone?: string | null; proposed?: boolean };

export type StatusDef = { key: string; label: string; say: string; say_en?: string };
export type ScheduleBlock = { days: number[]; from: string; to: string; status: string };
export type SavedPlace = { key: string; label: string; say: string; lat: number; lng: number; radius_m: number };
export type AssistantConfig = {
  enabled: boolean; mode: 'auto' | 'shadow'; assistant_name: string; owner_name: string; reply_by: string;
  status: { key: string; until: string | null; custom: string; source?: string }; statuses: StatusDef[];
  schedule?: ScheduleBlock[]; places?: SavedPlace[]; status_now?: { key: string; source?: string; label?: string };
  categories: Record<Category, { auto?: boolean; silent?: boolean }>;
  delay: { min: number; max: number }; hold_hours: number; quiet_after_reply_min: number; per_sender_hour: number; retention_days: number;
  notify: { urgent: boolean; digest: boolean; digest_time: string }; ai: { enabled: boolean; voice: boolean }; f0?: { auto_send: boolean };
  calls?: { burst_min: number; escalate_after: number; reply: boolean };
  grouping?: { window_min: number };
  reminders?: { unanswered_min: number; only_important: boolean; task_lead_min: number };
  limits?: Limits;
  promo?: { enabled: boolean; allow: string[]; block: string[] };
};

export type HubModel = { id: string; label?: string; free?: boolean };
export type HubConn = {
  id: string; provider: string; label: string; hint: string; base_url: string; enabled: boolean; tier: 'free' | 'paid';
  status: 'ok' | 'bad' | 'limit' | 'new' | 'error'; note: string; checked_at: string; resting_until: string; used_today: number; models: HubModel[];
};
export type HubTask = 'chat' | 'translate' | 'vision' | 'writing' | 'json';
export type HubPrefs = { allow_paid: boolean; paid_daily_cap: number; tasks: Partial<Record<HubTask, string>> };
export type HubSummary = {
  enabled: boolean; connections: HubConn[]; prefs: HubPrefs; today: { count: number; paid: number };
  best: Record<HubTask, string>; last_error: { text: string; at: string }; working: number;
};

export type IdentityRef = { id: string; name: string; channel: string; key: string };
export type IdentitySuggestion = { a: IdentityRef; b: IdentityRef; level: 'high' | 'medium'; reasons: string[] };
export type Fact = {
  id: string; text: string; source: string; confidence: 'high' | 'medium' | 'low';
  provenance: 'owner' | 'ai' | 'imported' | 'platform'; status: 'active' | 'disputed' | 'superseded' | 'corrected'; at: string;
};
export type RelationshipObservation = { text: string; confidence: 'high' | 'medium' | 'low'; basis: string };
export type HistoryReport = {
  found: number; imported: number; duplicates: number; skipped_old?: number; skipped_period?: number; truncated?: boolean; note?: string;
  need_consent?: boolean; need_owner?: boolean; speakers?: string[];
};
export type F0Draft = { id: string; to: string; channel: string; body: string; warnings: string[] };
export type F0Result = {
  intent: 'reply' | 'task_status' | 'missed_calls' | 'pending' | 'tasks' | 'person' | 'memory' | 'search' | 'alerts' | 'drafts' | 'history' | 'system' | 'rules' | 'unknown';
  answer: string; items: { title: string; subtitle?: string; contact_id?: string }[];
  choices: { contact_id: string; label: string }[]; draft: F0Draft | null;
  /** Present when auto mode sent it at once: the message's own stored status. */
  sent?: { status: string; error?: string | null };
};

/** How to show an error: a slow answer is only a note, everything else is a real error. */
export const errTone = (e: unknown): 'info' | 'danger' => (e instanceof VaError && e.kind === 'timeout' ? 'info' : 'danger');

export const va = {
  loginPhone: () => call<{ set: boolean; masked: string }>('GET', '/admin/inbox/login-phone'),
  setLoginPhone: (phone: string) => call<{ set: boolean; masked: string }>('PUT', '/admin/inbox/login-phone', { phone }),
  tasks: (show: 'open' | 'done' = 'open') => call<Task[]>('GET', `/admin/wa/tasks?show=${show}`),
  addTask: (title: string, due_at?: string, contact_id?: string) => call<unknown>('POST', '/admin/wa/tasks', { title, due_at, contact_id }),
  sentByHand: (id: string, text: string) => call<unknown>('POST', `/admin/wa/contacts/${id}/sent-by-hand`, { text }),
  clearChat: (id: string) => call<{ removed: number }>('POST', `/admin/inbox/contacts/${id}/clear`, {}),
  toggleTask: (id: string) => call<unknown>('POST', `/admin/wa/tasks/${id}/toggle`),
  removeTask: (id: string) => call<unknown>('DELETE', `/admin/wa/tasks/${id}`),
  addNote: (contactId: string, text: string) => call<unknown>('POST', `/admin/wa/contacts/${contactId}/notes`, { text }),
  removeNote: (noteId: string) => call<unknown>('DELETE', `/admin/wa/notes/${noteId}`),
  assistantConfig: () => call<{ config: AssistantConfig }>('GET', '/admin/wa/config'),
  saveAssistantConfig: (config: Record<string, unknown>) => call<unknown>('PUT', '/admin/wa/config', { config }),
  aiHub: () => cachedGet<HubSummary>('/admin/ai-hub', 20000),
  aiAdd: (d: { key: string; provider: string; base_url?: string; account_id?: string; label?: string }) => call<HubConn>('POST', '/admin/ai-hub/connections', d),
  aiTest: (id: string) => call<HubConn>('POST', `/admin/ai-hub/connections/${id}/test`, {}),
  aiPatch: (id: string, d: { enabled?: boolean; move?: -1 | 0 | 1; tier?: 'free' | 'paid' }) => call<HubConn>('PATCH', `/admin/ai-hub/connections/${id}`, d),
  aiRemove: (id: string) => call<unknown>('DELETE', `/admin/ai-hub/connections/${id}`),
  aiPrefs: (d: Partial<HubPrefs>) => call<HubPrefs>('PUT', '/admin/ai-hub/prefs', d),
  aiTestAll: () => call<HubConn[]>('POST', '/admin/ai-hub/test-all', {}),
  aiTry: (task: HubTask, text: string) => call<{ text: string; provider?: string; model?: string }>('POST', '/admin/ai-hub/try', { task, text }),
  exportChat: (id: string) => call<{ filename: string; text: string; messages: number }>('GET', `/admin/wa/contacts/${id}/export`),
  learnChat: (id: string, chat_text: string, owner_speaker?: string, consent_private = false) =>
    call<{ need_owner?: boolean; speakers?: string[]; need_consent?: boolean; profile?: Record<string, unknown>; messages?: number }>('POST', `/admin/wa/contacts/${id}/learn`, { chat_text, owner_speaker, consent_private }),
  report: (days = 7) => call<{ days: number; counts: Record<string, number>; per_day: { day: string; in: number; out: number }[]; by_reason: Record<string, number>; avg_reply_seconds: number | null; approval_rate: number | null }>('GET', `/admin/wa/report?days=${days}`),
  simulate: (text: string, name = '', use_ai = true) => call<{ reply: string | null; reason: string; priority: number; kind: string; summary: string; need: string; notify: boolean; action: 'send' | 'draft' | 'silent'; note: string; ai_used: boolean }>('POST', '/admin/wa/simulate', { text, name, use_ai }),
  emailFilter: () => call<{ mode: 'important' | 'all'; allow: string[]; block: string[]; dropped_today: number }>('GET', '/admin/inbox/email-filter'),
  logout: () => call<unknown>('POST', '/device/logout', {}),

  overview: () => cachedGet<Overview>('/admin/wa/overview', 8000),
  contacts: (view: View, q = '', page = 1, src: string[] = []) =>
    call<{ items: Contact[]; total: number; page: number }>('GET', `/admin/wa/contacts?view=${view}&q=${encodeURIComponent(q)}&page=${page}&src=${encodeURIComponent(src.join(','))}`),
  business: () => call<{ available?: boolean; pending_orders: number; pending_bookings: number; new_leads: number; new_applications: number }>('GET', '/admin/inbox/business'),
  contact: (id: string) => call<{ contact: Contact; messages: Message[]; notes: { id: string; text: string }[]; tasks: { id: string; title: string; is_done: boolean }[] }>('GET', `/admin/wa/contacts/${id}`),
  patchContact: (id: string, patch: Partial<Pick<Contact, 'name' | 'relation' | 'mode' | 'is_vip' | 'is_family' | 'is_blocked' | 'state' | 'category' | 'tags'>>) => call<unknown>('PATCH', `/admin/wa/contacts/${id}`, patch),
  reply: (id: string, text: string) => call<unknown>('POST', `/admin/wa/contacts/${id}/reply`, { text }),
  suggest: (id: string, instruction = '') => call<{ text?: string; reply?: string }>('POST', `/admin/wa/contacts/${id}/suggest`, { instruction }),
  approve: (mid: string, text?: string) => call<unknown>('POST', `/admin/wa/messages/${mid}/approve`, text ? { text } : undefined),
  discard: (mid: string) => call<unknown>('POST', `/admin/wa/messages/${mid}/discard`),
  confirmTask: (id: string) => call<unknown>('POST', `/admin/wa/tasks/${id}/confirm`, {}),
  taskProgress: (id: string, d: { status?: string; progress?: string; blocker?: string }) => call<unknown>('POST', `/admin/wa/tasks/${id}/progress`, d),
  identitySuggestions: () => call<IdentitySuggestion[]>('GET', '/admin/wa/identity/suggestions'),
  identityLink: (contact_ids: string[]) => call<unknown>('POST', '/admin/wa/identity/link', { contact_ids }),
  identityUnlink: (contactId: string) => call<unknown>('POST', `/admin/wa/identity/unlink/${contactId}`, {}),
  identityOf: (contactId: string) => call<{ linked: IdentityRef[] }>('GET', `/admin/wa/contacts/${contactId}/identity`),
  facts: (contactId: string) => call<Fact[]>('GET', `/admin/wa/contacts/${contactId}/facts`),
  addFact: (contactId: string, text: string) => call<unknown>('POST', `/admin/wa/contacts/${contactId}/facts`, { text }),
  correctFact: (contactId: string, fid: string, text: string) => call<unknown>('POST', `/admin/wa/contacts/${contactId}/facts/${fid}/correct`, { text }),
  removeFact: (contactId: string, fid: string) => call<unknown>('DELETE', `/admin/wa/contacts/${contactId}/facts/${fid}`),
  smsImport: (items: { a: string; b: string; t: number; k: number }[], days: number) =>
    call<{ people: number; found: number; imported: number; duplicates: number; promotions_left_out: number }>('POST', '/admin/wa/sms/import', { items, days }),
  clearSpam: () => call<{ messages: number; people: number }>('POST', '/admin/wa/spam/clear', {}),
  aliases: (contactId: string) => call<{ aliases: string[] }>('GET', `/admin/wa/contacts/${contactId}/aliases`),
  setAliases: (contactId: string, aliases: string[]) => call<{ aliases: string[] }>('PUT', `/admin/wa/contacts/${contactId}/aliases`, { aliases }),
  relationship: (contactId: string) => call<{ observations: RelationshipObservation[] }>('GET', `/admin/wa/contacts/${contactId}/relationship`),
  importHistory: (id: string, chat_text: string, owner_speaker: string | undefined, days: number, consent_private: boolean) =>
    call<HistoryReport>('POST', `/admin/wa/contacts/${id}/import-history`, { chat_text, owner_speaker, days, consent_private }),
  f0Command: (text: string) => call<F0Result>('POST', '/admin/wa/f0/command', { text }),
  channels: () => cachedGet<ChannelsInfo>('/admin/inbox/channels', 8000),
  killSwitch: (on: boolean) => call<{ kill_switch_on: boolean }>('POST', '/admin/inbox/kill-switch', { on }),
  config: () => call<Record<string, unknown>>('GET', '/admin/wa/config'),
  saveConfig: (config: Record<string, unknown>) => call<unknown>('PUT', '/admin/wa/config', { config }),
};
