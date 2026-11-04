import { request } from '../../modules/va-bridge';

/** Everything the app asks of the server goes through here, and through the native bridge: the device token never reaches JavaScript. */
export class VaError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Envelope<T> = { data: T; message?: string };

/** Says what really went wrong instead of a vague "no connection": timeout, no internet, or a secure-connection failure. */
function networkReason(reason?: string): string {
  if (!reason) return 'সার্ভারের সাথে সংযোগ হয়নি';
  if (reason.includes('Timeout')) return 'সার্ভার সময়মতো উত্তর দেয়নি। ফ্রি সার্ভার ঘুম থেকে উঠতে বা AI পরীক্ষায় একটু বেশি সময় নেয়। আধ মিনিট পরে আবার চেষ্টা করুন';
  if (reason.includes('UnknownHost') || reason.includes('ConnectException') || reason.includes('NoRoute') || reason.includes('Network')) return 'ফোনে ইন্টারনেট নেই বা দুর্বল। ইন্টারনেট চালু করে আবার চেষ্টা করুন';
  if (reason.includes('SSL') || reason.includes('Certificate')) return 'নিরাপদ সংযোগ হয়নি। ফোনের তারিখ ও সময় ঠিক আছে কি না দেখুন';
  if (reason === 'not paired') return 'এই ফোন এখনও জোড়া লাগানো নেই। আবার ঢুকুন';
  if (reason === 'path not allowed') return 'এই কাজটা অ্যাপ থেকে করা যায় না';
  return `সার্ভারের সাথে সংযোগ হয়নি (${reason})`;
}

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const r = await request<Envelope<T> & { detail?: unknown }>(method, path, body);
  if (r.status === 0) throw new VaError(0, networkReason(r.reason));
  if (r.status === 401) throw new VaError(401, 'এই ফোনের অনুমতি বাতিল হয়েছে বা মেয়াদ শেষ। আবার জোড়া লাগান');
  if (r.status < 200 || r.status >= 300) {
    const detail = (r.data as { detail?: unknown } | null)?.detail;
    throw new VaError(r.status, typeof detail === 'string' ? detail : `কাজটি হয়নি (${r.status})`);
  }
  return (r.data as Envelope<T>).data;
}

export type Channel = 'whatsapp' | 'telegram' | 'sms' | 'notif' | 'email' | 'webhook';
export type View = 'all' | 'urgent' | 'waiting' | 'drafts' | 'owner' | 'done' | 'blocked' | 'family' | 'vip' | 'work' | 'business' | 'personal' | 'social' | 'spam';

export type Tag = { label: string; value: string; important: boolean };
export type Category = 'business' | 'personal' | 'social' | 'spam';

export type Contact = {
  id: string; channel: Channel; category: Category | null; tags: Tag[]; phone: string; name: string | null; relation: string | null; mode: 'inherit' | 'auto' | 'draft' | 'notify';
  is_vip: boolean; is_family: boolean; is_blocked: boolean; state: 'assistant' | 'owner' | 'done'; priority: number;
  need: string | null; summary: string | null; unread: number; last_message_at: string | null; preview: string;
};

export type Message = {
  id: string; direction: 'in' | 'out'; kind: string; body: string | null; transcript: string | null;
  status: 'received' | 'draft' | 'queued' | 'sent' | 'failed' | 'skipped' | 'discarded'; reason: string | null;
  error: string | null; created_at: string | null; note: string | null; tag: string | null; delivery: string | null;
};

export type Overview = {
  enabled: boolean; mode: 'auto' | 'shadow'; waiting: number; urgent: number; drafts: number; queued: number; failed_24h: number;
  tasks_open: number; tasks_late: number;
  presence?: { state: 'active' | 'idle' | 'still' | 'moving' | 'unknown'; seen_at: string | null };
};

export type Limits = { urgent_per_day: number; quiet_from: string; quiet_to: string; quiet_urgent_only: boolean };

export type ChannelsInfo = {
  kill_switch_on: boolean; limits: Limits;
  channels: { key: Channel; label: string; can_auto: boolean; icon: string; messages: number }[];
  settings: { telegram: { enabled: boolean; auto: boolean }; device: { enabled: boolean; auto_sms: boolean } };
  telegram: { configured: boolean; owner_set: boolean; secret_set: boolean; bot?: string; url?: string; pending?: number; last_error?: string; error?: string };
  devices: { id: string; name: string; paired_at: string; last_seen_at: string | null; revoked: boolean }[];
};

export type Task = { id: string; title: string; due_at: string | null; is_done: boolean; source: string; contact_name?: string | null; contact_phone?: string | null };

