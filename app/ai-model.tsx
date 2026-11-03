import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { LlmIssueCard } from '../src/ui/LlmIssueCard';
import { DeviceAdviceCard } from '../src/ui/DeviceAdviceCard';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppPreferences } from '../src/app/AppPreferences';
import { AppIcon } from '../src/ui/AppIcon';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { aiModelCopy } from '../src/i18n/ai-model';
import { recommendModels, type Recommendation } from '../src/ai/model/model-catalog';
import { lastLoadDidNotFinish } from '../src/ai/model/llama-runtime';
import { runAssistantConnectionTest } from '../src/ai/engine/connection-test';
import { getPreferredEngineId, setPreferredEngineId } from '../src/ai/engine/registry';
import { asciiDigitsToBengali } from '../src/services/debt/money';
import { formatBangladeshDateTime } from '../src/i18n/date-time';
import {
  loadInstalledModel, pickAndImportModel, pickAndImportMmproj, removeMmproj, removeModel, verifyModel, probeRuntime, maxModelSizeMB, readPhoneFacts,
  ModelImportError, type InstalledModel, type VerifyReport, type CheckStatus,
} from '../src/ai/model/model-manager';
import { border, elevation, icon, layout, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../src/theme';

const STATUS_ICON: Record<CheckStatus, { name: string; tone: 'green' | 'orange' | 'red' | 'blue' }> = {
  pass: { name: 'check-circle', tone: 'green' },
  warn: { name: 'alert-circle-outline', tone: 'orange' },
  fail: { name: 'close-circle-outline', tone: 'red' },
  skip: { name: 'minus-circle-outline', tone: 'blue' },
};

export default function AiModelScreen() {
  const db = useSQLiteContext();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const c = aiModelCopy(language);
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const { showSnackbar } = useAppFeedback();

  const [model, setModel] = useState<InstalledModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [pickingVision, setPickingVision] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // What this phone is offered — read from the phone itself each time the screen opens.
  const [rec, setRec] = useState<Recommendation | null>(null);
  useEffect(() => { void readPhoneFacts().then((f) => setRec(recommendModels(f))).catch(() => setRec(recommendModels({ totalRamMB: null, freeDiskMB: null, arm64: true, yearClass: null }))); }, []);
  const runtime = useMemo(() => probeRuntime(), []);
  const maxMB = useMemo(() => maxModelSizeMB(), []);
  const [testing, setTesting] = useState(false);
  const [engineId, setEngineId] = useState<string | null>(null);
  useEffect(() => { void getPreferredEngineId(db).then(setEngineId).catch(() => {}); }, [db]);
  const applyToAssistant = async (on: boolean) => {
    const id = on ? 'on-device-llm' : 'local-rules';
    await setPreferredEngineId(db, id);
    setEngineId(id);
    showSnackbar(on ? (bn ? 'আপন এখন AI ব্যবহার করবে' : 'Apon will now use the AI') : (bn ? 'আপন সাধারণ মোডে ফিরল' : 'Apon is back to the built-in mode'), 'success');
  };

  useEffect(() => {
    let active = true;
    loadInstalledModel(db)
      .then((m) => { if (!active) return; setModel(m); setReport(m?.lastReport ?? null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [db]);

  const onPickVision = async () => {
    if (pickingVision) return;
    setPickingVision(true);
    try {
      const m = await pickAndImportMmproj(db, language);
      if (m) { setModel(m); showSnackbar(bn ? 'ছবি পড়ার ফাইল যোগ হয়েছে।' : 'Picture file added.', 'success'); }
    } catch (e) {
      showSnackbar(e instanceof ModelImportError ? e.message : (bn ? 'যোগ করা গেল না।' : 'Could not add it.'), 'danger');
    } finally {
      setPickingVision(false);
    }
  };

  const onRemoveVision = async () => {
    if (pickingVision) return;
    setPickingVision(true);
    try {
      setModel(await removeMmproj(db));
    } finally {
      setPickingVision(false);
    }
  };

  const onPick = async () => {
    if (picking) return;
    setPicking(true);
    setReport(null);
    try {
      const m = await pickAndImportModel(db, language);
      if (m) { setModel(m); showSnackbar(bn ? 'মডেল যোগ হয়েছে — এবার যাচাই করুন।' : 'Model added — now verify it.', 'success'); }
    } catch (e) {
      const msg = e instanceof ModelImportError ? e.message : (bn ? 'যোগ করা গেল না।' : 'Could not add it.');
      showSnackbar(msg, 'danger');
    } finally {
      setPicking(false);
    }
  };

  const onVerify = async () => {
    if (!model || verifying) return;
    setVerifying(true);
    try {
      const r = await verifyModel(db, model);
      setReport(r);
      // Step 7, only after the six checks pass: the Assistant's own path, end to end.
      if (r.ok && runtime.available) {
        setModel(await loadInstalledModel(db));
        setTesting(true);
        try { await runAssistantConnectionTest(db, bn ? 'bn' : 'en'); } finally { setTesting(false); }
      }
      const fresh = await loadInstalledModel(db);
      setModel(fresh);
      showSnackbar(r.ok ? (runtime.available ? c.resultReady : c.resultChecked) : c.resultProblem, r.ok && runtime.available ? 'success' : r.ok ? 'info' : 'danger');
    } finally {
      setVerifying(false);
    }
  };

  const onRemove = async () => {
    setConfirmRemove(false);
    await removeModel(db);
    setModel(null);
    setReport(null);
    showSnackbar(bn ? 'মডেল সরানো হয়েছে।' : 'Model removed.', 'info');
  };


  const sizeMB = model ? Math.round(model.sizeBytes / (1024 * 1024)) : 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}>
          <AppIcon name="arrow-left" size={icon.md} color={colors.primary} />
          <Text style={styles.backText}>{c.back}</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <View style={styles.titleIcon}><AppIcon name="head-cog-outline" size={icon.lg} color={accents.purple.on} /></View>
          <View style={styles.titleCopy}>
            <Text style={styles.eyebrow}>{c.eyebrow}</Text>
            <Text style={styles.title}>{c.title}</Text>
          </View>
        </View>
        <Text style={styles.intro}>{c.intro}</Text>
        <LlmIssueCard showKilled={false} />
        <DeviceAdviceCard />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* The crash-loop guard switched the model off — say so plainly, and how to retry. */}
        {model && lastLoadDidNotFinish() ? (
          <View style={[styles.card, { borderColor: colors.warning, borderWidth: 1 }]} accessibilityRole="alert">
            <View style={styles.modelHead}>
              <View style={styles.modelIcon}><AppIcon name="alert-outline" size={icon.md} color={colors.warning} /></View>
              <View style={styles.modelCopy}>
                <Text style={styles.modelName}>{bn ? 'AI এখন বন্ধ রাখা হয়েছে' : 'AI has been switched off'}</Text>
                <Text style={styles.modelMeta}>{bn
                  ? 'গতবার এই মডেল চালু করার সময় অ্যাপ বন্ধ হয়ে গিয়েছিল — সম্ভবত ফোনের RAM কম পড়েছিল। একই ভাবে আবার বন্ধ না হতে AI বন্ধ রাখা হয়েছে; আপন সাধারণ মোডে ঠিকঠাক চলছে। ছোট মডেল নিন, অথবা নিচে আবার "যাচাই" করে দেখুন — যাচাই সফল হলে AI নিজে থেকে আবার চালু হবে।'
                  : 'Last time this model was started, the app closed — most likely the phone ran short of memory. So the AI is off to stop it happening again; Apon works normally without it. Pick a smaller model, or verify again below — a successful check turns the AI back on.'}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Installed model */}
        <Text style={styles.section}>{c.installed}</Text>
        {/* The phone check, before anyone copies a multi-GB file over. */}
        {maxMB != null ? (
          <Text style={styles.stepDetail}>{maxMB === 0
            ? (bn ? 'এই ফোনে RAM ৪ GB-এর কম — AI মডেল চালানো নিরাপদ নয়। আপন সাধারণ মোডে পুরোপুরি কাজ করবে।' : 'This phone has under 4 GB RAM — running an AI model is not safe here. Apon works fully in its built-in mode.')
            : (bn ? `এই ফোনে নিরাপদে চলবে প্রায় ${String((maxMB / 1024).toFixed(1)).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!)} GB পর্যন্ত আকারের মডেল — নিচের তালিকার ⭐ মডেলটি বেছে নেওয়াই সবচেয়ে সহজ।` : `This phone can safely run a model of up to ~${maxMB} MB (a small model of about 1–2 GB is best).`)}</Text>
        ) : null}
        <View style={styles.card}>
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : model ? (
            <>
              <View style={styles.modelHead}>
                <View style={styles.modelIcon}><AppIcon name="cube-outline" size={icon.md} color={accents.blue.on} /></View>
                <View style={styles.modelCopy}>
                  <Text style={styles.modelName} numberOfLines={2}>{model.name}</Text>
                  <Text style={styles.modelMeta}>{c.size}: {sizeMB} MB{model.verifiedAt ? `  ·  ${runtime.available ? c.resultReady : c.resultChecked}` : ''}</Text>
                </View>
              </View>
              <View style={styles.specRow}>
                <Spec label={c.arch} value={model.summary.architecture ?? '—'} styles={styles} />
                <Spec label={c.quant} value={model.summary.quantLabel} styles={styles} />
                <Spec label={c.context} value={model.summary.contextLength ? (bn ? asciiDigitsToBengali(String(model.summary.contextLength)) : String(model.summary.contextLength)) : '—'} styles={styles} />
              </View>
              <View style={styles.actionRow}>
                <Pressable accessibilityRole="button" disabled={verifying} onPress={() => void onVerify()} style={({ pressed }) => StyleSheet.flatten([styles.primaryBtn, verifying && styles.disabled, pressed && styles.pressed])}>
                  {verifying ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <><AppIcon name="shield-check-outline" size={icon.sm} color={colors.onPrimary} /><Text style={styles.primaryBtnText}>{report ? c.verifyAgain : c.verify}</Text></>}
                </Pressable>
                <Pressable accessibilityRole="button" disabled={picking} onPress={() => void onPick()} style={({ pressed }) => StyleSheet.flatten([styles.ghostBtn, pressed && styles.pressed])}>
                  <AppIcon name="file-replace-outline" size={icon.sm} color={colors.primary} />
                  <Text style={styles.ghostBtnText}>{c.replace}</Text>
                </Pressable>
              </View>
              {/* The vision half is a second file, so it is asked for separately and stays
                  optional — a text-only model is still good for everything else. */}
              <View style={styles.visionBox}>
                <View style={styles.visionHead}>
                  <AppIcon name={model.mmprojPath ? 'eye-check-outline' : 'eye-outline'} size={icon.sm} color={model.mmprojPath ? accents.green.on : colors.textMuted} />
                  <Text style={styles.visionTitle}>{c.visionTitle}</Text>
                  {model.mmprojPath ? <Text style={styles.visionOn}>{c.visionOn}</Text> : null}
                </View>
                <Text style={styles.visionBody}>{model.mmprojName ?? c.visionBody}</Text>
                <Pressable accessibilityRole="button" disabled={pickingVision} onPress={() => void (model.mmprojPath ? onRemoveVision() : onPickVision())} style={({ pressed }) => StyleSheet.flatten([styles.ghostBtn, pressed && styles.pressed])}>
                  {pickingVision ? <ActivityIndicator color={colors.primary} size="small" /> : <><AppIcon name={model.mmprojPath ? 'eye-off-outline' : 'image-plus'} size={icon.sm} color={colors.primary} /><Text style={styles.ghostBtnText}>{model.mmprojPath ? c.visionRemove : c.visionAdd}</Text></>}
                </Pressable>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setConfirmRemove(true)} hitSlop={8} style={({ pressed }) => StyleSheet.flatten([styles.removeLink, pressed && styles.pressed])}>
                <AppIcon name="delete-outline" size={icon.xs} color={colors.danger} />
                <Text style={styles.removeLinkText}>{c.remove}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.emptyText}>{c.notInstalled}</Text>
              <Pressable accessibilityRole="button" disabled={picking} onPress={() => void onPick()} style={({ pressed }) => StyleSheet.flatten([styles.primaryBtn, styles.primaryBtnWide, picking && styles.disabled, pressed && styles.pressed])}>
                {picking ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <><AppIcon name="folder-open-outline" size={icon.sm} color={colors.onPrimary} /><Text style={styles.primaryBtnText}>{c.pick}</Text></>}
              </Pressable>
            </>
          )}
        </View>

        {/* Verify report */}
        {report ? (
          <View style={[styles.card, styles.reportCard, { borderColor: report.ok && runtime.available ? accents.green.border : accents.orange.border }]}>
            <View style={styles.reportHead}>
              <AppIcon name={report.ok && runtime.available ? 'check-decagram' : 'alert-decagram-outline'} size={icon.md} color={report.ok && runtime.available ? accents.green.on : accents.orange.on} />
              <Text style={[styles.reportTitle, { color: report.ok && runtime.available ? accents.green.on : accents.orange.on }]}>{report.ok ? (runtime.available ? c.resultReady : c.resultChecked) : c.resultProblem}</Text>
            </View>
            {report.steps.map((s) => {
              const si = STATUS_ICON[s.status];
              return (
                <View key={s.id} style={styles.step}>
                  <AppIcon name={si.name as never} size={icon.sm} color={accents[si.tone].on} />
                  <View style={styles.stepCopy}>
                    <Text style={styles.stepLabel}>{s.label[language]}</Text>
                    <Text style={styles.stepDetail}>{s.detail[language]}</Text>
                  </View>
                </View>
              );
            })}
            <Text style={styles.reportTime}>{c.lastChecked}: {formatBangladeshDateTime(report.ranAt, language)}</Text>
          </View>
        ) : null}

        {/* Step 7 — is the Assistant actually using it? The one answer a user can trust. */}
        {model && (testing || model.connectionTest) ? (() => {
          const ct = model.connectionTest;
          const ok = Boolean(ct?.ok) && !testing;
          const tone = testing ? accents.blue : ok ? accents.green : accents.orange;
          const why = ct?.fallback === 'timeout'
            ? (bn ? 'AI সময়মতো উত্তর লিখতে পারেনি — ফোনে মডেলটি খুব ধীর। ছোট মডেল নিন।' : 'The AI did not finish in time — the model is too slow on this phone. Pick a smaller one.')
            : ct?.fallback === 'rejected'
              ? (bn ? 'AI লিখেছে, কিন্তু তথ্য অক্ষত রাখেনি — তাই আপন একে ব্যবহার করবে না।' : 'The AI wrote something, but did not keep the fact intact — so Apon will not use it.')
              : (bn ? 'আপন-এর পথে AI চালানো গেল না।' : 'The AI could not run through Apon’s path.');
          return (
            <View style={[styles.card, styles.reportCard, { borderColor: tone.border }]}>
              <View style={styles.reportHead}>
                {testing ? <ActivityIndicator color={tone.on} /> : <AppIcon name={ok ? 'link-variant' : 'link-variant-off'} size={icon.md} color={tone.on} />}
                <Text style={[styles.reportTitle, { color: tone.on }]}>{testing
                  ? (bn ? 'আপন-এর সাথে সংযোগ পরীক্ষা চলছে…' : 'Testing Apon connection…')
                  : ok ? (bn ? '✓ আপন-এর সাথে যুক্ত' : '✓ Connected to Apon') : (bn ? 'আপন-এর সাথে যুক্ত হয়নি' : 'Not connected to Apon')}</Text>
              </View>
              <Text style={styles.stepDetail}>{testing
                ? (bn ? 'আপন যে পথে উত্তর লেখে, ঠিক সেই পথে AI দিয়ে একটা নমুনা উত্তর লেখানো হচ্ছে। প্রথমবার ১০-৪০ সেকেন্ড লাগতে পারে।' : 'Writing a sample answer with the AI through Apon’s exact path. The first run can take 10-40 seconds.')
                : ok ? (bn ? `AI নিজে লিখেছে: “${ct?.sample}” · ${((ct?.ms ?? 0) / 1000).toFixed(1)} সেকেন্ড` : `The AI wrote: “${ct?.sample}” · ${((ct?.ms ?? 0) / 1000).toFixed(1)} s`) : why}</Text>
              {ok ? (engineId === 'on-device-llm' ? (
                <>
                  <Text style={[styles.stepLabel, { color: accents.green.on, marginTop: spacing.sm }]}>{bn ? '✅ আপন এখন AI ব্যবহার করছে' : '✅ Apon is using the AI now'}</Text>
                  <Pressable accessibilityRole="button" onPress={() => void applyToAssistant(false)} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}>
                    <Text style={styles.ghostBtnText}>{bn ? 'AI বন্ধ করে সাধারণ মোডে ফিরুন' : 'Turn the AI off'}</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable accessibilityRole="button" onPress={() => void applyToAssistant(true)} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.primaryBtnText}>{bn ? 'আপন-এ AI চালু করুন' : 'Use the AI in Apon'}</Text>
                </Pressable>
              )) : null}
            </View>
          );
        })() : null}

        {/* Runtime-missing explainer */}
        {!runtime.available ? (
          <View style={[styles.card, styles.noticeCard]}>
            <View style={styles.noticeHead}>
              <AppIcon name="information-outline" size={icon.md} color={accents.blue.on} />
              <Text style={styles.noticeTitle}>{c.runtimeMissingTitle}</Text>
            </View>
            <Text style={styles.noticeBody}>{c.runtimeMissingBody}</Text>
          </View>
        ) : null}

        {/* Add an AI in three steps — the list is worked out for THIS phone (model-catalog). */}
        <Text style={styles.section}>{bn ? 'AI যোগ করুন — সহজ ৩ ধাপ' : 'Add an AI — 3 easy steps'}</Text>
        {rec == null ? (
          <ActivityIndicator color={colors.primary} />
        ) : rec.kind === 'none' ? (
          <View style={styles.card}>
            <Text style={styles.freeName}>{bn ? 'এই ফোনে এখন AI যোগ করা যাবে না' : 'An AI cannot be added on this phone right now'}</Text>
            <Text style={styles.freeStrength}>{rec.reason === 'low-space'
              ? (bn ? `ফোনে জায়গা কম। আরও প্রায় ${((rec.needMoreMB ?? 0) / 1024).toFixed(1)} GB খালি করলে একটা AI নামানো যাবে। ` : `Not enough free space. Free about ${((rec.needMoreMB ?? 0) / 1024).toFixed(1)} GB more and an AI will fit. `)
              : rec.reason === 'low-ram'
                ? (bn ? 'এই ফোনের মেমোরি (RAM) AI চালানোর জন্য যথেষ্ট নয়। ' : 'This phone’s memory (RAM) is not enough to run an AI. ')
                : (bn ? 'এই ফোনের ধরনে AI চলে না। ' : 'This kind of phone cannot run the AI. ')}
              {bn ? 'চিন্তা নেই — AI ছাড়াও আপন সব কাজ পুরোপুরি করে।' : 'No problem — Apon does everything without it.'}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.freeIntro}>{bn
              ? '১। নিচে আপনার ফোন দেখে বেছে দেওয়া AI আছে। একটায় "ডাউনলোড করুন" চাপুন — ফোনের ব্রাউজার নিজেই নামাবে (Wi-Fi চালু রাখুন, নোটিফিকেশন-এ অগ্রগতি দেখবেন)।'
              : '1. Below are AIs picked for your phone. Tap "Download" on one — the phone’s browser fetches it (keep Wi-Fi on; progress shows in notifications).'}</Text>
            {rec.items.map((s) => (
              <View key={s.model.id} style={[styles.card, s.star && { borderColor: accents.green.border, borderWidth: 2 }]}>
                {s.star ? <Text style={[styles.freeMeta, { color: accents.green.on, fontWeight: '800' }]}>⭐ {bn ? 'আপনার ফোনের জন্য সেরা' : 'Best for your phone'}</Text> : null}
                <Text style={styles.freeName}>{s.model.name}</Text>
                <Text style={styles.freeStrength}>{s.model.blurb[language]}</Text>
                <Text style={styles.freeMeta}>{`${(s.model.sizeMB / 1024).toFixed(1)} GB · ${{ fast: bn ? 'দ্রুত' : 'fast', medium: bn ? 'মাঝারি গতি' : 'medium speed', slow: bn ? 'ধীর' : 'slow' }[s.speed]}${bn ? ' (আনুমানিক)' : ' (estimate)'}${s.model.testedOnPhone ? (bn ? ' · ✓ ফোনে পরীক্ষিত' : ' · ✓ tested on a phone') : ''}`}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`${bn ? 'ডাউনলোড করুন' : 'Download'} ${s.model.name}`} onPress={() => void Linking.openURL(s.model.url)} style={({ pressed }) => [styles.primaryBtn, styles.primaryBtnWide, pressed && styles.pressed]}>
                  <AppIcon name="download" size={icon.sm} color={colors.onPrimary} />
                  <Text style={styles.primaryBtnText}>{bn ? 'ডাউনলোড করুন' : 'Download'}</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.card}>
              {(bn
                ? ['২। নামা শেষ হলে এখানে ফিরে উপরে "মডেল ফাইল বেছে নিন" চাপুন → "Downloads" খুলুন → নামানো ফাইলটা চাপুন।', '৩। "যাচাই করুন" চাপুন। সব সবুজ হলে "আপন-এ AI চালু করুন" চাপুন — ব্যাস।']
                : ['2. When the download finishes, come back and tap "Choose a model file" above → open "Downloads" → tap the downloaded file.', '3. Tap "Verify". When everything is green, tap "Use the AI in Apon" — done.']
              ).map((line) => (
                <View key={line} style={styles.howRow}>
                  <AppIcon name="circle-small" size={icon.md} color={colors.primary} />
                  <Text style={styles.howText}>{line}</Text>
                </View>
              ))}
            </View>
          </>
        )}
        <View style={styles.footerRow}>
          <AppIcon name="shield-check-outline" size={icon.xs} color={colors.success} />
          <Text style={styles.footer}>{bn ? '১০০% অফলাইন — মডেল ও যাচাই সবই এই ফোনে।' : '100% offline — the model and every check stay on this phone.'}</Text>
        </View>
      </ScrollView>

      <AppConfirmDialog
        visible={confirmRemove}
        title={c.removeConfirmTitle}
        description={c.removeConfirmBody}
        confirmLabel={c.removeConfirm}
        cancelLabel={c.cancel}
        danger
        onConfirm={() => void onRemove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </View>
  );
}

