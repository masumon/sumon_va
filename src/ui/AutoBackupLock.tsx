import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text, AppTextInput as TextInput } from './AppText';
import { AppIcon, type IconName } from './AppIcon';
import { AppConfirmDialog, useAppFeedback } from './AppFeedback';
import { useAppPreferences } from '../app/AppPreferences';
import { LAST_AUTO_BACKUP_KEY, readAutoBackupPassphrase, runAutoBackup, setAutoBackupPassphrase } from '../services/auto-backup-service';
import { chooseAppFolder } from '../services/app-folder-service';
import { beginDbBurst, endDbBurst } from '../services/db-busy-guard';
import { formatBangladeshDateTime } from '../i18n/date-time';
import { border, control, layout, radius, spacing, typography, type ThemeColors } from '../theme';

// The weekly automatic backup, at a glance (RC.2 — the old card said little more than
// "তালা", and its buttons were cut off): is it on, when did it last run, where is it kept,
// is it locked. Every change is the person's own tap — nothing here switches on by itself.
// D8 / B-07: the password is asked once and opens the file again from "Restore" below.
//
// Everything about the weekly backup lives here — on/off, folder, "back up now", lock.
// Settings used to hold a second on/off switch that behaved differently (it asked for a
// folder; the button here did not); Settings now only links to this card.
export function AutoBackupLock() {
  const db = useSQLiteContext();
  const { colors, language, autoBackup, setAutoBackup, autoBackupFolderUri, setAutoBackupFolderUri } = useAppPreferences();
  const { showSnackbar } = useAppFeedback();
  const [backingUp, setBackingUp] = useState(false);
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [locked, setLocked] = useState<boolean | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [p, last] = await Promise.all([
      readAutoBackupPassphrase(db).catch(() => null),
      db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', LAST_AUTO_BACKUP_KEY).catch(() => null),
    ]);
    setLocked(Boolean(p));
    setLastRun(last?.value ?? null);
  }, [db]);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      readAutoBackupPassphrase(db).catch(() => null),
      db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', LAST_AUTO_BACKUP_KEY).catch(() => null),
    ]).then(([p, last]) => { if (alive) { setLocked(Boolean(p)); setLastRun(last?.value ?? null); } });
    return () => { alive = false; };
  }, [db]);

  const save = async () => {
    if (pass.trim().length < 6) { setNote({ ok: false, text: bn ? 'পাসওয়ার্ড অন্তত ৬ অক্ষরের দিন।' : 'Use at least 6 characters.' }); return; }
    if (pass.trim() !== again.trim()) { setNote({ ok: false, text: bn ? 'দুটো ঘরে একই পাসওয়ার্ড লিখুন — এখন মিলছে না।' : 'Type the same password in both boxes — they do not match.' }); return; }
    await setAutoBackupPassphrase(db, pass);
    setPass(''); setAgain(''); setEditing(false);
    setNote({ ok: true, text: bn ? 'তালা দেওয়া হয়েছে। এখন থেকে প্রতিটি অটো-ব্যাকআপ এই পাসওয়ার্ড দিয়ে তালাবদ্ধ থাকবে।' : 'Locked. Every automatic backup from now on is locked with this password.' });
    await refresh();
  };
  const remove = async () => {
    setConfirmRemove(false);
    await setAutoBackupPassphrase(db, null);
    setNote({ ok: true, text: bn ? 'তালা সরানো হয়েছে — পরের অটো-ব্যাকআপ তালা ছাড়া থাকবে।' : 'Lock removed — the next automatic backup will not be locked.' });
    await refresh();
  };

  // The same three actions, and the same messages, that Settings had.
  const pickFolder = async () => {
    const uri = await chooseAppFolder(db);
    if (uri) await setAutoBackupFolderUri(uri);
  };
  const turnOn = async () => {
    await setAutoBackup(true);
    if (!autoBackupFolderUri) await pickFolder();
    await refresh();
  };
  const backupNow = async () => {
    if (backingUp) return;
    setBackingUp(true);
    beginDbBurst('backup-now');
    try {
      const r = await runAutoBackup(db, autoBackupFolderUri, { force: true });
      if (!r.ran) { console.error('[auto-backup] failed:', r.folderError); showSnackbar(bn ? 'ব্যাকআপ নেওয়া যায়নি' : 'Backup failed', 'danger'); }
      else if (autoBackupFolderUri && !r.folderWritten) showSnackbar(bn ? 'এই ফোনে সেভ হয়েছে; ফোল্ডারে লেখা যায়নি' : 'Saved on this phone; could not write to the folder', 'info');
      else showSnackbar(bn ? 'ব্যাকআপ সম্পন্ন' : 'Backup done', 'success');
    } catch (error) {
      console.error('[auto-backup] threw:', error);
      showSnackbar(bn ? 'ব্যাকআপ নেওয়া যায়নি' : 'Backup failed', 'danger');
    } finally {
      endDbBurst('backup-now');
      setBackingUp(false);
      await refresh();
    }
  };

  if (locked === null) return null;

  const rows: { icon: IconName; good: boolean; label: string; value: string }[] = [
    { icon: autoBackup ? 'calendar-check-outline' : 'calendar-remove-outline', good: autoBackup, label: bn ? 'অটো-ব্যাকআপ' : 'Automatic backup', value: autoBackup ? (bn ? 'চালু — প্রতি সপ্তাহে একবার' : 'On — once a week') : (bn ? 'বন্ধ' : 'Off') },
    { icon: 'history', good: Boolean(lastRun), label: bn ? 'শেষ অটো-ব্যাকআপ' : 'Last automatic backup', value: lastRun ? formatBangladeshDateTime(lastRun, language) : (bn ? 'এখনো হয়নি' : 'Not yet') },
    { icon: 'folder-outline', good: true, label: bn ? 'কোথায় থাকে' : 'Kept in', value: autoBackupFolderUri ? (bn ? 'ফোনের ভেতরে + Documents › Apon' : 'Inside the app + Documents › Apon') : (bn ? 'অ্যাপের ভেতরে' : 'Inside the app') },
    { icon: locked ? 'lock-check-outline' : 'lock-open-alert-outline', good: locked, label: bn ? 'তালা' : 'Lock', value: locked ? (bn ? 'দেওয়া আছে — পাসওয়ার্ড ছাড়া কেউ খুলতে পারবে না' : 'On — nobody can open it without the password') : (bn ? 'নেই — ফাইল পেলে যে কেউ পড়তে পারবে' : 'Off — anyone who gets the file can read it') },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.headIcon, { backgroundColor: colors.surfaceMuted }]}>
          <AppIcon name="shield-refresh-outline" size={control.iconSize} color={locked && autoBackup ? colors.success : colors.primary} />
        </View>
        <View style={styles.headCopy}>
          <Text style={styles.title}>{bn ? 'সাপ্তাহিক অটো-ব্যাকআপ' : 'Weekly automatic backup'}</Text>
          <Text style={styles.subtitle}>{bn ? 'নিজে থেকে আপনার তথ্যের একটি কপি রাখে' : 'Keeps a copy of your data by itself'}</Text>
        </View>
      </View>

      <View style={styles.status}>
        {rows.map((r) => (
          <View key={r.label} style={styles.statusRow}>
            <AppIcon name={r.icon} size={control.iconSize} color={r.good ? colors.success : colors.warning} />
            <View style={styles.statusCopy}>
              <Text style={styles.statusLabel}>{r.label}</Text>
              <Text style={[styles.statusValue, { color: r.good ? colors.textPrimary : colors.warning }]}>{r.value}</Text>
            </View>
          </View>
        ))}
      </View>

      {!autoBackup ? (
        <Pressable accessibilityRole="button" onPress={() => void turnOn()} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
          <AppIcon name="calendar-check-outline" size={control.iconSize} color={colors.onPrimary} />
          <Text numberOfLines={1} adjustsFontSizeToFit style={styles.primaryText}>{bn ? 'অটো-ব্যাকআপ চালু করুন' : 'Turn on automatic backup'}</Text>
        </Pressable>
      ) : (
        <View style={styles.form}>
          <Pressable accessibilityRole="button" accessibilityState={{ busy: backingUp }} disabled={backingUp} onPress={() => void backupNow()} style={({ pressed }) => [styles.ghost, backingUp && styles.pressed, pressed && styles.pressed]}>
            {backingUp ? <ActivityIndicator size="small" color={colors.primary} /> : <AppIcon name="cloud-upload-outline" size={control.iconSize} color={colors.primary} />}
            <Text style={styles.ghostText}>{bn ? 'এখনই ব্যাকআপ নিন' : 'Back up now'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void pickFolder()} style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}>
            <AppIcon name="folder-outline" size={control.iconSize} color={colors.primary} />
            <Text style={styles.ghostText}>{bn ? 'ফোল্ডার বদলান' : 'Change folder'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { void setAutoBackup(false).then(refresh); }} style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}>
            <AppIcon name="calendar-remove-outline" size={control.iconSize} color={colors.textSecondary} />
            <Text style={[styles.ghostText, { color: colors.textSecondary }]}>{bn ? 'অটো-ব্যাকআপ বন্ধ করুন' : 'Turn off automatic backup'}</Text>
          </Pressable>
        </View>
      )}

      {editing ? (
        <View style={styles.form}>
          <Text style={styles.fieldLabel}>{bn ? 'নতুন পাসওয়ার্ড (অন্তত ৬ অক্ষর)' : 'New password (at least 6 characters)'}</Text>
          <TextInput value={pass} onChangeText={setPass} secureTextEntry autoCapitalize="none" placeholder={bn ? 'এখানে লিখুন' : 'Type it here'} placeholderTextColor={colors.textMuted} style={styles.input} accessibilityLabel={bn ? 'নতুন পাসওয়ার্ড' : 'New password'} />
          <Text style={styles.fieldLabel}>{bn ? 'আবার একই পাসওয়ার্ড' : 'The same password again'}</Text>
          <TextInput value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" placeholder={bn ? 'আবার লিখুন' : 'Type it again'} placeholderTextColor={colors.textMuted} style={styles.input} accessibilityLabel={bn ? 'আবার একই পাসওয়ার্ড' : 'The same password again'} />
          <View style={styles.warnBox}>
            <AppIcon name="alert-outline" size={control.iconSize} color={colors.warning} />
            <Text style={styles.warn}>{bn ? 'পাসওয়ার্ড ভুলে গেলে এই ব্যাকআপ আর কেউ খুলতে পারবে না — আমরাও না। কাগজে লিখে নিরাপদে রাখুন।' : 'If you forget it, nobody can open these backups — not even us. Write it on paper and keep it safe.'}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => void save()} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            <AppIcon name="lock-outline" size={control.iconSize} color={colors.onPrimary} />
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.primaryText}>{bn ? 'তালা দিন' : 'Lock it'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setEditing(false); setPass(''); setAgain(''); setNote(null); }} style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}>
            <Text style={styles.ghostText}>{bn ? 'বাতিল' : 'Cancel'}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.form}>
          <Pressable accessibilityRole="button" onPress={() => { setEditing(true); setNote(null); }} style={({ pressed }) => [locked ? styles.ghost : styles.primary, pressed && styles.pressed]}>
            <AppIcon name={locked ? 'key-change' : 'lock-outline'} size={control.iconSize} color={locked ? colors.primary : colors.onPrimary} />
            <Text numberOfLines={1} adjustsFontSizeToFit style={locked ? styles.ghostText : styles.primaryText}>{locked ? (bn ? 'পাসওয়ার্ড বদলান' : 'Change password') : (bn ? 'পাসওয়ার্ড দিয়ে তালা দিন' : 'Lock with a password')}</Text>
          </Pressable>
          {locked ? (
            <Pressable accessibilityRole="button" onPress={() => setConfirmRemove(true)} style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}>
              <AppIcon name="lock-open-variant-outline" size={control.iconSize} color={colors.danger} />
              <Text style={[styles.ghostText, { color: colors.danger }]}>{bn ? 'তালা সরান' : 'Remove the lock'}</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {note ? (
        <View style={[styles.noteBox, { borderColor: note.ok ? colors.success : colors.warning }]}>
          <AppIcon name={note.ok ? 'check-circle-outline' : 'alert-circle-outline'} size={control.iconSize} color={note.ok ? colors.success : colors.warning} />
          <Text accessibilityRole="alert" style={styles.note}>{note.text}</Text>
        </View>
      ) : null}

      <AppConfirmDialog
        visible={confirmRemove}
        title={bn ? 'তালা সরাবেন?' : 'Remove the lock?'}
        description={bn ? 'এরপরের অটো-ব্যাকআপ তালা ছাড়া থাকবে — ফাইলটা পেলে যে কেউ পড়তে পারবে। আগের তালাবদ্ধ ব্যাকআপগুলো তালাবদ্ধই থাকবে।' : 'The next automatic backups will not be locked — anyone who gets the file can read it. Earlier locked backups stay locked.'}
        confirmLabel={bn ? 'তালা সরান' : 'Remove'}
        cancelLabel={bn ? 'থাক' : 'Keep it'}
        danger
        icon="alert"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    headIcon: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    headCopy: { flex: 1, minWidth: 0 },
    title: { ...typography.cardTitle, fontWeight: '700', color: colors.textPrimary },
    subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    status: { gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
    statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    statusCopy: { flex: 1, minWidth: 0 },
    statusLabel: { ...typography.caption, color: colors.textMuted },
    statusValue: { ...typography.bodySmall, fontWeight: '700' },
    form: { gap: spacing.sm },
    fieldLabel: { ...typography.caption, fontWeight: '700', color: colors.textSecondary },
    input: { minHeight: layout.minTouchTarget, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.background, color: colors.textPrimary, ...typography.body },
    warnBox: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
    warn: { ...typography.caption, color: colors.warning, flex: 1 },
    primary: { minHeight: control.buttonHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary },
    primaryText: { ...typography.callout, fontWeight: '800', color: colors.onPrimary, flexShrink: 1, textAlign: 'center' },
    ghost: { minHeight: control.buttonHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border },
    ghostText: { ...typography.callout, fontWeight: '700', color: colors.primary, flexShrink: 1, textAlign: 'center' },
    noteBox: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', padding: spacing.sm, borderRadius: radius.md, borderWidth: border.thin },
    note: { ...typography.bodySmall, color: colors.textPrimary, flex: 1 },
    pressed: { opacity: 0.85 },
  });
}
