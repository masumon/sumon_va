// A small, hand-built bilingual equivalence lexicon for query-side expansion.
//
// It is intentionally tiny and high-precision: it only maps words that a Bangladeshi
// user is very likely to mix between Bangla and English, or use interchangeably, when
// asking about their own saved notes. No model, no thesaurus download.

const GROUPS: string[][] = [
  ['পাসপোর্ট', 'passport'],
  ['ভিসা', 'visa'],
  ['মেয়াদ', 'expiry', 'expiration', 'expire', 'validity', 'valid', 'deadline'],
  ['জন্মদিন', 'birthday', 'জন্ম', 'dob'],
  ['ঠিকানা', 'address'],
  ['পাসওয়ার্ড', 'password', 'pass', 'পিন', 'pin', 'passcode'],
  ['ফোন', 'phone', 'mobile', 'নম্বর', 'number', 'contact', 'মোবাইল'],
  ['ইমেইল', 'email', 'mail', 'e-mail'],
  ['অ্যাকাউন্ট', 'account', 'হিসাব', 'a/c'],
  ['ব্যাংক', 'bank'],
  ['টাকা', 'money', 'amount', 'পরিমাণ', 'balance', 'ব্যালেন্স'],
  ['ভাড়া', 'rent'],
  ['বিল', 'bill', 'invoice'],
  ['ওষুধ', 'medicine', 'medication', 'drug', 'pill'],
  ['ডাক্তার', 'doctor', 'physician'],
  ['অ্যাপয়েন্টমেন্ট', 'appointment'],
  ['গাড়ি', 'car', 'vehicle', 'bike', 'মোটরসাইকেল'],
  ['লাইসেন্স', 'license', 'licence'],
  ['অফিস', 'office', 'work', 'কাজ'],
  ['মিটিং', 'meeting'],
  ['স্কুল', 'school', 'কলেজ', 'college', 'university', 'বিশ্ববিদ্যালয়'],
  ['পরীক্ষা', 'exam', 'test'],
  ['ফ্লাইট', 'flight', 'plane', 'বিমান'],
  ['হোটেল', 'hotel', 'বুকিং', 'booking', 'reservation'],
  ['ওয়াইফাই', 'wifi', 'wi-fi', 'wireless', 'ওয়াই-ফাই'],
  ['জন্ম নিবন্ধন', 'birth certificate', 'nid', 'এনআইডি', 'জাতীয় পরিচয়পত্র'],
];

const INDEX = new Map<string, Set<string>>();
for (const group of GROUPS) {
  for (const word of group) {
    const key = word.toLowerCase();
    const set = INDEX.get(key) ?? new Set<string>();
    for (const other of group) if (other.toLowerCase() !== key) set.add(other.toLowerCase());
    INDEX.set(key, set);
  }
}

/** Equivalents of `token` (both directions), excluding the token itself. */
export function synonymsOf(token: string): string[] {
  return [...(INDEX.get(token.toLowerCase()) ?? [])];
}

/** All equivalents for a bag of tokens, de-duplicated and minus the originals. */
export function expandSynonyms(tokens: string[]): string[] {
  const have = new Set(tokens.map((t) => t.toLowerCase()));
  const out = new Set<string>();
  for (const token of tokens) {
    for (const syn of synonymsOf(token)) if (!have.has(syn)) out.add(syn);
  }
  return [...out];
}