function Spec({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.spec}>
      <Text style={styles.specLabel}>{label}</Text>
      <Text style={styles.specValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, borderBottomWidth: border.thin, borderBottomColor: colors.border },
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    titleIcon: { width: 44, height: 44, borderRadius: radius.lg, backgroundColor: accents.purple.soft, alignItems: 'center', justifyContent: 'center' },
    titleCopy: { flex: 1, minWidth: 0 },
    eyebrow: { color: colors.primary, ...typography.label, fontWeight: '700', letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700', marginTop: spacing.xxs },
    intro: { color: colors.textSecondary, ...typography.bodySmall, lineHeight: 20, marginTop: spacing.sm },
    content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
    section: { color: colors.textMuted, ...typography.section, fontWeight: '700', letterSpacing: 1.1, marginTop: spacing.lg, marginBottom: spacing.sm },
    card: { backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, ...elevation.soft, marginBottom: spacing.sm },
    modelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    modelIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: accents.blue.soft, alignItems: 'center', justifyContent: 'center' },
    modelCopy: { flex: 1, minWidth: 0 },
    modelName: { color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    modelMeta: { color: colors.textMuted, ...typography.caption, marginTop: spacing.xxs },
    specRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    spec: { flex: 1, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.sm, paddingVertical: spacing.smd },
    specLabel: { color: colors.textMuted, ...typography.caption, fontWeight: '700' },
    specValue: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '800', marginTop: 2 },
    actionRow: { gap: spacing.sm, marginTop: spacing.md }, // stacked: side by side the labels wrapped into three lines (RC.3)
    primaryBtn: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: spacing.md },
    primaryBtnWide: { marginTop: spacing.md },
    primaryBtnText: { color: colors.onPrimary, ...typography.bodySmall, fontWeight: '700' },
    ghostBtn: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
    ghostBtnText: { color: colors.primary, ...typography.bodySmall, fontWeight: '800' },
    visionBox: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: border.thin, borderTopColor: colors.border, gap: spacing.xs },
    visionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    visionTitle: { flexShrink: 1, color: colors.textPrimary, ...typography.meta, fontWeight: '800' },
    visionOn: { color: accents.green.on, ...typography.caption, fontWeight: '800' },
    visionBody: { color: colors.textSecondary, ...typography.caption },
    removeLink: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.xs },
    removeLinkText: { color: colors.danger, ...typography.caption, fontWeight: '800' },
    emptyText: { color: colors.textSecondary, ...typography.bodySmall, textAlign: 'center' },
    disabled: { opacity: 0.5 },
    reportCard: { borderWidth: border.thin },
    reportHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    reportTitle: { ...typography.body, fontWeight: '700' },
    step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm },
    stepCopy: { flex: 1, minWidth: 0 },
    stepLabel: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '800' },
    stepDetail: { color: colors.textSecondary, ...typography.caption, lineHeight: 17, marginTop: 2 },
    reportTime: { color: colors.textMuted, ...typography.caption, marginTop: spacing.md },
    noticeCard: { backgroundColor: accents.blue.soft, borderColor: accents.blue.border },
    noticeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    noticeTitle: { color: accents.blue.on, ...typography.body, fontWeight: '700' },
    noticeBody: { color: colors.textSecondary, ...typography.caption, lineHeight: 18, marginTop: spacing.xs },
    freeIntro: { color: colors.textSecondary, ...typography.caption, lineHeight: 17, marginBottom: spacing.sm },
    freeName: { color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    freeStrength: { color: colors.textSecondary, ...typography.caption, lineHeight: 17, marginTop: spacing.xxs },
    freeMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    freeMeta: { color: colors.textMuted, ...typography.caption, fontWeight: '700' },
    freeLinkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    freeLink: { flex: 1, color: colors.textMuted, ...typography.caption, fontFamily: typography.numeric.fontFamily },
    copyBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
    copyBtnText: { color: colors.primary, ...typography.caption, fontWeight: '800' },
    howRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: spacing.xs },
    howText: { flex: 1, color: colors.textSecondary, ...typography.bodySmall, lineHeight: 20 },
    footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: border.thin, borderTopColor: colors.border },
    footer: { color: colors.textMuted, ...typography.caption },
    pressed: { opacity: 0.78 },
  });
}
