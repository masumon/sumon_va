import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { AppBadge, AppButton } from '../ui/AppSurface';
import { AppIcon } from '../ui/AppIcon';
import { Card, Field, useKit } from '../ui/AppKit';
import { AppConfirmDialog, useAppFeedback } from '../ui/AppFeedback';
import { radius, spacing, typography } from '../theme';
import { va, errTone, type Fact, type IdentityRef, type IdentitySuggestion } from './api';
import { useLoad } from './hooks';

/** Plain Bangla words for how sure the assistant is and where a fact came from. */
const CONF: Record<Fact['confidence'], { bn: string; en: string }> = {
  high: { bn: 'প্রায় নিশ্চিত', en: 'fairly sure' },
  medium: { bn: 'মোটামুটি', en: 'somewhat sure' },
  low: { bn: 'কম নিশ্চিত', en: 'not very sure' },
};
const PROV: Record<Fact['provenance'], { bn: string; en: string }> = {
  owner: { bn: 'আপনি বলেছেন', en: 'You said it' },
  ai: { bn: 'অনুমান', en: 'Guess' },
  imported: { bn: 'পুরনো চ্যাট থেকে', en: 'From old chat' },
  platform: { bn: 'অ্যাপ থেকে পাওয়া', en: 'From the app' },
};
const STATUS: Record<Fact['status'], { bn: string; en: string } | null> = {
  active: null,
  disputed: { bn: 'সন্দেহ আছে', en: 'Disputed' },
  superseded: { bn: 'পুরনো', en: 'Outdated' },
  corrected: { bn: 'শোধরানো', en: 'Corrected' },
};

