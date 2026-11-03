import { request } from '../../modules/va-bridge';

/** Everything the app asks of the server goes through here, and through the native bridge: the device token never reaches JavaScript. */
export class VaError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Envelope<T> = { data: T; message?: string };

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const r = await request<Envelope<T> & { detail?: unknown }>(method, path, body);
  if (r.status === 0) throw new VaError(0, 'ইন্টারনেট বা সার্ভারে সংযোগ নেই');
  if (r.status === 401) throw new VaError(401, 'এই ফোনের অনুমতি বাতিল বা মেয়াদ শেষ — আবার জোড়া লাগান');
  if (r.status < 200 || r.status >= 300) {
    const detail = (r.data as { detail?: unknown } | null)?.detail;
    throw new VaError(r.status, typeof detail === 'string' ? detail : `কাজটি হয়নি (${r.status})`);
  }
  return (r.data as Envelope<T>).data;
}

export type Channel = 'whatsapp' | 'telegram' | 'sms' | 'notif' | 'email' | 'webhook';
export type View = 'all' | 'urgent' | 'waiting' | 'drafts' | 'owner' | 'done' | 'blocked';

export type Contact = {
  id: string; channel: Channel; phone: string; name: string | null; relation: string | null; mode: 'inherit' | 'auto' | 'draft' | 'notify';
  is_vip: boolean; is_family: boolean; is_blocked: boolean; state: 'assistant' | 'owner' | 'done'; priority: number;
  need: string | null; summary: string | null; unread: number; last_message_at: string | null; preview: string;
};

export type Message = {
  id: string; direction: 'in' | 'out'; kind: string; body: string | null; transcript: string | null;
  status: 'received' | 'draft' | 'queued' | 'sent' | 'failed' | 'skipped' | 'discarded'; reason: string | null;
  error: string | null; created_at: string | null; note: string | null; tag: string | null;
};

export type Overview = {
  enabled: boolean; mode: 'auto' | 'shadow'; waiting: number; urgent: number; drafts: number; queued: number; failed_24h: number;
  tasks_open: number; tasks_late: number;
};

export type Limits = { urgent_per_day: number; quiet_from: string; quiet_to: string; quiet_urgent_only: boolean };

export type ChannelsInfo = {
  kill_switch_on: boolean; limits: Limits;
  channels: { key: Channel; label: string; can_auto: boolean; icon: string; messages: number }[];
  settings: { telegram: { enabled: boolean; auto: boolean }; device: { enabled: boolean; auto_sms: boolean } };
  telegram: { configured: boolean; owner_set: boolean; secret_set: boolean; bot?: string; url?: string; pending?: number; last_error?: string; error?: string };
  devices: { id: string; name: string; paired_at: string; last_seen_at: string | null; revoked: boolean }[];
};

export const va = {
  overview: () => call<Overview>('GET', '/admin/wa/overview'),
  contacts: (view: View, q = '', page = 1) =>
    call<{ items: Contact[]; total: number; page: number }>('GET', `/admin/wa/contacts?view=${view}&q=${encodeURIComponent(q)}&page=${page}`),
  contact: (id: string) => call<{ contact: Contact; messages: Message[]; notes: { id: string; text: string }[]; tasks: { id: string; title: string; is_done: boolean }[] }>('GET', `/admin/wa/contacts/${id}`),
  patchContact: (id: string, patch: Partial<Pick<Contact, 'name' | 'relation' | 'mode' | 'is_vip' | 'is_family' | 'is_blocked' | 'state'>>) => call<unknown>('PATCH', `/admin/wa/contacts/${id}`, patch),
  reply: (id: string, text: string) => call<unknown>('POST', `/admin/wa/contacts/${id}/reply`, { text }),
  suggest: (id: string, instruction = '') => call<{ text?: string; reply?: string }>('POST', `/admin/wa/contacts/${id}/suggest`, { instruction }),
  approve: (mid: string, text?: string) => call<unknown>('POST', `/admin/wa/messages/${mid}/approve`, text ? { text } : undefined),
  discard: (mid: string) => call<unknown>('POST', `/admin/wa/messages/${mid}/discard`),
  channels: () => call<ChannelsInfo>('GET', '/admin/inbox/channels'),
  killSwitch: (on: boolean) => call<{ kill_switch_on: boolean }>('POST', '/admin/inbox/kill-switch', { on }),
  config: () => call<Record<string, unknown>>('GET', '/admin/wa/config'),
  saveConfig: (config: Record<string, unknown>) => call<unknown>('PUT', '/admin/wa/config', { config }),
};
