import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { ON_DEVICE_PACKAGE, voiceOfflineStatus } from '../services/voice-offline-service';

// Voice input. The OS speech recogniser turns speech into text; our app records,
// stores and sends nothing itself. We hint the recogniser with the app's language
// (Bangla → bn-BD, English → en-US).
//
// Privacy-first engine choice: when the platform reports on-device recognition is
// available we ask for it (`requiresOnDeviceRecognition: true`) so nothing leaves the
// phone. If that attempt fails for this locale (no on-device language pack) we retry
// once WITHOUT the constraint, letting the OS use whatever engine works — so voice never
// simply "stops working". TTS uses the OS voices. Everything degrades gracefully when
// the recogniser is unavailable.
//
// Long-utterance handling: Android's recogniser often emits several `isFinal` chunks
// for one sentence (it finalises each time you pause). We accumulate every finalised
// chunk plus the live interim, and only hand the *whole* transcript to the caller when
// the session ends — so "half the sentence" can no longer be lost.

// 'network' is its own case, not folded into 'unavailable': it means the recogniser tried
// to reach Google's network service and there was no connection to reach it with — the
// exact shape of "the offline voice pack isn't downloaded yet" from the outside. Calling
// that "voice isn't available on this device" (the 'unavailable' message) told a person
// whose phone can do this perfectly well that it couldn't, with no way back from it.
type SpeechError = 'no-speech' | 'unavailable' | 'permission' | 'network' | null;