/** A compact card that starts closed: the header is one 48 dp button. */
function Fold({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const { colors, bn } = useKit();
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}${count ? ` (${count})` : ''}, ${open ? (bn ? 'বন্ধ করুন' : 'collapse') : (bn ? 'খুলুন' : 'expand')}`}
        onPress={() => setOpen((v) => !v)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={{ flex: 1, ...typography.cardTitle, color: colors.textPrimary }}>{title}{count ? ` (${count})` : ''}</Text>
        <AppIcon name={open ? 'chevron-up' : 'chevron-down'} size={22} color={colors.textMuted} />
      </Pressable>
      {open ? <View style={{ gap: spacing.smd, marginTop: spacing.sm }}>{children}</View> : null}
    </Card>
  );
}

function Muted({ children }: { children: ReactNode }) {
  const { colors } = useKit();
  return <Text style={{ ...typography.caption, color: colors.textMuted }}>{children}</Text>;
}

/** "Same person?" — links the same human across chat apps. Always reversible. */
function SamePerson({ contactId }: { contactId: string }) {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const sugg = useLoad(() => va.identitySuggestions(), `identity-sugg:${contactId}`);
  const linked = useLoad(() => va.identityOf(contactId), `identity-of:${contactId}`);
  const [link, setLink] = useState<IdentitySuggestion | null>(null);
  const [unlink, setUnlink] = useState<IdentityRef | null>(null);
  const [busy, setBusy] = useState(false);

  const mine = (sugg.data ?? []).filter((x) => x.a.id === contactId || x.b.id === contactId);
  const other = (x: IdentitySuggestion) => (x.a.id === contactId ? x.b : x.a);
  const links = linked.data?.linked ?? [];
  const refresh = async () => { await Promise.all([sugg.reload(), linked.reload()]); };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); await refresh(); showSnackbar(ok, 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
    finally { setBusy(false); }
  };
  const chan = (r: IdentityRef) => `${r.name || r.key} · ${r.channel}`;
  const err = sugg.error || linked.error;

  return (
    <Fold title={bn ? 'একই ব্যক্তি?' : 'Same person?'} count={mine.length + links.length}>
      {err && !sugg.data && !linked.data ? <Muted>{err}</Muted> : null}
      {links.length > 0 ? <Muted>{bn ? 'এই ব্যক্তির আরও যে চ্যাট যুক্ত আছে' : 'Other chats linked to this person'}</Muted> : null}
      {links.map((r) => (
        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={{ flex: 1 }}>{chan(r)}</Text>
          <AppButton variant="secondary" label={bn ? 'আলাদা করুন' : 'Separate'} disabled={busy} onPress={() => setUnlink(r)} />
        </View>
      ))}
      {mine.length > 0 ? <Muted>{bn ? 'সহকারীর ধারণা, এরা একই মানুষ হতে পারে' : 'The assistant thinks these may be the same person'}</Muted> : null}
      {mine.map((x) => (
        <View key={`${x.a.id}-${x.b.id}`} style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ flex: 1 }}>{chan(other(x))}</Text>
            <AppBadge label={x.level === 'high' ? (bn ? 'সম্ভাবনা বেশি' : 'Likely') : (bn ? 'সম্ভাবনা মাঝারি' : 'Possible')} tone={x.level === 'high' ? 'primary' : 'neutral'} />
          </View>
          {x.reasons.length > 0 ? <Muted>{x.reasons.join(' · ')}</Muted> : null}
          <AppButton variant="secondary" label={bn ? 'যুক্ত করুন' : 'Link'} disabled={busy} onPress={() => setLink(x)} />
        </View>
      ))}
      {!err && links.length === 0 && mine.length === 0 && (sugg.data || linked.data) ? <Muted>{bn ? 'কোনো প্রস্তাব নেই' : 'No suggestions'}</Muted> : null}

      <AppConfirmDialog visible={!!link} icon="link-variant" title={bn ? 'এদের একই ব্যক্তি হিসেবে যুক্ত করবেন?' : 'Link these as one person?'}
        description={link ? (bn ? `${chan(link.a)} আর ${chan(link.b)} এক ব্যক্তি হিসেবে গণ্য হবে। চাইলে পরে আবার আলাদা করা যাবে।` : `${chan(link.a)} and ${chan(link.b)} will count as one person. You can separate them again later.`) : ''}
        confirmLabel={bn ? 'যুক্ত করুন' : 'Link'} cancelLabel={bn ? 'না' : 'No'}
        onCancel={() => setLink(null)}
        onConfirm={() => { const x = link; setLink(null); if (x) void act(() => va.identityLink([x.a.id, x.b.id]), bn ? 'যুক্ত হয়েছে' : 'Linked'); }} />
      <AppConfirmDialog visible={!!unlink} icon="link-variant-off" title={bn ? 'আলাদা করবেন?' : 'Separate them?'}
        description={unlink ? chan(unlink) : ''}
        confirmLabel={bn ? 'আলাদা করুন' : 'Separate'} cancelLabel={bn ? 'না' : 'No'}
        onCancel={() => setUnlink(null)}
        onConfirm={() => { const r = unlink; setUnlink(null); if (r) void act(() => va.identityUnlink(r.id), bn ? 'আলাদা হয়েছে' : 'Separated'); }} />
    </Fold>
  );
}

/** "Remembered facts" — what the assistant keeps about this person; the owner can add, correct, delete. */
function Facts({ contactId }: { contactId: string }) {
  const { bn, colors } = useKit();
  const { showSnackbar } = useAppFeedback();
  const facts = useLoad(() => va.facts(contactId), `facts:${contactId}`);
  const [adding, setAdding] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [drop, setDrop] = useState<Fact | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); await facts.reload(); showSnackbar(ok, 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
    finally { setBusy(false); }
  };
  const list = facts.data ?? [];

  return (
    <Fold title={bn ? 'মনে রাখা তথ্য' : 'Remembered facts'} count={list.length}>
      {facts.error && !facts.data ? <Muted>{facts.error}</Muted> : null}
      {facts.data && list.length === 0 ? <Muted>{bn ? 'এখনও কিছু মনে রাখা হয়নি' : 'Nothing remembered yet'}</Muted> : null}
      {list.map((f) => {
        const st = STATUS[f.status];
        return (
          <View key={f.id} style={{ gap: spacing.xs, padding: spacing.smd, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border }}>
            {editId === f.id ? (
              <>
                <Field label="" value={editText} onChangeText={setEditText} multiline />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <AppButton variant="secondary" label={bn ? 'সংশোধন রাখুন' : 'Save fix'} disabled={busy || !editText.trim()}
                    onPress={() => void act(async () => { await va.correctFact(contactId, f.id, editText.trim()); setEditId(null); }, bn ? 'সংশোধন হয়েছে' : 'Corrected')} />
                  <AppButton variant="ghost" label={bn ? 'থাক' : 'Cancel'} onPress={() => setEditId(null)} />
                </View>
              </>
            ) : (
              <>
                <Text style={{ textDecorationLine: f.status === 'superseded' ? 'line-through' : 'none' }}>{f.text}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
                  <AppBadge label={bn ? PROV[f.provenance].bn : PROV[f.provenance].en} tone={f.provenance === 'ai' ? 'warning' : 'neutral'} />
                  <AppBadge label={bn ? CONF[f.confidence].bn : CONF[f.confidence].en} tone="neutral" />
                  {st ? <AppBadge label={bn ? st.bn : st.en} tone="neutral" /> : null}
                </View>
                {f.provenance === 'ai' ? <Muted>{bn ? 'এটা সহকারীর অনুমান, নিশ্চিত তথ্য নয়। ভুল হলে শুধরে দিন।' : 'This is the assistant’s guess, not a sure fact. Correct it if wrong.'}</Muted> : null}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {f.status === 'active' || f.status === 'disputed' ? (
                    <AppButton variant="secondary" label={bn ? 'শুধরান' : 'Correct'} disabled={busy} onPress={() => { setEditId(f.id); setEditText(f.text); }} />
                  ) : null}
                  <AppButton variant="ghost" label={bn ? 'মুছুন' : 'Delete'} disabled={busy} onPress={() => setDrop(f)} />
                </View>
              </>
            )}
          </View>
        );
      })}
      <Field label={bn ? 'নতুন তথ্য যোগ করুন' : 'Add a fact'} value={adding} onChangeText={setAdding} placeholder={bn ? 'যেমন: সকালে ফোন ধরেন না' : 'e.g. does not answer mornings'} />
      <AppButton variant="secondary" icon="plus" label={bn ? 'যোগ করুন' : 'Add'} loading={busy} disabled={!adding.trim()}
        onPress={() => void act(async () => { await va.addFact(contactId, adding.trim()); setAdding(''); }, bn ? 'মনে রাখা হয়েছে' : 'Remembered')} />

      <AppConfirmDialog visible={!!drop} danger icon="trash-can-outline" title={bn ? 'এই তথ্য মুছবেন?' : 'Delete this fact?'} description={drop?.text ?? ''}
        confirmLabel={bn ? 'মুছুন' : 'Delete'} cancelLabel={bn ? 'না' : 'No'}
        onCancel={() => setDrop(null)}
        onConfirm={() => { const f = drop; setDrop(null); if (f) void act(() => va.removeFact(contactId, f.id), bn ? 'মুছে গেছে' : 'Deleted'); }} />
    </Fold>
  );
}

/** Hypotheses about the relationship: always labelled as guesses. */
function Relationship({ contactId }: { contactId: string }) {
  const { bn } = useKit();
  const rel = useLoad(() => va.relationship(contactId), `relationship:${contactId}`);
  const obs = rel.data?.observations ?? [];
  return (
    <Fold title={bn ? 'সম্পর্কের লক্ষণ (অনুমান)' : 'Relationship signs (guess)'} count={obs.length}>
      {rel.error && !rel.data ? <Muted>{rel.error}</Muted> : null}
      {rel.data && obs.length === 0 ? <Muted>{bn ? 'এখনও কোনো লক্ষণ ধরা পড়েনি' : 'No signs noticed yet'}</Muted> : null}
      {obs.map((o, i) => (
        <View key={i} style={{ gap: spacing.xs }}>
          <Text>{o.text}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <AppBadge label={bn ? 'অনুমান' : 'Guess'} tone="warning" />
            <AppBadge label={bn ? CONF[o.confidence].bn : CONF[o.confidence].en} tone="neutral" />
          </View>
          {o.basis ? <Muted>{bn ? 'কারণ: ' : 'Based on: '}{o.basis}</Muted> : null}
        </View>
      ))}
    </Fold>
  );
}

/** The three extra cards at the bottom of a contact screen. */
export function ContactMemory({ contactId }: { contactId: string }) {
  return (
    <>
      <SamePerson contactId={contactId} />
      <Facts contactId={contactId} />
      <Relationship contactId={contactId} />
    </>
  );
}