export type StatusDef = { key: string; label: string; say: string };
export type AssistantConfig = {
  enabled: boolean; mode: 'auto' | 'shadow'; assistant_name: string; owner_name: string; reply_by: string;
  status: { key: string; until: string | null; custom: string }; statuses: StatusDef[];
  categories: Record<Category, { auto?: boolean; silent?: boolean }>;
  delay: { min: number; max: number }; hold_hours: number; quiet_after_reply_min: number; per_sender_hour: number; retention_days: number;
  notify: { urgent: boolean; digest: boolean; digest_time: string }; ai: { enabled: boolean; voice: boolean };
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

export const va = {
  loginPhone: () => call<{ set: boolean; masked: string }>('GET', '/admin/inbox/login-phone'),
  setLoginPhone: (phone: string) => call<{ set: boolean; masked: string }>('PUT', '/admin/inbox/login-phone', { phone }),
  tasks: (show: 'open' | 'done' = 'open') => call<Task[]>('GET', `/admin/wa/tasks?show=${show}`),
  addTask: (title: string, due_at?: string, contact_id?: string) => call<unknown>('POST', '/admin/wa/tasks', { title, due_at, contact_id }),
  clearChat: (id: string) => call<{ removed: number }>('POST', `/admin/inbox/contacts/${id}/clear`, {}),
  toggleTask: (id: string) => call<unknown>('POST', `/admin/wa/tasks/${id}/toggle`),
  removeTask: (id: string) => call<unknown>('DELETE', `/admin/wa/tasks/${id}`),
  addNote: (contactId: string, text: string) => call<unknown>('POST', `/admin/wa/contacts/${contactId}/notes`, { text }),
  removeNote: (noteId: string) => call<unknown>('DELETE', `/admin/wa/notes/${noteId}`),
  assistantConfig: () => call<{ config: AssistantConfig }>('GET', '/admin/wa/config'),
  saveAssistantConfig: (config: Record<string, unknown>) => call<unknown>('PUT', '/admin/wa/config', { config }),
  aiHub: () => call<HubSummary>('GET', '/admin/ai-hub'),
  aiAdd: (d: { key: string; provider: string; base_url?: string; label?: string }) => call<HubConn>('POST', '/admin/ai-hub/connections', d),
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
  waHealth: (remote = false) => call<{ summary: string; ok: number; bad: number; todo: number; items: { key: string; title: string; state: 'ok' | 'bad' | 'todo' | 'warn'; detail: string; fix: { label: string; href?: string } | null }[] }>('GET', `/admin/wa/health?remote=${remote}`),
  simulate: (text: string, name = '', use_ai = true) => call<{ reply: string | null; reason: string; priority: number; kind: string; summary: string; need: string; notify: boolean; action: 'send' | 'draft' | 'silent'; note: string; ai_used: boolean }>('POST', '/admin/wa/simulate', { text, name, use_ai }),
  emailFilter: () => call<{ mode: 'important' | 'all'; allow: string[]; block: string[]; dropped_today: number }>('GET', '/admin/inbox/email-filter'),
  logout: () => call<unknown>('POST', '/device/logout', {}),

  overview: () => call<Overview>('GET', '/admin/wa/overview'),
  contacts: (view: View, q = '', page = 1, src: string[] = []) =>
    call<{ items: Contact[]; total: number; page: number }>('GET', `/admin/wa/contacts?view=${view}&q=${encodeURIComponent(q)}&page=${page}&src=${encodeURIComponent(src.join(','))}`),
  business: () => call<{ pending_orders: number; pending_bookings: number; new_leads: number; new_applications: number }>('GET', '/admin/inbox/business'),
  contact: (id: string) => call<{ contact: Contact; messages: Message[]; notes: { id: string; text: string }[]; tasks: { id: string; title: string; is_done: boolean }[] }>('GET', `/admin/wa/contacts/${id}`),
  patchContact: (id: string, patch: Partial<Pick<Contact, 'name' | 'relation' | 'mode' | 'is_vip' | 'is_family' | 'is_blocked' | 'state' | 'category' | 'tags'>>) => call<unknown>('PATCH', `/admin/wa/contacts/${id}`, patch),
  reply: (id: string, text: string) => call<unknown>('POST', `/admin/wa/contacts/${id}/reply`, { text }),
  suggest: (id: string, instruction = '') => call<{ text?: string; reply?: string }>('POST', `/admin/wa/contacts/${id}/suggest`, { instruction }),
  approve: (mid: string, text?: string) => call<unknown>('POST', `/admin/wa/messages/${mid}/approve`, text ? { text } : undefined),
  discard: (mid: string) => call<unknown>('POST', `/admin/wa/messages/${mid}/discard`),
  channels: () => call<ChannelsInfo>('GET', '/admin/inbox/channels'),
  killSwitch: (on: boolean) => call<{ kill_switch_on: boolean }>('POST', '/admin/inbox/kill-switch', { on }),
  config: () => call<Record<string, unknown>>('GET', '/admin/wa/config'),
  saveConfig: (config: Record<string, unknown>) => call<unknown>('PUT', '/admin/wa/config', { config }),
};
