import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { AppText as Text, AppTextInput as TextInput } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { AppIcon, type IconName } from '../src/ui/AppIcon';
import { Card, Field, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { radius, spacing, typography } from '../src/theme';
import { va, errTone, type F0Result } from '../src/va/api';
import { Page } from '../src/va/Page';
import { useAppActive, useLoad } from '../src/va/hooks';
import { CHANNEL, MESSAGE_STATUS } from '../src/va/labels';
import { readMediaUri, readSharedMedia, startVoiceInput, type SharedMediaResult } from '../modules/va-bridge';

function outcome(r: unknown, bn: boolean): { text: string; ok: boolean } | null {
  const m = r && typeof r === 'object' ? (r as { status?: string; error?: string | null }) : {};
  const label = m.status ? MESSAGE_STATUS[m.status as keyof typeof MESSAGE_STATUS] : undefined;
  if (!label) return null;
  const text = bn ? label.bn : label.en;
  const failed = m.status === 'failed' || m.status === 'skipped';
  return { text: failed && m.error ? `${text}: ${m.error}` : text, ok: !failed };
}

const QUICK: readonly { bn: string; en: string; cmd: string; icon: IconName }[] = [
  { bn: 'মিসড কল', en: 'Missed calls', cmd: 'মিসড কল', icon: 'phone-missed' },
  { bn: 'কার উত্তর বাকি', en: 'Who is waiting', cmd: 'কার উত্তর বাকি', icon: 'message-reply-text-outline' },
  { bn: 'আমার কাজ', en: 'My tasks', cmd: 'আমার কাজ', icon: 'checkbox-marked-circle-outline' },
  { bn: 'জরুরি', en: 'Urgent', cmd: 'জরুরি', icon: 'alert-octagon-outline' },
  { bn: 'খসড়া', en: 'Drafts', cmd: 'খসড়া', icon: 'file-document-edit-outline' },
  { bn: 'কী পাঠানো হলো', en: 'What was sent', cmd: 'কী কী পাঠানো হয়েছে', icon: 'send-check-outline' },
  { bn: 'সহকারীর অবস্থা', en: 'Status', cmd: 'সহকারীর অবস্থা', icon: 'robot-outline' },
  { bn: 'নিয়ম', en: 'Rules', cmd: 'নিয়ম', icon: 'shield-check-outline' },
  { bn: 'ইনবক্স সাজাও', en: 'Organize inbox', cmd: 'ইনবক্স সাজাও', icon: 'auto-fix' },
  { bn: 'সব স্প্যাম মুছো', en: 'Clean spam', cmd: 'সব স্প্যাম মুছো', icon: 'delete-sweep-outline' },
  { bn: 'টাস্ক সাজাও', en: 'Organize tasks', cmd: 'টাস্ক সাজাও', icon: 'checkbox-multiple-marked-outline' },
  { bn: '২য় WA রিপোর্ট', en: '2nd WA Report', cmd: 'রিপোর্ট পাঠাও', icon: 'whatsapp' },
];

export default function F0Screen() {
  const { bn, colors, design } = useKit();
  const router = useRouter();
  const params = useLocalSearchParams<{ cmd?: string; pick?: string }>();
  const { showSnackbar } = useAppFeedback();
  const [text, setText] = useState(params.cmd ?? '');
  const [cmdSeen, setCmdSeen] = useState(params.cmd);
  if (params.cmd !== cmdSeen) { setCmdSeen(params.cmd); if (params.cmd) setText(params.cmd); }
  const [asked, setAsked] = useState('');
  const [res, setRes] = useState<F0Result | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const cfg = useLoad(() => va.assistantConfig(), 'assistant-config');
  const auto = !!cfg.data?.config.f0?.auto_send;
  const setAuto = async (v: boolean) => {
    try {
      await va.saveAssistantConfig({ f0: { auto_send: v } });
      await cfg.reload();
      showSnackbar(
        v ? (bn ? '⚡ অটো মোড: বললেই বার্তা চলে যাবে' : '⚡ Auto: messages go at once')
          : (bn ? '🟢 নিরাপদ মোড: পাঠানোর আগে দেখাবে' : '🟢 Safe: previews first'),
        'success'
      );
    } catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
  };
  const [past, setPast] = useState<{ q: string; a: string }[]>([]);
  const appActive = useAppActive();

  const handleMedia = useCallback(async (m: SharedMediaResult, label: string) => {
    if (!m.ok || !m.dataB64 || !m.mime) {
      showSnackbar(m.error || (bn ? 'ফাইলটি পড়া যায়নি' : 'Could not read file'), 'danger');
      return;
    }
    setBusy(true); setResult(null);
    setAsked(label);
    try {
      const r = await va.analyzeMedia(m.mime, m.dataB64, m.name ?? '');
      const fullAns = r.suggested_reply
        ? `${r.summary}\n\n✍ প্রস্তাবিত কৌশলী উত্তর${r.pattern ? ` (${r.pattern})` : ''}:\n${r.suggested_reply}`
        : r.summary;
      setRes({ intent: 'system', answer: fullAns, items: [], choices: [], draft: null });
    } catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
    finally { setBusy(false); }
  }, [bn, showSnackbar]);

  useEffect(() => {
    if (!appActive) return;
    void readSharedMedia().then((m) => {
      if (m) void handleMedia(m, bn ? `শেয়ার করা ফাইল${m.name ? `: ${m.name}` : ''}` : `Shared file${m.name ? `: ${m.name}` : ''}`);
    });
  }, [appActive, bn, handleMedia]);

  const pickMedia = useCallback(async (kind?: 'audio' | 'image' | 'video') => {
    try {
      const types = kind === 'audio' ? ['audio/*'] : kind === 'image' ? ['image/*'] : kind === 'video' ? ['video/*'] : ['audio/*', 'image/*', 'video/*'];
      const picked = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0]!;
      const m = await readMediaUri(asset.uri, asset.mimeType ?? '');
      await handleMedia({ ...m, name: asset.name || m.name }, bn ? `ফাইল: ${asset.name || 'ভয়েস/ছবি/ভিডিও'}` : `File: ${asset.name || 'media'}`);
    } catch (e) { showSnackbar(e instanceof Error ? e.message : '', 'danger'); }
  }, [bn, handleMedia, showSnackbar]);

  const pickSeenRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (params.pick && params.pick !== pickSeenRef.current) {
      pickSeenRef.current = params.pick;
      const k = params.pick === 'audio' || params.pick === 'image' || params.pick === 'video' ? params.pick : undefined;
      void pickMedia(k);
    }
  }, [params.pick, pickMedia]);

  const send = async (cmd: string) => {
    setBusy(true); setResult(null);
    try {
      const r = await va.f0Command(cmd);
      if (res?.answer && asked) setPast((p) => [...p.slice(-5), { q: asked, a: res.answer }]);
      setRes(r); setBody(r.draft?.body ?? ''); setText('');
      if (r.sent) setResult(outcome(r.sent, bn));
    } catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    if (!res?.draft) return;
    const d = res.draft;
    setBusy(true);
    try {
      const edited = body.trim() !== d.body.trim() ? body.trim() : undefined;
      const r = await va.approve(d.id, edited);
      setResult(outcome(r, bn) ?? { text: bn ? 'পাঠানোর জন্য দেওয়া হয়েছে। পৌঁছাল কি না ইনবক্সে ওই মানুষের পাতায় দেখা যাবে।' : 'Handed over for sending.', ok: true });
      setRes({ ...res, draft: null });
    } catch (e) { setResult({ text: e instanceof Error ? e.message : '', ok: false }); }
    finally { setBusy(false); }
  };

  const discard = async () => {
    if (!res?.draft) return;
    setBusy(true);
    try {
      const r = await va.discard(res.draft.id);
      setResult(outcome(r, bn) ?? { text: bn ? 'ঠিক আছে, বার্তাটা পাঠানো হবে না।' : 'OK, the message will not be sent.', ok: true });
      setRes({ ...res, draft: null });
    } catch (e) { setResult({ text: e instanceof Error ? e.message : '', ok: false }); }
    finally { setBusy(false); }
  };

  const openContact = (id: string) => router.push({ pathname: '/contact', params: { id } } as never);
  const d = res?.draft ?? null;

  return (
    <Page title={bn ? 'সহকারীকে বলুন' : 'Tell the assistant'} hideHeader>
      {/* Top Card: AI Secretary Mode & Quick Prompt Chips */}
      <View style={{ padding: 12, borderRadius: design.radiusCard, borderWidth: 1, borderColor: design.cardBorder, backgroundColor: colors.surface, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <AppIcon name="robot-happy-outline" size={20} color={colors.primary} />
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '800', color: colors.textPrimary, flexShrink: 1 }}>
              {bn ? 'ব্যক্তিগত AI সচিব (F0)' : 'Personal AI Secretary (F0)'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'Telegram বট @SumonVA_bot খুলুন' : 'Open Telegram bot @SumonVA_bot'}
            onPress={() => void Linking.openURL('https://t.me/SumonVA_bot').catch(() => showSnackbar(bn ? 'Telegram অ্যাপ খোলা যায়নি' : 'Could not open Telegram', 'danger'))}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 9,
              paddingVertical: 5,
              borderRadius: radius.pill,
              backgroundColor: colors.primaryTint,
            }}
          >
            <AppIcon name="send-circle-outline" size={14} color={colors.primary} />
            <Text style={{ fontSize: 11, fontWeight: '800', color: colors.primary }}>@SumonVA_bot</Text>
          </Pressable>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: auto }}
            onPress={() => void setAuto(!auto)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: radius.pill,
              backgroundColor: auto ? 'rgba(245,158,11,0.18)' : 'rgba(16,185,129,0.18)',
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: '800', color: auto ? colors.warning : colors.success }}>
              {auto ? (bn ? '⚡ অটো মোড' : '⚡ Auto') : (bn ? '🟢 নিরাপদ প্রিভিউ' : '🟢 Safe Preview')}
            </Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {QUICK.map((q) => (
            <Pressable
              key={q.cmd}
              accessibilityRole="button"
              accessibilityLabel={bn ? q.bn : q.en}
              disabled={busy}
              onPress={() => { setText(q.cmd); setAsked(q.cmd); void send(q.cmd); }}
              style={({ pressed }) => ({
                minHeight: 36,
                paddingHorizontal: 11,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                borderRadius: 12,
                backgroundColor: colors.surfaceMuted,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <AppIcon name={q.icon} size={15} color={colors.primary} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textPrimary }}>{bn ? q.bn : q.en}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Multi-Modal Media Analysis Card (Voice / Photo / Video) */}
      <View style={{ padding: 12, borderRadius: design.radiusCard, borderWidth: 1, borderColor: design.cardBorder, backgroundColor: colors.surface, gap: 8 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textSecondary }}>
          {bn ? 'ভয়েস, ছবি/রসিদ বা ভিডিও বিশ্লেষণ করুন (অ্যাপের AI চাবি দিয়ে):' : 'Analyze voice, photo/receipt or video with AI:'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void pickMedia('audio')}
            style={{ flex: 1, minHeight: 40, borderRadius: 12, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <AppIcon name="microphone-outline" size={17} color={colors.primary} />
            <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textPrimary }}>{bn ? 'ভয়েস নোট' : 'Voice'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void pickMedia('image')}
            style={{ flex: 1, minHeight: 40, borderRadius: 12, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <AppIcon name="image-outline" size={17} color={colors.primary} />
            <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textPrimary }}>{bn ? 'রসিদ/ছবি' : 'Photo'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void pickMedia('video')}
            style={{ flex: 1, minHeight: 40, borderRadius: 12, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <AppIcon name="video-outline" size={17} color={colors.primary} />
            <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textPrimary }}>{bn ? 'ভিডিও ক্লিপ' : 'Video'}</Text>
          </Pressable>
        </View>
      </View>

      {/* Conversational Q&A Stream */}
      {past.map((p, i) => (
        <View key={i} style={{ gap: 6 }}>
          <View style={{ alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16, backgroundColor: colors.primary }}>
            <Text style={{ fontSize: 13.5, fontWeight: '600', color: colors.onPrimary }}>{p.q}</Text>
          </View>
          <View style={{ alignSelf: 'flex-start', maxWidth: '94%', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
            <Text style={{ fontSize: 14, lineHeight: 21, color: colors.textPrimary }}>{p.a}</Text>
          </View>
        </View>
      ))}
      {res && asked ? (
        <View style={{ alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16, backgroundColor: colors.primary }}>
          <Text style={{ fontSize: 13.5, fontWeight: '700', color: colors.onPrimary }}>{asked}</Text>
        </View>
      ) : null}
      {res ? (
        <Card icon="robot-happy-outline" title={bn ? '🤖 সহকারীর বিশ্লেষণ ও উত্তর' : '🤖 Assistant analysis & reply'}>
          {res.answer ? <Text style={{ fontSize: 14, lineHeight: 21 }}>{res.answer}</Text> : null}
          {res.items.map((it, i) => (
            <Pressable
              key={i}
              accessibilityRole={it.contact_id ? 'button' : 'text'}
              accessibilityLabel={it.subtitle ? `${it.title}, ${it.subtitle}` : it.title}
              disabled={!it.contact_id}
              onPress={() => { if (it.contact_id) openContact(it.contact_id); }}
              style={{ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.callout, color: colors.textPrimary }}>{it.title}</Text>
                {it.subtitle ? <Text style={{ ...typography.caption, color: colors.textMuted }}>{it.subtitle}</Text> : null}
              </View>
              {it.contact_id ? <AppIcon name="chevron-right" size={22} color={colors.textMuted} /> : null}
            </Pressable>
          ))}
          {res.choices.length > 0 ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <Text style={{ ...typography.callout, color: colors.textPrimary }}>{bn ? 'কার কথা বলছেন? একজনকে বাছুন' : 'Who do you mean? Pick one'}</Text>
              {res.choices.map((c) => (
                <AppButton key={c.contact_id} variant="secondary" label={c.label} disabled={busy} onPress={() => void send(`${asked} #${c.contact_id}`)} />
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      {d ? (
        <Card title={bn ? '✉ এই বার্তাটা যাবে (দেখে নিন)' : '✉ This message will be sent (check it)'}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={{ ...typography.callout, color: colors.textPrimary }}>{bn ? 'কাকে: ' : 'To: '}{d.to}</Text>
            <AppBadge label={(bn ? CHANNEL[d.channel as keyof typeof CHANNEL]?.bn : CHANNEL[d.channel as keyof typeof CHANNEL]?.en) ?? d.channel} tone="neutral" />
          </View>
          {d.warnings.map((w, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.smd, borderRadius: radius.card, backgroundColor: colors.surfaceMuted, marginBottom: spacing.sm }}>
              <AppIcon name="alert-outline" size={20} color={colors.warning} />
              <Text style={{ flex: 1, color: colors.textPrimary }}>{w}</Text>
            </View>
          ))}
          <Field label={bn ? 'বার্তা (বদলাতে পারেন)' : 'Message (you can edit)'} value={body} onChangeText={setBody} multiline />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <AppButton label={bn ? 'পাঠান' : 'Send'} icon="send" loading={busy} disabled={!body.trim()} onPress={() => void approve()} />
            </View>
            <View style={{ flex: 1 }}>
              <AppButton variant="secondary" label={bn ? 'পাঠাবেন না' : 'Discard'} disabled={busy} onPress={() => void discard()} />
            </View>
          </View>
        </Card>
      ) : null}

      {result ? (
        <Card title={result.ok ? (bn ? 'কী হলো' : 'What happened') : (bn ? 'হয়নি' : 'Did not work')}>
          <Text style={{ color: result.ok ? colors.textPrimary : colors.danger }}>{result.text}</Text>
        </Card>
      ) : null}

      {/* Unified Multi-Modal Composer Card */}
      <View style={{ padding: 12, borderRadius: design.radiusCard, borderWidth: 1, borderColor: design.cardBorder, backgroundColor: colors.surface, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder={bn ? 'যেমন: রহিমকে বলো কাল আসব / আজ কে ফোন করেছিল / আমার দ্বিতীয় হোয়াটসঅ্যাপ 017…' : 'e.g. tell Rahim I am coming / who called today…'}
            placeholderTextColor={colors.textMuted}
            style={{
              flex: 1,
              minHeight: 46,
              maxHeight: 110,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: colors.surfaceMuted,
              color: colors.textPrimary,
              fontSize: 13.5,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'ভয়েস কমান্ড দিন' : 'Voice command'}
            disabled={busy}
            onPress={() => {
              void startVoiceInput(bn ? 'bn-BD' : 'en-US').then((v) => {
                if (v.ok && v.text) {
                  setText(v.text);
                  setAsked(v.text);
                  void send(v.text);
                } else if (v.error) {
                  showSnackbar(v.error, 'info');
                }
              });
            }}
            style={{ width: 44, height: 46, borderRadius: 12, backgroundColor: colors.primaryTint, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
          >
            <AppIcon name="microphone" size={20} color={colors.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'ভয়েস, ছবি বা ভিডিও বাছুন' : 'Pick voice, photo or video'}
            disabled={busy}
            onPress={() => void pickMedia()}
            style={{ width: 44, height: 46, borderRadius: 12, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}
          >
            <AppIcon name="paperclip" size={20} color={colors.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'বলুন' : 'Ask'}
            disabled={!text.trim() || busy}
            onPress={() => { const t = text.trim(); setAsked(t); void send(t); }}
            style={{
              height: 46,
              paddingHorizontal: 16,
              borderRadius: 12,
              backgroundColor: colors.primary,
              opacity: !text.trim() || busy ? 0.5 : 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 13.5, fontWeight: '800', color: colors.onPrimary }}>{bn ? 'বলুন' : 'Ask'}</Text>
          </Pressable>
        </View>
      </View>
    </Page>
  );
}
