import { asciiDigitsToBengali } from '../services/debt/money';

/** Bengali numerals inside Bengali text. Android mis-measures a line that mixes ASCII
 *  digits with Bengali and truncates it, so every number in a Bengali sentence is
 *  converted. English strings keep ASCII digits, which is what English readers expect. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

type Language = 'en' | 'bn';
export function backupCopy(language: Language) {
  const bn = language === 'bn';
  const restoredAttachments = (count: number) => bn ? `ব্যাকআপ রিস্টোর হয়েছে এবং ${bnNum(count)}টি সংযুক্ত ফাইল ফিরিয়ে আনা হয়েছে।` : `Backup restored with ${count} attachment${count === 1 ? '' : 's'}.`;
  const localDescription = bn ? 'তথ্য ফোনেই থাকে; রপ্তানি ফাইল আপনি নিজে শেয়ার করলে তবেই ফোনের বাইরে যাবে।' : 'Everything stays on this phone. A backup file leaves it only when you share it yourself.';
  const restoreConfirm = bn ? 'ফেরত আনুন' : 'Restore';
  const operationError = bn ? 'ব্যাকআপ তৈরি করা গেল না।' : 'The backup could not be created';
  const restoreError = bn ? 'রিস্টোর করা গেল না।' : 'The restore could not be completed';
  return {
    back: bn ? 'ফিরুন' : 'Back',
    eyebrow: bn ? 'তথ্যের নিরাপত্তা' : 'DATA SAFETY',
    title: bn ? 'ব্যাকআপ ও রিস্টোর' : 'Backup & Restore',
    subtitle: bn ? 'আপনার সব তথ্য আর ছবি-ফাইলের একটি কপি রাখুন। ফোন হারালে বা বদলালে এই কপি থেকে সব ফেরত আনা যায়।' : 'The backup holds everything you saved, with its photos and files. It stays on this phone unless you share it.',
    create: bn ? 'এখনই ব্যাকআপ নিন' : 'Create complete backup',
    createText: bn ? 'সব কিছু একটি ফাইলে — কাজ, ছোট ধাপ, মেমোরি, দেনা-পাওনা, আয়-ব্যয়, মানুষ, স্বাস্থ্যের মাপ, রিমাইন্ডারের অবস্থা, আর সংযুক্ত ছবি, ভিডিও ও ফাইল।' : 'Everything, in one ZIP: tasks, subtasks, memories, debts and receivables, income and expenses, people, health measurements, reminder state, and every attached photo, video and file.',
    createButton: bn ? 'ব্যাকআপ নিন ও রাখার জায়গা বাছুন' : 'Create & Share Backup',
    restore: bn ? 'ব্যাকআপ থেকে ফেরত আনুন' : 'Restore backup',
    restoreText: bn ? 'আগে নেওয়া যেকোনো ব্যাকআপ ফাইল বেছে নিন — তালাবদ্ধ হলে পাসওয়ার্ড চাইবে। ফেরত আনার আগে অ্যাপ ফাইলটা যাচাই করে নেয়।' : 'Old and new backup files both work.',
    choose: bn ? 'ব্যাকআপ ফাইল বেছে নিন' : 'Choose Backup File',
    storage: bn ? 'এই ফোনে আপনার তথ্য' : 'Your data on this phone',
    files: bn ? 'ফাইল' : 'Files',
    used: bn ? 'ছবি-ফাইলের জায়গা' : 'Space used by photos and files',
    available: bn ? 'ফোনে খালি জায়গা' : 'Free space on the phone',
    lastSize: bn ? 'শেষ ব্যাকআপের আকার' : 'Last backup size',
    success: (count: number, bytes: string) => bn ? `ব্যাকআপ সফল। ${bnNum(count)}টি সংযুক্ত ফাইলসহ ${bytes} আর্কাইভ শেয়ার করা হয়েছে।` : `Backup created with ${count} attachment${count === 1 ? '' : 's'} (${bytes}).`,
    restoredAttachments,
    restoredWithAttachments: restoredAttachments,
    restored: bn ? 'ব্যাকআপ সফলভাবে রিস্টোর হয়েছে।' : 'Backup restored successfully.',
    restoredRetry: bn ? 'ব্যাকআপ রিস্টোর হয়েছে। রিমাইন্ডার আবার সাজান পরে আবার চেষ্টা করবে।' : 'Backup restored. Reminder refresh will retry automatically.',
    operationError,
    restoreError,
    error: operationError,
    localTitle: bn ? 'তথ্য শুধু আপনার ফোনে' : 'Local and user-controlled',
    localDescription,
    localText: localDescription,
    restoreTitle: bn ? 'ব্যাকআপ থেকে ফেরত আনবেন?' : 'Restore backup?',
    restoreDescription: bn ? 'এখন ফোনে যা আছে তার জায়গায় বেছে নেওয়া ব্যাকআপের তথ্য বসবে। এই ফোনের নিজের সেটিং (অ্যাপ লক, AI মডেল, পাসওয়ার্ড) যেমন আছে তেমনই থাকবে।' : 'Current local data will be replaced by the selected backup.',
    restoreConfirm,
    confirm: restoreConfirm,
    cancel: bn ? 'বাতিল' : 'Cancel',
    encryptLabel: bn ? 'পাসওয়ার্ড দিয়ে তালা দিন (চাইলে)' : 'Protect with a password (optional)',
    encryptPlaceholder: bn ? 'পাসওয়ার্ড — ভুলে গেলে আর খোলা যাবে না' : 'Password — remember it, it cannot be recovered',
    encryptNote: bn
      ? 'পাসওয়ার্ড দিলে ব্যাকআপ ফাইল তালাবদ্ধ হবে — পাসওয়ার্ড ছাড়া কেউ খুলতে পারবে না। পাসওয়ার্ডটি কোথাও সংরক্ষণ করা হয় না — ভুলে গেলে এই ব্যাকআপ আর কখনও খোলা যাবে না।'
      : 'With a password the backup file is locked with strong encryption. The password is stored nowhere — if you forget it, this backup can never be opened again.',
    encryptedRestoreTitle: bn ? 'তালাবদ্ধ ব্যাকআপ' : 'Encrypted backup',
    encryptedRestorePrompt: bn ? 'এই ব্যাকআপ খুলতে সেই পাসওয়ার্ডটা লিখুন।' : 'Enter the password to open this backup.',
    wrongPassphrase: bn ? 'পাসওয়ার্ড মেলেনি, অথবা ফাইলটা নষ্ট। আবার দেখে লিখুন।' : 'Wrong password, or the file is damaged. Check it and try again.',
    unlock: bn ? 'খুলুন ও ফেরত আনুন' : 'Unlock',
  };
}
