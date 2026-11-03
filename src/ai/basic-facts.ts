// A few facts every family asks and a small phone model gets wrong (RC.4 QA T38: "বাংলাদেশের
// রাজধানী কী?" came back as "…শহর বারান্দা"). These are answered from this list — before any
// model, and with or without the AI switched on — so the commonest questions are simply right.
//
// Only facts that do not change: capitals, national symbols, national days, currencies.
// Nothing about who holds an office today; that goes stale and is not ours to state.

interface Fact { test: (q: string) => boolean; bn: string; en: string }

const has = (q: string, ...words: RegExp[]) => words.every((w) => w.test(q));
const BD = /বাংলাদেশ|bangladesh/iu;

const CAPITALS: [RegExp, string, string][] = [
  [/বাংলাদেশ|bangladesh/iu, 'ঢাকা', 'Dhaka'],
  [/ভারত|india/iu, 'নয়াদিল্লি', 'New Delhi'],
  [/পাকিস্তান|pakistan/iu, 'ইসলামাবাদ', 'Islamabad'],
  [/নেপাল|nepal/iu, 'কাঠমান্ডু', 'Kathmandu'],
  [/ভুটান|bhutan/iu, 'থিম্পু', 'Thimphu'],
  [/শ্রীলঙ্কা|sri\s*lanka/iu, 'শ্রী জয়াবর্ধনেপুরা কোট্টে (বাণিজ্যিক রাজধানী কলম্বো)', 'Sri Jayawardenepura Kotte (commercial capital Colombo)'],
  [/মিয়ানমার|মায়ানমার|myanmar/iu, 'নেপিডো', 'Naypyidaw'],
  [/চীন|china/iu, 'বেইজিং', 'Beijing'],
  [/জাপান|japan/iu, 'টোকিও', 'Tokyo'],
  [/সৌদি|saudi/iu, 'রিয়াদ', 'Riyadh'],
  [/আমেরিকা|যুক্তরাষ্ট্র|usa|united states|america/iu, 'ওয়াশিংটন ডি.সি.', 'Washington, D.C.'],
  [/যুক্তরাজ্য|ইংল্যান্ড|ব্রিটেন|uk\b|united kingdom|england|britain/iu, 'লন্ডন', 'London'],
  [/মালয়েশিয়া|malaysia/iu, 'কুয়ালালামপুর', 'Kuala Lumpur'],
  [/সংযুক্ত আরব আমিরাত|আমিরাত|uae|emirates/iu, 'আবুধাবি', 'Abu Dhabi'],
];