// Compared without punctuation or spacing, because the final result carries the
// recogniser's own punctuation while the segments folded in along the way do not.
function comparable(s: string): string {
  return s.replace(/[\s.,!?।৷;:'"()\-–—]+/gu, ' ').trim().toLowerCase();
}

function joinTranscript(base: string, next: string): string {
  const a = base.trim();
  const b = next.trim();
  if (!b) return a;
  if (!a) return b;
  const ca = comparable(a);
  const cb = comparable(b);
  // The recogniser sometimes re-sends the running transcript as a "final" chunk —
  // prefer its version when it is the same words, since it carries the punctuation.
  if (ca === cb) return b;
  if (ca.endsWith(cb)) return a;
  if (cb.startsWith(ca)) return b;
  return `${a} ${b}`;
}

export function useSpeech(language: 'bn' | 'en') {
  const locale = language === 'bn' ? 'bn-BD' : 'en-US';
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [lastError, setLastError] = useState<SpeechError>(null);
  const [supported] = useState(() => {
    try { return ExpoSpeechRecognitionModule.isRecognitionAvailable?.() ?? true; } catch { return false; }
  });
  const onFinalRef = useRef<((text: string) => void) | null>(null);
  const finalizedRef = useRef('');
  const interimRef = useRef('');
  const deliveredRef = useRef(false);
  // Whether the current attempt asked for on-device only, and whether we already fell
  // back to the unconstrained engine for this session (retry at most once).
  const onDeviceAttemptRef = useRef(false);
  const triedFallbackRef = useRef(false);
  // Set when the user stops (or a new session starts) so a scheduled fallback retry from
  // a just-failed on-device attempt can't re-open the recogniser behind their back.
  const cancelFallbackRef = useRef(false);
  // Bumped every startListening() — a queued fallback checks it still owns the session.
  const sessionRef = useRef(0);
  // Gboard-style dictation (the user's request, RC.5): a pause no longer ends it. Android's
  // recogniser still stops at a pause, so it is quietly started again and what was heard
  // so far is kept; everything is handed over when the person taps stop. It ends by itself
  // after two silent rounds in a row, or after five minutes, so a forgotten mic stops.
  const userStoppedRef = useRef(false);
  const startedAtRef = useRef(0);
  const silentRoundsRef = useRef(0);
  const heardAtRoundStartRef = useRef('');
  const restartingRef = useRef(false);
  // Whether a recogniser of ours is running. The native abort() sends "end" even when
  // nothing is running (ExpoSpeechService.teardownAndEnd), and that stray event used to
  // look like a finished dictation round: a second start was fired on top of the fresh
  // session, Google answered "busy", and the mic went off about a second in (rc.6 QA).
  const runningRef = useRef(false);
  const busyRetriesRef = useRef(0);

  const runningTranscript = useCallback(
    () => joinTranscript(finalizedRef.current, interimRef.current),
    [],
  );

  const deliver = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean || deliveredRef.current) return;
    deliveredRef.current = true;
    onFinalRef.current?.(clean);
  }, []);

  // One place that actually kicks off the recogniser. `onDevice` maps straight to
  // `requiresOnDeviceRecognition` so nothing leaves the phone when a local pack exists.
  const beginRecognition = useCallback((onDevice: boolean, keepText = false) => {
    onDeviceAttemptRef.current = onDevice;
    restartingRef.current = false;
    runningRef.current = true;
    heardAtRoundStartRef.current = finalizedRef.current;
    if (!keepText) setPartial('');
    setListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: locale,
      interimResults: true,
      // Deliberately false. `true` sounds like the fix for a pause cutting speech off,
      // but on Android 13+ (checked against expo-speech-recognition's own source,
      // ExpoSpeechService.kt) it switches to a completely different path — streaming the
      // microphone through its own audio source with `EXTRA_SEGMENTED_SESSION` keyed to
      // that source — which does not honor the EXTRA_SPEECH_INPUT_*_SILENCE_LENGTH_MILLIS
      // tuning below at all, so pauses cut off *sooner* and unpredictably. `false` keeps
      // the classic single-utterance path, where those three extras are read (confirmed:
      // they're applied via reflection unconditionally further down that same file) — so
      // the actual fix for a pause cutting speech short is the silence lengths below, not
      // this flag.
      continuous: false,
      requiresOnDeviceRecognition: onDevice,
      // Name the service that actually holds the downloaded packs. Without this, an
      // offline request could go to a different recogniser than the one the language
      // pack was installed into — which has no pack, so it fails, and with the data off
      // there is nothing to fall back to. Only sent for the on-device attempt: the
      // unconstrained retry below should be free to use whatever the phone prefers.
      ...(onDevice ? { androidRecognitionServicePackage: ON_DEVICE_PACKAGE } : {}),
      addsPunctuation: true,
      androidIntentOptions: {
        EXTRA_LANGUAGE_MODEL: 'free_form',
        EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 12000,
        // Give a spoken sentence real room to think mid-sentence, not just to finish a
        // word. These are the two extras that actually control it on this path.
        EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 6000,
        EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 5000,
      },
    });
  }, [locale]);

  useSpeechRecognitionEvent('result', (e) => {
    // Events are app-wide: Home and আপন can both hold this hook. Only the one listening takes them.
    if (!runningRef.current) return;
    const text = e.results?.[0]?.transcript ?? '';
    if (e.isFinal) {
      // Fold this finalised chunk into the accumulator; keep listening for more.
      finalizedRef.current = joinTranscript(finalizedRef.current, text);
      interimRef.current = '';
      setPartial(finalizedRef.current);
    } else if (text) {
      interimRef.current = text;
      setPartial(joinTranscript(finalizedRef.current, text));
    }
  });
  // Confirmed live on the V2317 (logcat, 2026-09-18): Google's recogniser keeps one session
  // open across short pauses but splits it into segments — each ends with onEndOfSpeech,
  // and the next segment's partial results start again from empty. Without folding here,
  // each segment overwrote the last and "আমার … গাড়ির নম্বর … কী" arrived as only "কী".
  useSpeechRecognitionEvent('speechend', () => {
    if (!runningRef.current || !interimRef.current) return;
    finalizedRef.current = joinTranscript(finalizedRef.current, interimRef.current);
    interimRef.current = '';
    setPartial(finalizedRef.current);
  });
  // One more round of listening, unless the person stopped, the session changed, it has
  // been silent twice running, or five minutes have passed. Returns whether it re-armed.
  const keepDictating = useCallback((): boolean => {
    if (userStoppedRef.current || deliveredRef.current || restartingRef.current) return false;
    if (Date.now() - startedAtRef.current > 5 * 60 * 1000) return false;
    if (interimRef.current) { finalizedRef.current = joinTranscript(finalizedRef.current, interimRef.current); interimRef.current = ''; }
    const heardSomething = comparable(finalizedRef.current) !== comparable(heardAtRoundStartRef.current);
    silentRoundsRef.current = heardSomething ? 0 : silentRoundsRef.current + 1;
    if (silentRoundsRef.current >= 2) return false;
    restartingRef.current = true;
    const token = sessionRef.current;
    const onDevice = onDeviceAttemptRef.current;
    setPartial(finalizedRef.current);
    // Let the finished recogniser session tear down before re-arming, as the fallback does.
    setTimeout(() => {
      if (token === sessionRef.current && !userStoppedRef.current && !deliveredRef.current) beginRecognition(onDevice, true);
      else restartingRef.current = false;
    }, 150);
    return true;
  }, [beginRecognition]);

  useSpeechRecognitionEvent('end', () => {
    if (restartingRef.current || !runningRef.current) return;
    runningRef.current = false;
    if (keepDictating()) return;
    // While a fallback retry is queued it owns the "listening" state; otherwise the
    // session is really over.
    const fallbackQueued = triedFallbackRef.current && onDeviceAttemptRef.current && !cancelFallbackRef.current;
    if (!fallbackQueued) setListening(false);
    const full = runningTranscript();
    setPartial('');
    if (full.trim()) deliver(full);
    else if (!deliveredRef.current) setLastError('no-speech');
  });
  useSpeechRecognitionEvent('error', (e) => {
    if (restartingRef.current || !runningRef.current) return;
    // The native side sends "end" right after every error; this error ends the round.
    runningRef.current = false;
    const code = (e as { error?: string })?.error ?? '';
    const quiet = code === 'no-speech' || code === 'no-match' || code === 'speech-timeout';
    // A pause in dictation arrives as "no speech": listen again rather than end.
    if (quiet && keepDictating()) return;
    // Google still tearing down the last round: wait a moment and try again, twice at most.
    if ((code === 'busy' || code === 'client') && !userStoppedRef.current && !deliveredRef.current && busyRetriesRef.current < 2) {
      busyRetriesRef.current += 1;
      restartingRef.current = true;
      const token = sessionRef.current;
      const onDevice = onDeviceAttemptRef.current;
      setTimeout(() => {
        if (token === sessionRef.current && !userStoppedRef.current && !deliveredRef.current) beginRecognition(onDevice, true);
        else restartingRef.current = false;
      }, 450);
      return;
    }
    const full = runningTranscript();
    if (full.trim()) { setListening(false); setPartial(''); deliver(full); return; }
    const recoverable = code !== 'no-speech' && code !== 'no-match' && code !== 'speech-timeout' && code !== 'aborted';
    // On-device was asked for but this locale has no local pack → one silent retry with
    // the unconstrained engine so voice still works.
    if (onDeviceAttemptRef.current && !triedFallbackRef.current && recoverable) {
      triedFallbackRef.current = true;
      deliveredRef.current = false;
      finalizedRef.current = '';
      interimRef.current = '';
      const token = sessionRef.current;
      // Let the failed recogniser session fully tear down before re-arming.
      setTimeout(() => {
        if (token === sessionRef.current && !cancelFallbackRef.current && !deliveredRef.current) beginRecognition(false);
      }, 180);
      return;
    }
    setListening(false);
    setPartial('');
    setLastError(
      code === 'no-speech' || code === 'no-match' || code === 'speech-timeout' ? 'no-speech'
        : code === 'network' ? 'network'
          : 'unavailable',
    );
  });

  const startListening = useCallback(async (onFinal: (text: string) => void) => {
    // If a previous session is still winding down (user tapped stop then mic again fast),
    // abort it and mark it delivered so its late `end`/`error` can't push a stale
    // transcript into this new session.
    deliveredRef.current = true;
    // Only when something is really running — abort() on an idle recogniser still sends a
    // stray "end" (see runningRef).
    if (runningRef.current || restartingRef.current) {
      try { ExpoSpeechRecognitionModule.abort(); } catch { /* nothing was running */ }
    }
    runningRef.current = false;
    busyRetriesRef.current = 0;
    onFinalRef.current = onFinal;
    finalizedRef.current = '';
    interimRef.current = '';
    deliveredRef.current = false;
    triedFallbackRef.current = false;
    cancelFallbackRef.current = false;
    userStoppedRef.current = false;
    restartingRef.current = false;
    silentRoundsRef.current = 0;
    startedAtRef.current = Date.now();
    sessionRef.current += 1;
    setLastError(null);
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) { setLastError('permission'); return false; }
      // `supportsOnDeviceRecognition` answers "this phone is capable of it", not "the
      // pack for this language is here". Asking for offline recognition in Bengali on a
      // phone with no Bengali pack fails, and — with mobile data off — the network retry
      // below has nothing to fall back to either, which is exactly the "voice does not
      // work offline" report. So the language's own pack is what decides.
      let onDevice = false;
      try {
        const capable = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition?.() ?? false;
        if (capable) onDevice = (await voiceOfflineStatus(language).catch(() => null))?.state === 'INSTALLED';
      } catch { onDevice = false; }
      beginRecognition(onDevice);
      return true;
    } catch {
      setListening(false);
      setLastError('unavailable');
      return false;
    }
  }, [beginRecognition, language]);

  const stopListening = useCallback(() => {
    // stop() asks for a final result; abort() would drop it. Prefer stop().
    cancelFallbackRef.current = true;
    userStoppedRef.current = true;
    // Stopped in the gap between two dictation rounds: no recogniser is running to send
    // its "end", so hand over what was heard now.
    if (restartingRef.current) {
      restartingRef.current = false;
      const full = runningTranscript();
      setPartial('');
      if (full.trim()) deliver(full);
    }
    try { ExpoSpeechRecognitionModule.stop(); } catch { /* noop */ }
    setListening(false);
  }, [deliver, runningTranscript]);

  const speak = useCallback((text: string) => {
    try { Speech.speak(text, { language: locale, rate: 1.0 }); } catch { /* noop */ }
  }, [locale]);

  const stopSpeaking = useCallback(() => { try { Speech.stop(); } catch { /* noop */ } }, []);

  useEffect(() => () => {
    cancelFallbackRef.current = true;
    try { ExpoSpeechRecognitionModule.abort(); } catch { /* noop */ }
    try { Speech.stop(); } catch { /* noop */ }
  }, []);

  return { supported, listening, partial, lastError, startListening, stopListening, speak, stopSpeaking };
}
