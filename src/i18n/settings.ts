type Language = 'en' | 'bn';

export function settingsCopy(language: Language) {
  const bn = language === 'bn';
  return bn
    ? {
        back: 'আরও', eyebrow: 'পছন্দ ও নিয়ন্ত্রণ', title: 'সেটিংস', subtitle: 'তথ্য, ভাষা, থিম ও রিমাইন্ডার নিয়ন্ত্রণ করুন।',
        localTitle: 'সব তথ্য এই ফোনেই', localText: 'আপনার সব তথ্য এই ফোনেই থাকে — কোনো অ্যাকাউন্ট বা ক্লাউড লাগে না।',
        appearance: 'অ্যাপের চেহারা', darkMode: 'থিম', darkDescription: 'অ্যাপ কেমন দেখাবে বেছে নিন — “সিস্টেম” ফোনের সেটিং অনুসরণ করে।', language: 'ভাষা', bengali: 'বাংলা', english: 'English', section: 'সিস্টেম', useDevice: 'ফোনের ভাষা ব্যবহার করুন', reduceMotion: 'কম অ্যানিমেশন', appLock: 'অ্যাপ লক (পিন)', appLockDescription: 'ব্যাকগ্রাউন্ড থেকে ফিরলে ফিঙ্গারপ্রিন্ট / ফেস (বা পিন) চাওয়া হবে।', appLockPinPlaceholder: 'নতুন পিন (৪-৮ অঙ্ক)', appLockConfirmPlaceholder: 'পিনটি আবার দিন', appLockNext: 'পরবর্তী', appLockSave: 'পিন সেট করুন', appLockMismatch: 'দুটি পিন মিলছে না — আবার চেষ্টা করুন', appLockSaved: 'পিন সেট হয়েছে — অ্যাপ এখন সুরক্ষিত', appLockOff: 'বন্ধ করুন', appLockNote: 'ফোনে ফিঙ্গারপ্রিন্ট / ফেস থাকলে সেটিই প্রথমে ব্যবহৃত হবে; পিন হলো বিকল্প।', reduceMotionDescription: 'স্ক্রিন পরিবর্তনের অ্যানিমেশন কমান।', quietHours: 'নীরব সময় (রাত ১০টা – সকাল ৭টা)', quietHoursDescription: 'এই সময়ের রিমাইন্ডার পরে সরানো হয়।',
        notifications: 'নোটিফিকেশন', notificationsDescription: 'রিমাইন্ডার ও নোটিফিকেশন ঠিক করুন।', backup: 'ডেটা ও ব্যাকআপ', backupDescription: 'আপনার তথ্যের কপি রাখুন, ফাইলে নিন বা ফিরিয়ে আনুন।', trash: 'মুছে ফেলা জিনিস', trashDescription: 'মুছে ফেলা কাজ ও মেমোরি ৩০ দিন পর্যন্ত ফিরিয়ে আনা যায়।', diagnostics: 'অ্যাপ ঠিক আছে কি না', diagnosticsDescription: 'তথ্য ও নোটিফিকেশন ঠিক আছে কি না দেখুন।',
        permissions: 'অনুমতি',
        permissionsDescription: 'অ্যাপ কী কী চায়, কেন চায় — আর আপনি কোনটা দিয়েছেন।',
      }
    : {
        back: 'More', eyebrow: 'PREFERENCES', title: 'Settings', subtitle: 'Control offline data, language, appearance and reminders.',
        localTitle: 'Everything stays on this phone', localText: 'All your information stays on this phone — no account or cloud needed.',
        appearance: 'Appearance', darkMode: 'Theme', darkDescription: 'Choose how the app looks — System follows your phone’s setting.', language: 'Language', bengali: 'বাংলা', english: 'English', section: 'SYSTEM',
        useDevice: 'Use device language', reduceMotion: 'Reduce motion', appLock: 'App lock (PIN)', appLockDescription: 'Require fingerprint / face (or a PIN) when the app returns from the background.', appLockPinPlaceholder: 'New PIN (4-8 digits)', appLockConfirmPlaceholder: 'Re-enter the PIN', appLockNext: 'Next', appLockSave: 'Set PIN', appLockMismatch: 'The two PINs do not match — try again', appLockSaved: 'PIN set — the app is now protected', appLockOff: 'Turn off', appLockNote: 'Fingerprint or face is used first when the phone has it; otherwise you use the PIN.', reduceMotionDescription: 'Minimise screen-transition animation.', quietHours: 'Quiet hours (10 PM – 7 AM)', quietHoursDescription: 'Reminders in this window are pushed to the end of it.',
        notifications: 'Notifications', notificationsDescription: 'Set up reminders and notifications.', backup: 'Data & Backup', backupDescription: 'Take a backup, save it elsewhere, or bring it back.', trash: 'Deleted items', trashDescription: 'Restore deleted tasks and memories for up to 30 days.', diagnostics: 'Is the app all right', diagnosticsDescription: 'Check that your data and reminders are fine.',
        permissions: 'Permissions',
        permissionsDescription: 'What the app asks for, why, and which ones you have allowed.',
      };
}

export const settingsItems = [
  // Permissions sit beside the other system rows rather than appearing as a dialog on
  // launch: the app asks for nothing until the user opens this and says yes.
  { href: '/permissions' as const, icon: 'shield-check-outline' as const, key: 'permissions' as const, descriptionKey: 'permissionsDescription' as const },
  { href: '/trash' as const, icon: 'trash-can-outline' as const, key: 'trash' as const, descriptionKey: 'trashDescription' as const },
] as const;