const FACTS: Fact[] = [
  ...CAPITALS.map(([country, bn, en]): Fact => ({
    test: (q) => has(q, /রাজধানী|capital/iu, country),
    bn: `রাজধানী ${bn}।`, en: `The capital is ${en}.`,
  })),
  { test: (q) => has(q, BD, /মুদ্রা|টাকার নাম|currency/iu), bn: 'বাংলাদেশের মুদ্রা টাকা (৳)।', en: 'The currency of Bangladesh is the taka (৳).' },
  { test: (q) => has(q, BD, /রাষ্ট্রভাষা|জাতীয় ভাষা|national language|official language/iu), bn: 'বাংলাদেশের রাষ্ট্রভাষা বাংলা।', en: 'The state language of Bangladesh is Bangla.' },
  { test: (q) => has(q, /স্বাধীনতা\s*দিবস|independence day/iu), bn: 'বাংলাদেশের স্বাধীনতা দিবস ২৬ মার্চ (১৯৭১)।', en: 'Bangladesh’s Independence Day is 26 March (1971).' },
  { test: (q) => has(q, /বিজয়\s*দিবস|victory day/iu), bn: 'বিজয় দিবস ১৬ ডিসেম্বর (১৯৭১)।', en: 'Victory Day is 16 December (1971).' },
  { test: (q) => has(q, /শহীদ\s*দিবস|ভাষা\s*দিবস|মাতৃভাষা\s*দিবস|mother language day|language martyrs/iu), bn: 'শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস ২১ ফেব্রুয়ারি।', en: 'Language Martyrs’ Day and International Mother Language Day is 21 February.' },
  { test: (q) => has(q, /জাতীয়\s*সংগীত|national anthem/iu), bn: 'বাংলাদেশের জাতীয় সংগীত "আমার সোনার বাংলা" — রচয়িতা রবীন্দ্রনাথ ঠাকুর।', en: 'The national anthem is "Amar Shonar Bangla", written by Rabindranath Tagore.' },
  { test: (q) => has(q, /জাতীয়\s*কবি|national poet/iu), bn: 'বাংলাদেশের জাতীয় কবি কাজী নজরুল ইসলাম।', en: 'The national poet of Bangladesh is Kazi Nazrul Islam.' },
  { test: (q) => has(q, /জাতীয়\s*ফুল|national flower/iu), bn: 'বাংলাদেশের জাতীয় ফুল শাপলা।', en: 'The national flower is the water lily (shapla).' },
  { test: (q) => has(q, /জাতীয়\s*ফল|national fruit/iu), bn: 'বাংলাদেশের জাতীয় ফল কাঁঠাল।', en: 'The national fruit is the jackfruit.' },
  { test: (q) => has(q, /জাতীয়\s*পাখি|national bird/iu), bn: 'বাংলাদেশের জাতীয় পাখি দোয়েল।', en: 'The national bird is the magpie robin (doyel).' },
  { test: (q) => has(q, /জাতীয়\s*পশু|জাতীয়\s*প্রাণী|national animal/iu), bn: 'বাংলাদেশের জাতীয় পশু রয়েল বেঙ্গল টাইগার।', en: 'The national animal is the Royal Bengal tiger.' },
  { test: (q) => has(q, /জাতীয়\s*মাছ|national fish/iu), bn: 'বাংলাদেশের জাতীয় মাছ ইলিশ।', en: 'The national fish is the hilsa (ilish).' },
  { test: (q) => has(q, /জাতীয়\s*গাছ|জাতীয়\s*বৃক্ষ|national tree/iu), bn: 'বাংলাদেশের জাতীয় গাছ আমগাছ।', en: 'The national tree is the mango tree.' },
  { test: (q) => has(q, /জাতীয়\s*খেলা|national game|national sport/iu), bn: 'বাংলাদেশের জাতীয় খেলা কাবাডি (হা-ডু-ডু)।', en: 'The national game is kabaddi (ha-du-du).' },
  { test: (q) => has(q, /দীর্ঘতম|সবচেয়ে\s*বড়|longest/iu, /সমুদ্র\s*সৈকত|beach/iu), bn: 'বিশ্বের দীর্ঘতম প্রাকৃতিক সমুদ্র সৈকত কক্সবাজার।', en: 'Cox’s Bazar is the world’s longest natural sea beach.' },
  { test: (q) => has(q, /সবচেয়ে\s*বড়|বৃহত্তম|largest|biggest/iu, /গ্রহ|planet/iu), bn: 'সৌরজগতের সবচেয়ে বড় গ্রহ বৃহস্পতি।', en: 'Jupiter is the largest planet in the solar system.' },
  { test: (q) => has(q, /বছরে|এক\s*বছর|a year|in a year/iu, /কত\s*দিন|how many days/iu), bn: 'বছরে ৩৬৫ দিন, অধিবর্ষে ৩৬৬ দিন।', en: 'A year has 365 days; a leap year has 366.' },
];

/** A certain answer for one of the common questions above, or null. */
export function basicFactAnswer(question: string, bn: boolean): string | null {
  const q = question.normalize('NFC');
  const hit = FACTS.find((f) => f.test(q));
  return hit ? (bn ? hit.bn : hit.en) : null;
}
