import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { Card, ChipGroup, Field, ToggleRow, useKit } from '../src/ui/AppKit';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { va, errTone, type CustomRole } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero } from '../src/va/Hero';
import { CATEGORY, CATEGORY_KEYS } from '../src/va/labels';
import { Page, Status } from '../src/va/Page';
import { InfoHint } from '../src/va/InfoHint';
import { num } from '../src/va/bd';

type RulesTab = 'main' | 'categories' | 'speed' | 'spam';
const SECS = ['10', '20', '40', '60', '120'] as const;
const PER_HOUR = ['3', '5', '10', '20'] as const;
const HOLD = ['2', '6', '12', '24'] as const;
const KEEP = ['30', '60', '90', '180'] as const;
const GROUP = ['0', '3', '5', '7'] as const;
const REMIND = ['0', '10', '15', '20', '30'] as const;
const LEAD = ['0', '30', '60', '120'] as const;
const BURST = ['5', '10', '15'] as const;
const URGENT_PER_DAY = ['3', '5', '10', '20'] as const;

/** 4-Tab Rules & Control Center: Main & Calls · Categories & Names · Speed & Reminders · Spam & Limits. */
export default function RulesScreen() {
  const { bn, colors } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [tab, setTab] = useState<RulesTab>('main');
  const cfg = useLoad(() => va.assistantConfig(), 'assistant-config');
  const c = cfg.data?.config;
  const [names, setNames] = useState<{ assistant?: string; owner?: string; replyBy?: string }>({});
  const [lists, setLists] = useState<{ allow?: string; block?: string }>({});
  const [ownerWa, setOwnerWa] = useState<string | undefined>(undefined);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleInstr, setNewRoleInstr] = useState('');
  const [dropRole, setDropRole] = useState<CustomRole | null>(null);
  const [sendingReport, setSendingReport] = useState(false);

  const save = async (patch: Record<string, unknown>): Promise<boolean> => {
    try { await va.saveAssistantConfig(patch); await cfg.reload(); showSnackbar(bn ? 'সংরক্ষণ হয়েছে' : 'Saved', 'success'); return true; }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); return false; }
  };

  return (
    <Page
      title={bn ? 'সহকারীর অবস্থা ও নিয়ম' : 'Assistant status & rules'}
      hideHeader
      onRefresh={cfg.reload}
      refreshing={cfg.loading && !!c}
    >
      <Status loading={cfg.loading && !c} error={c ? null : cfg.error} onRetry={cfg.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {c ? (
        <>
          <Hero
            icon="robot-outline"
            title={c.assistant_name}
            subtitle={c.enabled ? (c.mode === 'auto' ? (bn ? 'চালু, নিজে উত্তর দেয়' : 'On — replies by itself') : (bn ? 'চালু, শুধু খসড়া' : 'On — drafts only')) : (bn ? 'বন্ধ' : 'Off')}
          />

          {/* 4 Category Tabs */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[
              { k: 'main' as RulesTab, bn: '⚡ মূল ও কল', en: '⚡ Main' },
              { k: 'categories' as RulesTab, bn: '🗂 বিভাগ', en: '🗂 Kinds' },
              { k: 'speed' as RulesTab, bn: '⏱ রিমাইন্ডার', en: '⏱ Timing' },
              { k: 'spam' as RulesTab, bn: '🛡 স্প্যাম', en: '🛡 Spam' },
            ].map((t) => {
              const active = tab === t.k;
              return (
                <Pressable
                  key={t.k}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTab(t.k)}
                  style={{
                    flex: 1,
                    minHeight: 40,
                    paddingHorizontal: 4,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                  }}
                >
                  <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: '800', color: active ? colors.onPrimary : colors.textPrimary }}>
                    {bn ? t.bn : t.en}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {tab === 'main' ? (
            <>
              <Card icon="toggle-switch-outline" title={bn ? 'মূল সুইচ, কল ও সেন্সর' : 'Main switches, calls & sensors'}>
                {!c.enabled ? (
                  <InfoHint text={bn ? 'সহকারী এখন বন্ধ — তাই অটো-উত্তর, AI ও ভয়েস কোনোটিই কাজ করবে না। তবে আপনার সব বার্তা ইনবক্সে নিরাপদে জমা হতে থাকবে।' : 'Assistant is off — messages still arrive safely.'} />
                ) : null}
                <ToggleRow icon="power" label={bn ? 'সহকারী চালু' : 'Assistant on'} hint={bn ? 'বন্ধ থাকলেও বার্তা ইনবক্সে জমা হবে, শুধু সহকারী কোনো উত্তর বা খসড়া করবে না।' : 'Off: inbox still collects messages.'} value={c.enabled} onChange={(v) => void save({ enabled: v })} />
                <ToggleRow icon="robot-outline" label={bn ? 'নিজে নিজে উত্তর' : 'Reply by itself'} hint={bn ? 'বন্ধ থাকলে শুধু খসড়া হবে, আপনি ঠিক আছে বললে যাবে। চালু করলে সহকারীও চালু হবে।' : 'Off = drafts, sent when you approve.'} value={c.mode === 'auto'} onChange={(v) => void save({ ...(v && !c.enabled ? { enabled: true } : {}), mode: v ? 'auto' : 'shadow' })} />
                <ToggleRow icon="brain" label={bn ? 'AI দিয়ে বুঝে নেওয়া' : 'Understand with AI'} hint={bn ? 'বন্ধ থাকলে শুধু আপনার লেখা নিয়ম অনুযায়ী চলবে; AI কোনো অর্থ বুঝবে না বা খসড়া লিখবে না।' : 'Off = rules only.'} value={c.ai.enabled} onChange={(v) => void save({ ai: { enabled: v } })} />
                <ToggleRow icon="microphone-outline" label={bn ? 'ভয়েস মেসেজ লিখে ফেলা' : 'Transcribe voice notes'} hint={bn ? 'এটি কাজ করার জন্য ওপরের “AI দিয়ে বুঝে নেওয়া” চালু থাকতে হবে।' : 'Requires AI above to be on.'} value={c.ai.voice} onChange={(v) => void save({ ai: { voice: v } })} />
                <ToggleRow icon="phone-ring-outline" label={bn ? 'মিসড কল ও কলের কৌশলী অটো-উত্তর' : 'Tactful auto-reply on missed calls'} hint={bn ? 'চালু থাকলে মিসড কল এলে আপনার অবস্থা ও আগের প্রসঙ্গ বুঝে কৌশলী উত্তর দেবে এবং কলব্যাকের কাজ তৈরি করবে।' : 'Crafts a polite status-aware reply on missed calls + callback task.'} value={c.call_tactical_reply ?? true} onChange={(v) => void save({ call_tactical_reply: v, calls: { ...(c.calls || { burst_min: 10, escalate_after: 0, reply: v }), reply: v } })} />
                <ToggleRow icon="cellphone-check" label={bn ? 'ফোন হাতে সচল থাকলে অটো-উত্তরের বদলে খসড়া' : 'Draft instead of auto-reply while holding phone'} hint={bn ? 'আপনি যখন নিজে ফোন হাতে নিয়ে ব্যবহার করবেন, তখন সহকারী হুট করে অটো-উত্তর না পাঠিয়ে খসড়া বানিয়ে রাখবে।' : 'Prepares a draft instead of auto-sending while phone is active.'} value={c.presence_draft_when_active ?? true} onChange={(v) => void save({ presence_draft_when_active: v })} />
              </Card>

              <Card icon="whatsapp" title={bn ? 'আমার দ্বিতীয় WhatsApp নম্বর (সব আপডেট)' : 'My second WhatsApp number'}>
                <Field label={bn ? 'আপডেট পাওয়ার WhatsApp নম্বর' : 'Second WhatsApp number'} value={ownerWa ?? (c.owner_whatsapp ?? '')} onChangeText={setOwnerWa} placeholder={bn ? 'যেমন: 017XXXXXXXX' : 'e.g. 017XXXXXXXX'} hint={bn ? 'বট দেখার সময় না পেলেও জরুরি অ্যালার্ট, খসড়া ও সারাংশ আপনার এই আলাদা WhatsApp নম্বরে যাবে।' : 'Urgent alerts & summaries also go to this number.'} />
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <View style={{ flex: 1 }}>
                    <AppButton variant="secondary" label={bn ? 'নম্বর সংরক্ষণ' : 'Save number'} disabled={ownerWa === undefined}
                      onPress={() => void save({ owner_whatsapp: (ownerWa ?? '').trim() }).then((ok) => { if (ok) setOwnerWa(undefined); })} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppButton
                      icon="send-check-outline"
                      label={bn ? 'টেস্ট রিপোর্ট পাঠান' : 'Send test report'}
                      loading={sendingReport}
                      onPress={() => {
                        setSendingReport(true);
                        void va.sendOwnerReport()
                          .then((r) => showSnackbar(r.whatsapp_queued ? (bn ? '✓ রিপোর্ট ২য় WhatsApp-এ পাঠানো হয়েছে' : 'Report queued for 2nd WhatsApp') : (bn ? '✓ রিপোর্ট Telegram-এ পাঠানো হয়েছে' : 'Report sent to Telegram'), 'success'))
                          .catch((e: unknown) => showSnackbar(e instanceof Error ? e.message : '', errTone(e)))
                          .finally(() => setSendingReport(false));
                      }}
                    />
                  </View>
                </View>
              </Card>

              <Card icon="account-tie-outline" title={bn ? 'কাস্টম রোল (সহকারীর ভূমিকা)' : 'Custom Roles'}>
                <InfoHint text={bn ? 'সহকারী এখন কোন ভূমিকায় উত্তর দেবে তা ১ ট্যাপে বাছুন বা নিজের মতো নতুন রোল বানান।' : 'Pick a role or create your own custom assistant role.'} />
                {(c.custom_roles ?? []).map((r) => {
                  const active = c.active_role === r.id;
                  return (
                    <View key={r.id} style={{ padding: 10, borderRadius: 12, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primaryTint : colors.surfaceMuted, gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <Text style={{ fontWeight: '800', color: active ? colors.primary : colors.textPrimary, flex: 1 }}>{r.name}{active ? (bn ? ' (সক্রিয় ✓)' : ' (Active ✓)') : ''}</Text>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          {!active ? (
                            <Pressable onPress={() => void save({ active_role: r.id })} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.primary }}>
                              <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.onPrimary }}>{bn ? 'চালু করুন' : 'Activate'}</Text>
                            </Pressable>
                          ) : null}
                          {!r.builtin ? (
                            <Pressable onPress={() => setDropRole(r)} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: colors.danger }}>
                              <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.danger }}>{bn ? 'মুছুন' : 'Delete'}</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                      <Text style={{ fontSize: 12, color: colors.textSecondary }}>{r.instruction}</Text>
                    </View>
                  );
                })}
                <Field label={bn ? 'নতুন রোলের নাম' : 'New role name'} value={newRoleName} onChangeText={setNewRoleName} placeholder={bn ? 'যেমন: অফিস ম্যানেজার' : 'e.g. Office Manager'} />
                <Field label={bn ? 'এই রোলে সহকারী কীভাবে কথা বলবে?' : 'Role instructions'} value={newRoleInstr} onChangeText={setNewRoleInstr} placeholder={bn ? 'যেমন: ভদ্রভাবে অর্ডার ও সময় জেনে নেবে' : 'e.g. Politely ask for order & time'} />
                <AppButton
                  variant="secondary"
                  icon="plus"
                  label={bn ? 'নতুন কাস্টম রোল যোগ করুন' : 'Add custom role'}
                  disabled={!newRoleName.trim() || !newRoleInstr.trim()}
                  onPress={() => {
                    const id = `role_${Date.now()}`;
                    const next: CustomRole[] = [...(c.custom_roles ?? []), { id, name: newRoleName.trim(), tone: 'warm', auto_level: 'balanced', instruction: newRoleInstr.trim(), builtin: false }];
                    void save({ custom_roles: next, active_role: id }).then((ok) => { if (ok) { setNewRoleName(''); setNewRoleInstr(''); } });
                  }}
                />
              </Card>
              <AppConfirmDialog
                visible={!!dropRole}
                danger
                icon="trash-can-outline"
                title={bn ? 'কাস্টম রোলটি মুছবেন?' : 'Delete custom role?'}
                description={dropRole?.name}
                confirmLabel={bn ? 'মুছুন' : 'Delete'}
                cancelLabel={bn ? 'না' : 'No'}
                onCancel={() => setDropRole(null)}
                onConfirm={() => {
                  const target = dropRole;
                  setDropRole(null);
                  if (!target) return;
                  const next = (c.custom_roles ?? []).filter((x) => x.id !== target.id);
                  const nextActive = c.active_role === target.id ? (next[0]?.id ?? 'personal_secretary') : c.active_role;
                  void save({ custom_roles: next, active_role: nextActive });
                }}
              />

              <Card icon="calendar-clock" title={bn ? 'সময়সূচি, অবস্থা ও জায়গা' : 'Routine, status and places'}>
                <AppButton variant="secondary" icon="calendar-clock" label={bn ? 'সময়সূচি ও স্থান খুলুন' : 'Open routine & places'} onPress={() => router.push('/routine' as never)} />
              </Card>
            </>
          ) : null}

          {tab === 'categories' ? (
            <>
              <Card icon="shape-outline" title={bn ? 'কোন ধরনের বার্তায় কী করবে' : 'What to do with each kind of message'}>
                <InfoHint text={bn ? 'সহকারী প্রতিটি বার্তা পড়ে ব্যবসায়িক, ব্যক্তিগত, সামাজিক বা স্প্যাম ঠিক করে। কোনগুলোতে নিজে উত্তর দেবে, তা এখানে ঠিক করুন।' : 'Choose where the assistant may answer by itself.'} />
                {CATEGORY_KEYS.filter((k) => k !== 'spam').map((k) => (
                  <ToggleRow key={k} icon={CATEGORY[k].icon} label={`${bn ? CATEGORY[k].bn : CATEGORY[k].en}: ${(c.categories?.[k]?.auto ?? k === 'business') ? (bn ? 'নিজে উত্তর দেবে' : 'replies by itself') : (bn ? 'শুধু খসড়া' : 'drafts only')}`}
                    hint={bn ? CATEGORY[k].hintBn : CATEGORY[k].hintEn} value={c.categories?.[k]?.auto ?? k === 'business'} onChange={(v) => void save({ categories: { [k]: { auto: v } } })} />
                ))}
                <InfoHint text={bn ? 'পরিবার সব সময় ব্যক্তিগত, সেখানে সহকারী কখনও নিজে উত্তর দেয় না। স্প্যাম আলাদা হয়ে যায়।' : 'Family never gets unapproved auto-replies.'} />
              </Card>

              <Card icon="account-edit-outline" title={bn ? 'নাম ও কথার ধরন' : 'Names and wording'}>
                <Field label={bn ? 'সহকারীর নাম' : 'Assistant name'} value={names.assistant ?? c.assistant_name} onChangeText={(v) => setNames((s) => ({ ...s, assistant: v }))} />
                <Field label={bn ? 'আপনার নাম (সহকারী যা বলবে)' : 'Your name (as the assistant says it)'} value={names.owner ?? c.owner_name} onChangeText={(v) => setNames((s) => ({ ...s, owner: v }))} />
                <Field label={bn ? '“কখন উত্তর পাবেন” বলার ধরন' : 'How it says when you will reply'} value={names.replyBy ?? c.reply_by} onChangeText={(v) => setNames((s) => ({ ...s, replyBy: v }))} hint={bn ? 'যেমন: পরে সুযোগ পেলেই' : 'e.g. as soon as he can'} />
                <AppButton label={bn ? 'নাম ও কথা সংরক্ষণ' : 'Save names and wording'} disabled={names.assistant === undefined && names.owner === undefined && names.replyBy === undefined}
                  onPress={() => void save({ assistant_name: names.assistant ?? c.assistant_name, owner_name: names.owner ?? c.owner_name, reply_by: names.replyBy ?? c.reply_by }).then((ok) => { if (ok) setNames({}); })} />
              </Card>

              <Card icon="text-box-edit-outline" title={bn ? 'বাঁধা উত্তর ও পরীক্ষা' : 'Ready answers and testing'}>
                <AppButton variant="secondary" icon="text-box-edit-outline" label={bn ? 'সহকারীর বাঁধা উত্তর বদলান' : 'Edit ready answers'} onPress={() => router.push('/scripts' as never)} />
                <AppButton variant="secondary" icon="flask-outline" label={bn ? 'সহকারীকে পরখ করুন' : 'Try the assistant'} onPress={() => router.push('/simulate' as never)} />
              </Card>
            </>
          ) : null}

          {tab === 'speed' ? (
            <>
              <Card icon="speedometer" title={bn ? 'গতি ও সীমা' : 'Speed and limits'}>
                <ChipGroup<(typeof SECS)[number]> label={bn ? 'উত্তরের আগে অপেক্ষা (সর্বোচ্চ সেকেন্ড)' : 'Wait before replying (max seconds)'} options={SECS} value={String(c.delay.max) as (typeof SECS)[number]} labelOf={(s) => num(s, bn)} onChange={(s) => { if (s) void save({ delay: { min: Math.min(20, Number(s)), max: Number(s) } }); }} />
                <ChipGroup<(typeof PER_HOUR)[number]> label={bn ? 'একজনকে ঘণ্টায় সর্বোচ্চ অটো-উত্তর' : 'Max auto-replies to one person per hour'} options={PER_HOUR} value={String(c.per_sender_hour) as (typeof PER_HOUR)[number]} labelOf={(s) => num(s, bn)} onChange={(s) => { if (s) void save({ per_sender_hour: Number(s) }); }} />
                <ChipGroup<(typeof HOLD)[number]> label={bn ? 'আমি নিজে উত্তর দিলে সহকারী চুপ থাকবে (ঘণ্টা)' : 'Stay quiet after I answer (hours)'} options={HOLD} value={String(c.hold_hours) as (typeof HOLD)[number]} labelOf={(s) => num(s, bn)} onChange={(s) => { if (s) void save({ hold_hours: Number(s) }); }} />
              </Card>

              <Card icon="brain" title={bn ? 'গ্রুপিং ও রিমাইন্ডার' : 'Grouping & reminders'}>
                <ChipGroup<(typeof GROUP)[number]> label={bn ? 'একই মানুষের কয়েকটি বার্তা একসঙ্গে ধরে একটি উত্তর (মিনিট)' : 'Group messages (minutes)'} options={GROUP} value={String(c.grouping?.window_min ?? 5) as (typeof GROUP)[number]} labelOf={(s) => (s === '0' ? (bn ? 'বন্ধ' : 'Off') : num(s, bn))}
                  onChange={(s) => { if (s) void save({ grouping: { window_min: Number(s) } }); }} hint={bn ? 'জরুরি বার্তা অপেক্ষা করে না।' : 'Urgent messages never wait.'} />
                <ChipGroup<(typeof REMIND)[number]> label={bn ? '“উত্তর বাকি” মনে করানো (মিনিট পর)' : '“Still unanswered” reminder (minutes)'} options={REMIND} value={String(c.reminders?.unanswered_min ?? 0) as (typeof REMIND)[number]} labelOf={(s) => (s === '0' ? (bn ? 'বন্ধ' : 'Off') : num(s, bn))}
                  onChange={(s) => { if (s) void save({ reminders: { unanswered_min: Number(s) } }); }} hint={bn ? 'শুধু বলে “উত্তর দেওয়ার প্রমাণ পাইনি”।' : 'Only says no answer was found.'} />
                <ToggleRow icon="star-outline" label={bn ? 'শুধু গুরুত্বপূর্ণ মানুষের জন্য মনে করানো' : 'Remind only for important people'} value={c.reminders?.only_important ?? true} onChange={(v) => void save({ reminders: { only_important: v } })} />
                <ChipGroup<(typeof LEAD)[number]> label={bn ? 'কাজের সময়ের আগে মনে করানো (মিনিট)' : 'Remind before task due (minutes)'} options={LEAD} value={String(c.reminders?.task_lead_min ?? 0) as (typeof LEAD)[number]} labelOf={(s) => (s === '0' ? (bn ? 'বন্ধ' : 'Off') : num(s, bn))}
                  onChange={(s) => { if (s) void save({ reminders: { task_lead_min: Number(s) } }); }} />
                <ChipGroup<(typeof BURST)[number]> label={bn ? 'বারবার মিসড কল: এই সময়ের মধ্যে একটাই অ্যালার্ট (মিনিট)' : 'Repeated missed calls window (minutes)'} options={BURST} value={String(c.calls?.burst_min ?? 10) as (typeof BURST)[number]} labelOf={(s) => num(s, bn)}
                  onChange={(s) => { if (s) void save({ calls: { burst_min: Number(s) } }); }} />
              </Card>
            </>
          ) : null}

          {tab === 'spam' ? (
            <>
              <Card icon="email-off-outline" title={bn ? 'স্প্যাম ও প্রচার' : 'Spam and promotions'}>
                <ToggleRow icon="filter-remove-outline" label={bn ? 'অপারেটর ও দোকানের অফার স্প্যামে পাঠাও' : 'Send operator and shop offers to spam'} hint={bn ? 'GP, Robi, Banglalink, Airtel, Teletalk, Circle ও অ্যাপের বিজ্ঞাপন। bKash, ব্যাংক বা কোডের SMS কখনো নয়।' : 'Never bKash, bank or code SMS.'}
                  value={c.promo?.enabled ?? true} onChange={(v) => void save({ promo: { enabled: v } })} />
                <Field label={bn ? 'কখনো স্প্যাম নয় (নাম/নম্বর, কমা দিয়ে)' : 'Never spam (comma separated)'} value={lists.allow ?? (c.promo?.allow ?? []).join(', ')} onChangeText={(v) => setLists((s) => ({ ...s, allow: v }))} />
                <Field label={bn ? 'সব সময় স্প্যাম (নাম/নম্বর, কমা দিয়ে)' : 'Always spam (comma separated)'} value={lists.block ?? (c.promo?.block ?? []).join(', ')} onChangeText={(v) => setLists((s) => ({ ...s, block: v }))} />
                <AppButton variant="secondary" label={bn ? 'তালিকা সংরক্ষণ' : 'Save lists'} disabled={lists.allow === undefined && lists.block === undefined}
                  onPress={() => { const split = (t?: string, d: string[] = []) => (t === undefined ? d : t.split(',').map((x) => x.trim()).filter(Boolean)); void save({ promo: { allow: split(lists.allow, c.promo?.allow), block: split(lists.block, c.promo?.block) } }).then((ok) => { if (ok) setLists({}); }); }} />
              </Card>

              <Card icon="bell-outline" title={bn ? 'অ্যালার্ট সীমা, সারাংশ ও সংরক্ষণ' : 'Alert limits, digest & retention'}>
                <ToggleRow icon="bell-alert-outline" label={bn ? 'জরুরি হলে আমাকে জানান' : 'Tell me when urgent'} value={c.notify.urgent} onChange={(v) => void save({ notify: { urgent: v } })} />
                <ToggleRow icon="calendar-today" label={bn ? 'প্রতিদিন সারাংশ' : 'Daily summary'} hint={c.notify.digest ? (bn ? `প্রতিদিন ${num(c.notify.digest_time, true)}-এ` : `Every day at ${c.notify.digest_time}`) : undefined} value={c.notify.digest} onChange={(v) => void save({ notify: { digest: v } })} />
                <ChipGroup<(typeof URGENT_PER_DAY)[number]> label={bn ? 'দিনে সর্বোচ্চ জরুরি অ্যালার্ট' : 'Max urgent alerts per day'} options={URGENT_PER_DAY} value={String(c.limits?.urgent_per_day ?? 5) as (typeof URGENT_PER_DAY)[number]} labelOf={(s) => num(s, bn)}
                  onChange={(s) => { if (s) void save({ limits: { urgent_per_day: Number(s) } }); }} hint={bn ? 'সীমা বা নীরব সময়ে আটকে গেলে অ্যালার্ট হারায় না: আপনি পরে সারাংশ পাবেন।' : 'Held alerts are summarized later.'} />
                <ChipGroup<(typeof KEEP)[number]> label={bn ? 'বার্তা কত দিন রাখবে' : 'Keep messages for (days)'} options={KEEP} value={String(c.retention_days) as (typeof KEEP)[number]} labelOf={(s) => num(s, bn)} onChange={(s) => { if (s) void save({ retention_days: Number(s) }); }} />
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}
