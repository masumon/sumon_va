// "জ্বর হলে কী করব?" — a health question, answered with general, widely accepted advice.
//
// rc.13 QA H06: these became tasks ("কী করব" reads like a plan). They are questions, and the
// people this app is for ask them. The answers are deliberately general: never a diagnosis,
// never a dose, always when to see a doctor, always the line that this is not a doctor's
// advice. Offline — no model is needed and none can change them.

export type SymptomTopic = 'fever' | 'cold' | 'stomach' | 'headache' | 'pressure' | 'diabetes' | 'sick';

// য় is written two ways in Unicode (one letter, or য + nukta); both are accepted.
const Y = '(?:য়|য়)';
const re = (source: string) => new RegExp(source, 'iu');

/** Asking what to do, eat or avoid — the shape that makes a symptom a question. */
// Also with a word or two between: "জ্বর হলে কী ওষুধ খাব?", "সুগার বেশি হলে কোন ফল খাবো?"
// (beta audit C8 — they became tasks).
const ASKS_ADVICE = re(`(?:কী|কি|কোন)(?![\\p{L}\\p{M}])\\s*(?:[\\p{L}\\p{M}]+\\s+){0,2}(?:খাবো|খাব|করবো|করব)(?![\\p{L}\\p{M}])|(?:কী|কি)\\s*(?:করব|করবো|করা\\s*উচিত|করতে\\s*হবে|খাব|খাবো|খা(?:ও${Y}া|ওয়া)\\s*(?:উচিত|যাবে)|খেতে\\s*হবে|করণী${Y})|করণী${Y}|কী\\s*খেলে|কি\\s*খেলে|what should i (?:do|eat)|what to do|what can i eat`);

const SYMPTOMS: [SymptomTopic, RegExp][] = [
  ['fever', re('জ্বর|জ্বরে|(?<![\\p{L}\\p{M}])জর(?![\\p{L}\\p{M}])|\\bfever\\b')],
  ['cold', re('সর্দি|কাশি|ঠান্ডা\\s*লেগে|ঠাণ্ডা\\s*লেগে|\\bcold\\b|\\bcough\\b|\\bflu\\b')],
  ['stomach', re(`পেট\\s*(?:খারাপ|ব্যথা|ব্যাথা)|ডা${Y}রি${Y}া|পাতলা\\s*পা${Y}খানা|বমি|\\bdiarrh|\\bvomit|stomach`)],
  ['headache', re('মাথা\\s*(?:ব্যথা|ব্যাথা|ধর)|মাথাব্যথা|\\bheadache\\b')],
  ['pressure', re('প্রেসার|রক্তচাপ|\\bblood pressure\\b|\\bbp\\b')],
  ['diabetes', re(`ডা${Y}াবেটিস|সুগার|\\bdiabet`)],
  ['sick', re('অসুখ|অসুস্থ|শরীর\\s*খারাপ|\\bsick\\b|\\bunwell\\b')],
];

/** Whether a symptom or illness is named at all — asked about or not. */
export function mentionsSymptom(text: string): boolean {
  const t = text.normalize('NFC');
  return SYMPTOMS.some(([, words]) => words.test(t));
}

/** Which health question this is, or null when it is not one. */
export function symptomTopic(text: string): SymptomTopic | null {
  const t = text.normalize('NFC');
  if (!ASKS_ADVICE.test(t)) return null;
  return SYMPTOMS.find(([, words]) => words.test(t))?.[0] ?? null;
}

const NOT_A_DOCTOR_BN = 'এগুলো সাধারণ তথ্য — ডাক্তারের পরামর্শের বিকল্প নয়।';
const NOT_A_DOCTOR_EN = 'This is general information — not a substitute for a doctor’s advice.';
const APP_BN = 'স্বাস্থ্য পাতায় ওষুধের সময়, প্রেসার-সুগার আর ডাক্তারের তারিখ লিখে রাখলে আমি মনে করিয়ে দেব।';
const APP_EN = 'Keep medicines, readings and doctor dates in Health and I will remind you.';

