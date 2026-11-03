import type { AppLanguage } from './date-time';

export const searchCopy={
  bn:{back:'হোম',eyebrow:'খোঁজা',title:'সবকিছু খুঁজুন',subtitle:'কাজ, মেমোরি, দেনা-পাওনা, আয়-ব্যয় — এই ফোনে যা আছে সব একসাথে খুঁজুন।',placeholder:'নাম, টাকার অঙ্ক, বা যেকোনো কথা',task:'কাজ',tasks:'কাজ',memories:'মেমোরি',all:'সব',importance:'গুরুত্ব',empty:'কিছু মিলল না। অন্য শব্দে বা টাকার অঙ্ক দিয়ে খুঁজে দেখুন।',startHint:'উপরে কিছু লিখুন — নাম, টাকার অঙ্ক, বা মনে থাকা যেকোনো শব্দ।',emptyHint:'বানান বদলে দেখুন, বা কম শব্দ দিয়ে।',clear:'সার্চ মুছুন',retry:'আবার চেষ্টা করুন',searching:'খোঁজা হচ্ছে…',failedTitle:'সার্চ করা যায়নি',failedDescription:'খুঁজতে সমস্যা হয়েছে। আবার চেষ্টা করুন।',openTask:'কাজ খুলুন',openMemory:'মেমোরি খুলুন'},
  en:{back:'Home',eyebrow:'SEARCH',title:'Find anything',subtitle:'Tasks, memories, debts, money — everything on this phone, in one search.',placeholder:'A name, an amount, or any word',task:'Task',tasks:'Tasks',memories:'Memories',all:'All',importance:'Importance',empty:'No matching local data.',startHint:'Type above — a name, an amount, or any word you remember.',emptyHint:'Try a different spelling, or fewer words.',clear:'Clear search',retry:'Retry',searching:'Searching…',failedTitle:'Search failed',failedDescription:'The local search could not be completed. Please try again.',openTask:'Open task',openMemory:'Open memory'}
} as const;

export function search(language:AppLanguage){return searchCopy[language];}