const ADVICE: Record<SymptomTopic, { bn: string; en: string }> = {
  fever: {
    bn: 'জ্বর হলে সাধারণত যা করা হয়:\n• বিশ্রাম নিন; পানি, স্যালাইন, ডাবের পানি, স্যুপ — তরল বেশি খান।\n• ভেজা কাপড়ে গা মুছে দিন, হালকা কাপড় পরুন।\n• জ্বরের ওষুধ খেতে হলে প্যাকেটের নিয়ম বা ডাক্তারের পরামর্শ মানুন; নিজে থেকে অ্যান্টিবায়োটিক খাবেন না।\n\nদেরি না করে ডাক্তার দেখান যদি:\n• জ্বর ৩ দিনের বেশি থাকে বা ১০৩°F-এর বেশি হয়\n• শ্বাসকষ্ট, খিঁচুনি, অজ্ঞান ভাব বা ঘাড় শক্ত হয়ে যায়\n• গায়ে লাল দাগ, রক্তপাত বা বারবার বমি হয় (ডেঙ্গুর লক্ষণ হতে পারে)\n• রোগী শিশু, বয়স্ক বা গর্ভবতী হন',
    en: 'For a fever, the usual care is:\n• Rest; drink plenty — water, oral saline, coconut water, soup.\n• Sponge with a damp cloth; wear light clothes.\n• If you take a fever medicine, follow the pack or your doctor; never start antibiotics on your own.\n\nSee a doctor without delay if:\n• it lasts over 3 days or goes above 103°F\n• there is breathlessness, a fit, fainting or a stiff neck\n• there is a rash, bleeding or repeated vomiting (possible dengue)\n• the person is a child, elderly or pregnant',
  },
  cold: {
    bn: 'সর্দি-কাশি হলে:\n• গরম পানি, আদা-মধু চা বা গরম স্যুপ খান; গরম পানির ভাপ নিন।\n• বিশ্রাম নিন, ঠান্ডা পানি ও ধুলো এড়িয়ে চলুন।\n• হাঁচি-কাশির সময় মুখ ঢাকুন, হাত ধুয়ে নিন।\n\nডাক্তার দেখান যদি: শ্বাসকষ্ট হয়, বুকে ব্যথা হয়, কাশির সাথে রক্ত আসে, বা ১ সপ্তাহে না কমে।',
    en: 'For a cold or cough:\n• Warm water, ginger-honey tea or soup; breathe in steam.\n• Rest; avoid cold drinks and dust.\n• Cover coughs and sneezes; wash your hands.\n\nSee a doctor if breathing is hard, the chest hurts, you cough blood, or it does not ease in a week.',
  },
  stomach: {
    bn: 'পেট খারাপ বা পাতলা পায়খানা হলে:\n• প্রতিবার পায়খানার পর খাবার স্যালাইন খান — এটাই সবচেয়ে জরুরি।\n• নরম খাবার খান: ভাত, জাউ, কলা, ডাল; তেল-মসলা বাদ দিন।\n• খাবার আগে ও টয়লেটের পরে সাবান দিয়ে হাত ধুয়ে নিন; ফোটানো পানি খান।\n\nডাক্তার দেখান যদি: পায়খানায় রক্ত আসে, খুব দুর্বল লাগে, প্রস্রাব কমে যায়, বারবার বমি হয়, বা শিশু-বয়স্ক কেউ হন।',
    en: 'For an upset stomach or diarrhoea:\n• Drink oral saline after every loose stool — this matters most.\n• Eat soft food: rice, porridge, banana, lentils; skip oil and spice.\n• Wash hands with soap; drink boiled water.\n\nSee a doctor if there is blood, strong weakness, little urine, repeated vomiting, or the person is a child or elderly.',
  },
  headache: {
    bn: 'মাথাব্যথা হলে:\n• অন্ধকার, শান্ত জায়গায় একটু বিশ্রাম নিন; পানি খান।\n• সময়মতো খাওয়া ও ঘুম, আর মোবাইলের পর্দা কম দেখা সাহায্য করে।\n• ব্যথার ওষুধ খেতে হলে প্যাকেটের নিয়ম বা ডাক্তারের পরামর্শ মানুন।\n\nদেরি না করে ডাক্তার দেখান যদি: হঠাৎ প্রচণ্ড ব্যথা হয়, সাথে জ্বর ও ঘাড় শক্ত হয়, চোখে ঝাপসা দেখেন, কথা জড়িয়ে যায়, বা মাথায় আঘাতের পরে ব্যথা হয়।',
    en: 'For a headache:\n• Rest somewhere dark and quiet; drink water.\n• Regular meals and sleep, and less screen time, help.\n• If you take a painkiller, follow the pack or your doctor.\n\nSee a doctor at once for a sudden severe headache, fever with a stiff neck, blurred vision, slurred speech, or pain after a head injury.',
  },
  pressure: {
    bn: 'প্রেসার বেশি থাকলে:\n• লবণ কমান — পাতে আলাদা লবণ, চিপস, আচার বাদ দিন।\n• প্রতিদিন ৩০ মিনিট হাঁটুন; ধূমপান ও জর্দা ছাড়ুন; ওজন নিয়ন্ত্রণে রাখুন।\n• প্রেসারের ওষুধ ডাক্তারের দেওয়া সময়ে খান — ভালো লাগলেও নিজে থেকে বন্ধ করবেন না।\n• নিয়মিত মেপে লিখে রাখুন।\n\nসাথে সাথে হাসপাতালে যান যদি: বুকে ব্যথা, শ্বাসকষ্ট, হঠাৎ এক পাশ অবশ, কথা জড়িয়ে যাওয়া বা প্রচণ্ড মাথাব্যথা হয়।',
    en: 'For high blood pressure:\n• Cut salt — no extra salt, chips or pickles.\n• Walk 30 minutes daily; stop smoking and tobacco; keep weight in check.\n• Take BP medicine as prescribed — never stop it yourself, even when you feel fine.\n• Measure regularly and write it down.\n\nGo to hospital at once for chest pain, breathlessness, sudden one-sided weakness, slurred speech or a severe headache.',
  },
  diabetes: {
    bn: 'ডায়াবেটিস থাকলে খাওয়া-দাওয়ায়:\n• চিনি, মিষ্টি, কোমল পানীয় আর সাদা ভাত-আটা কম খান; অল্প অল্প করে বারবার খান।\n• শাকসবজি, ডাল, মাছ, ডিম, লাল আটা বেশি খান; ফল পরিমাণমতো।\n• প্রতিদিন হাঁটুন; সুগার নিয়মিত মেপে লিখে রাখুন।\n• ওষুধ বা ইনসুলিন ডাক্তারের দেওয়া নিয়মে নিন; পায়ের যত্ন নিন।\n\nডাক্তার দেখান যদি: সুগার খুব বেশি বা খুব কম থাকে (ঘাম, কাঁপুনি, মাথা ঘোরা), বা কোনো ক্ষত সারছে না।',
    en: 'Eating with diabetes:\n• Less sugar, sweets, soft drinks and white rice or flour; small meals more often.\n• More vegetables, lentils, fish, eggs, whole wheat; fruit in moderation.\n• Walk daily; measure sugar regularly and write it down.\n• Take medicine or insulin as prescribed; look after your feet.\n\nSee a doctor if sugar runs very high or very low (sweating, shaking, dizziness), or a wound will not heal.',
  },
  sick: {
    bn: 'অসুস্থ লাগলে:\n• বিশ্রাম নিন, পানি ও তরল খাবার বেশি খান।\n• কী কী সমস্যা, কবে থেকে — লিখে রাখুন; ডাক্তারকে বলতে সুবিধা হবে।\n• নিজে থেকে অ্যান্টিবায়োটিক বা অন্যের ওষুধ খাবেন না।\n\nসাথে সাথে ডাক্তার বা হাসপাতালে যান যদি: বুকে ব্যথা, শ্বাসকষ্ট, অজ্ঞান ভাব, খিঁচুনি, রক্তপাত বা খুব দুর্বলতা হয়।',
    en: 'When you feel unwell:\n• Rest and drink plenty.\n• Note what you feel and since when — it helps the doctor.\n• Do not take antibiotics or someone else’s medicine on your own.\n\nGo to a doctor or hospital at once for chest pain, breathlessness, fainting, a fit, bleeding or severe weakness.',
  },
};

/** The advice for one health question — always with when to see a doctor and the disclaimer. */
export function symptomAnswer(topic: SymptomTopic, bn: boolean): string {
  const a = ADVICE[topic];
  return bn ? `${a.bn}\n\n${NOT_A_DOCTOR_BN}\n${APP_BN}` : `${a.en}\n\n${NOT_A_DOCTOR_EN}\n${APP_EN}`;
}
