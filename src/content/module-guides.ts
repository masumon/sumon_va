// "কীভাবে ব্যবহার করবেন?" — one short guide per part of the app (the user's request for 1.0).
//
// Written for someone who has never used an app like this: what the part is for, the few
// steps that matter with a real example, and what to say to আপন instead. Shown once on the
// first visit (ModuleGuide) and any time after from the button under the title.
// Keep each step one action; name buttons exactly as they appear on screen.

type Line = { bn: string; en: string };

export type ModuleGuideId = 'home' | 'planning' | 'memory' | 'finance' | 'debt' | 'health' | 'assistant';

export type ModuleGuideContent = {
  icon: string;
  title: Line;
  what: Line;
  steps: Line[];
  /** Said to আপন — tapping one opens আপন with it written in. */
  ask: Line[];
  tip?: Line;
};

export const MODULE_GUIDES: Record<ModuleGuideId, ModuleGuideContent> = {
  home: {
    icon: 'home-variant-outline',
    title: { bn: 'হোম — আজকের সব এক নজরে', en: 'Home — today at a glance' },
    what: { bn: 'আজকের কাজ, টাকা, ওষুধ আর দেনা-পাওনার খবর এক জায়গায়। উপরের ঘরে এক লাইনে লিখেই কাজ, খরচ বা মেমোরি রাখা যায়।', en: 'Today’s tasks, money, medicines and debts in one place. Write one line in the top box to keep a task, an expense or a memory.' },
    steps: [
      { bn: 'উপরের ঘরে সাধারণ কথায় লিখুন, যেমন: "কাল সকাল ১০টায় ব্যাংকে যাব" — তারপর নিচের বোতাম চাপুন।', en: 'Write in the top box in plain words, e.g. "bank tomorrow at 10am" — then tap the button below it.' },
      { bn: '🎤 চেপে মুখে বলুন; 📷 চেপে কাগজের ছবি থেকে লেখা তুলুন — কোন লাইন রাখবেন বেছে নিন।', en: 'Tap 🎤 to speak; tap 📷 to read text from a paper — pick the lines to keep.' },
      { bn: 'লেখা দেখে অ্যাপ কী বুঝল তা দেখায় — ঠিক থাকলে রাখুন, না হলে "এডিট"।', en: 'The app shows what it understood — keep it if right, or tap "Edit".' },
      { bn: 'নিচের কার্ডে আজকের কাজ; কাজে চাপ দিলে খোলে, টিক দিলে শেষ।', en: 'Today’s tasks are below; tap one to open it, tick it when done.' },
    ],
    ask: [
      { bn: 'আজ কী কী করতে হবে?', en: 'What do I have today?' },
      { bn: 'হাতে কত টাকা আছে?', en: 'How much money do I have?' },
    ],
    tip: { bn: 'নিচের ভাসমান "আপন" বোতাম চাপলে যেকোনো পাতা থেকে প্রশ্ন করা যায়; চেপে ধরে টেনে সরানো যায়।', en: 'The floating আপন button works from any page; press and hold to move it.' },
  },
  planning: {
    icon: 'calendar-blank-outline',
    title: { bn: 'পরিকল্পনা — কাজ ও রিমাইন্ডার', en: 'Planning — tasks and reminders' },
    what: { bn: 'কী কবে করতে হবে লিখে রাখুন; সময় দিলে ঠিক সময়ে ফোন মনে করিয়ে দেবে।', en: 'Write down what to do and when; give a time and the phone reminds you.' },
    steps: [
      { bn: '"নতুন কাজ" চাপুন → কাজের নাম লিখুন (যেমন "বিদ্যুৎ বিল দেওয়া") → তারিখ ও সময় দিন → রাখুন।', en: 'Tap "New task" → name it (e.g. "pay electricity bill") → set date and time → save.' },
      { bn: 'প্রতিদিন বা প্রতি সপ্তাহে করতে হলে সময় দিয়ে "পুনরাবৃত্তি" থেকে বেছে নিন।', en: 'For something daily or weekly, give a time and choose it under "Repeat".' },
      { bn: 'কাজ শেষ হলে টিক দিন; অন্য দিনে সরাতে কাজ খুলে তারিখ বদলান।', en: 'Tick a task when done; to move it, open it and change the date.' },
      { bn: 'উপরের 📅 বোতামে পুরো মাস দেখুন; "সময় পেরিয়ে গেছে" অংশে বাকি কাজ।', en: 'The 📅 button shows the month; "Overdue" lists what was missed.' },
    ],
    ask: [
      { bn: 'কালকে কি কাজ আছে?', en: 'What do I have tomorrow?' },
      { bn: 'প্রতিদিন রাত ১০টায় প্রেসারের ওষুধ খাব', en: 'Blood pressure pill every day at 10pm' },
    ],
    tip: { bn: 'রিমাইন্ডার না এলে: আরও → রিমাইন্ডার — আপনার ফোনের জন্য ধাপগুলো সেখানে আছে।', en: 'No reminders? More → Reminders has the steps for your phone.' },
  },
  memory: {
    icon: 'bookmark-multiple-outline',
    title: { bn: 'মেমোরি — দরকারি তথ্যের খাতা', en: 'Memory — your notebook' },
    what: { bn: 'পাসওয়ার্ড, NID, মিটার নম্বর, কারো ঠিকানা — যা মনে রাখা কঠিন, এখানে লিখে রাখুন।', en: 'Passwords, ID numbers, meter numbers, addresses — anything hard to remember.' },
    steps: [
      { bn: 'উপরের "যোগ" চাপুন → লিখুন (যেমন "বাসার ওয়াইফাই পাসওয়ার্ড apon1234") → চাইলে ট্যাগ দিন (যেমন "বাসা") → রাখুন।', en: 'Tap "+ Add" → write it (e.g. "home wifi password apon1234") → add a tag like "home" → save.' },
      { bn: 'কাগজ বা কার্ডের ছবিও যোগ করা যায় — "যোগ করুন" → ক্যামেরা বা গ্যালারি।', en: 'Add a photo of a paper or card — "Add" → camera or gallery.' },
      { bn: 'উপরের "সব · নোট · তথ্য · পছন্দ" আর ট্যাগে চাপ দিয়ে খুঁজুন।', en: 'Filter with "All · Notes · Info · Preferences" and the tags.' },
      { bn: 'দরকার না থাকলে "আর্কাইভ"; ভুলে মুছলে আরও → মুছে ফেলা জিনিস থেকে ফেরত আনুন।', en: 'Archive what you no longer need; bring back a deletion from More → Deleted items.' },
    ],
    ask: [
      { bn: 'ওয়াইফাই পাসওয়ার্ড কী?', en: 'What is the wifi password?' },
      { bn: 'মনে রাখো গাড়ির নম্বর ঢাকা মেট্রো গ ১২৩৪', en: 'Remember the car number is Dhaka Metro Ga 1234' },
    ],
  },
  finance: {
    icon: 'swap-vertical',
    title: { bn: 'আয়-ব্যয় — টাকার হিসাব', en: 'Money — where it came from and went' },
    what: { bn: 'কী এল, কী গেল, কোন মানিব্যাগে কত আছে — মাস শেষে এক নজরে।', en: 'What came in, what went out and what each wallet holds — at a glance.' },
    steps: [
      { bn: 'প্রথমে একটা মানিব্যাগ বানান: "মানিব্যাগ" → নতুন → যেমন "নগদ টাকা", "বিকাশ"।', en: 'First make a wallet: "Wallets" → New → e.g. "Cash", "bKash".' },
      { bn: '"ব্যয় যোগ" → টাকা (যেমন ৫০০) → খাত ("বাজার") → কোন মানিব্যাগ * → টাকার উৎস * (আয়, ঋণ, উপহার, সঞ্চয় বা অন্যান্য) → সংরক্ষণ।', en: '"Add expense" → amount (e.g. 500) → category ("groceries") → wallet * → source * (income, loan, gift, savings or other) → save.' },
      { bn: 'বেতন বা যেকোনো আয় "আয় যোগ" দিয়ে লিখুন; এক মানিব্যাগ থেকে আরেকটায় নিতে "মানিব্যাগ" পাতায় "টাকা সরান"।', en: 'Record pay with "Add income"; move money between wallets with "Move money" on the Wallets page.' },
      { bn: 'পুরোনো লেনদেনে মানিব্যাগ বা উৎস না থাকলে "হিসাব ঠিক করুন" থেকে একে একে বসিয়ে দিন।', en: 'Old entries missing a wallet or source: fix them one by one under "Fix records".' },
    ],
    ask: [
      { bn: 'এই মাসে কত খরচ হয়েছে?', en: 'How much did I spend this month?' },
      { bn: 'বাজারে ৫০০ টাকা খরচ', en: 'Spent 500 on groceries' },
      { bn: 'খরচ কমাবো কিভাবে?', en: 'How can I spend less?' },
    ],
    tip: { bn: '* চিহ্নের ঘরগুলো দিতেই হবে — এতে প্রতিটি টাকার হিসাব মেলে।', en: 'Fields marked * are required — that is what keeps every taka traceable.' },
  },
  debt: {
    icon: 'handshake-outline',
    title: { bn: 'দেনা-পাওনা — কার কাছে কত', en: 'Debts — who owes what' },
    what: { bn: 'আপনি কার কাছে কত দেবেন আর কে আপনাকে কত দেবে — মানুষ ধরে, কিস্তি ও তারিখসহ।', en: 'What you owe and what you are owed — by person, with instalments and dates.' },
    steps: [
      { bn: 'ধার নিলে "নতুন দেনা", ধার দিলে "নতুন পাওনা" → মানুষের নাম → টাকা → মানিব্যাগ → সংরক্ষণ।', en: 'Borrowed: "New debt"; lent: "New receivable" → person → amount → wallet → save.' },
      { bn: 'ফেরতের তারিখ দিলে সময়মতো মনে করিয়ে দেবে; কিস্তিতে হলে কিস্তির সংখ্যা দিন।', en: 'Give a due date to be reminded; for instalments, give their number.' },
      { bn: 'শোধ করলে হিসাব খুলে "পরিশোধ" → টাকা → কোন টাকা দিয়ে শোধ (বেতন, সঞ্চয়, ধার…) → মানিব্যাগ।', en: 'To repay, open the account → "Pay" → amount → whose money paid (salary, savings, a loan…) → wallet.' },
      { bn: 'ভুল হলে লেনদেন খুলে "সংশোধন"; মাধ্যম "অন্যান্য" হলে নিজে লিখে দিন।', en: 'Mistake? Open the entry → "Correct"; for "Other" method, type your own.' },
    ],
    ask: [
      { bn: 'কার কাছে কত পাব?', en: 'Who owes me what?' },
      { bn: 'করিমকে ২০০০ টাকা ধার দিলাম', en: 'I lent Karim 2000' },
    ],
    tip: { bn: 'উপরের "⚙ সেটিংস" থেকে দেনা-পাওনার নিয়ম (যেমন রিমাইন্ডার) বদলানো যায়।', en: '"⚙ Settings" at the top changes debt options such as reminders.' },
  },
  health: {
    icon: 'pill',
    title: { bn: 'স্বাস্থ্য — ওষুধ, ডাক্তার, মাপ', en: 'Health — medicines, doctors, readings' },
    what: { bn: 'পরিবারের সবার ওষুধের সময়, ডাক্তার দেখানো, টেস্ট রিপোর্ট আর প্রেসার-সুগার এক জায়গায়।', en: 'The family’s medicine times, doctor visits, test reports and BP or sugar in one place.' },
    steps: [
      { bn: '"ওষুধ" চাপুন → নতুন ওষুধ → নাম (যেমন "Napa 500") → দিনে কখন খাবেন (সকাল ৮টা, রাত ১০টা) → রাখুন; সময় হলে মনে করিয়ে দেবে।', en: '"Medicines" → New → name (e.g. "Napa 500") → times (8am, 10pm) → save; you will be reminded.' },
      { bn: 'ওষুধ খেলে রিমাইন্ডারে বা আজকের তালিকায় "খেয়েছি" চাপুন।', en: 'Tap "Taken" on the reminder or in today’s list.' },
      { bn: '"ডাক্তার" ও "পরীক্ষা"-য় তারিখ, ফি আর রিপোর্টের ছবি/PDF রাখুন; ফি দিলে মানিব্যাগ ও উৎস চায়।', en: 'Keep dates, fees and report photos or PDFs under "Doctor" and "Tests"; a fee asks for wallet and source.' },
      { bn: 'প্রেসার ও সুগার মেপে লিখে রাখুন — ডাক্তারকে দেখাতে সুবিধা হবে।', en: 'Write down BP and sugar readings — easy to show your doctor.' },
    ],
    ask: [
      { bn: 'পরের ওষুধ কখন?', en: 'When is my next dose?' },
      { bn: 'জ্বর হলে কী করব?', en: 'What should I do for a fever?' },
    ],
    tip: { bn: 'আপনের স্বাস্থ্য-পরামর্শ সাধারণ তথ্য — ডাক্তারের পরামর্শের বিকল্প নয়।', en: 'আপন’s health advice is general — not a substitute for a doctor.' },
  },
  assistant: {
    icon: 'account-voice',
    title: { bn: 'আপন — আপনার সহকারী', en: 'আপন — your assistant' },
    what: { bn: 'সাধারণ কথায় লিখুন বা বলুন — আপন বুঝে কাজ করে দেয় বা উত্তর দেয়। সব এই ফোনেই।', en: 'Type or say it in plain words — আপন does it or answers. All on this phone.' },
    steps: [
      { bn: 'নিচের ঘরে লিখুন বা 🎤 চেপে বলুন, তারপর ➤ চাপুন।', en: 'Type below or tap 🎤 to speak, then tap ➤.' },
      { bn: 'কিছু রাখার আগে আপন দেখায় কী বুঝেছে — ঠিক থাকলে "নিশ্চিত করে চালান"।', en: 'Before saving anything, আপন shows what it understood — tap "Confirm and run" if right.' },
      { bn: 'টাকার কাজে মানিব্যাগ ও উৎস বেছে "রাখুন" চাপুন।', en: 'For money, pick the wallet and source, then "Keep".' },
      { bn: 'না পেলে আপন সোজা বলে "পাওয়া যায়নি" — কিছু বানিয়ে বলে না; বানান ভুল মনে হলে আগে জিজ্ঞেস করে ("আপনি কি সকাল বোঝাতে চেয়েছেন?")।', en: 'If something is not there, আপন says so — it never makes things up; a word that looks mistyped is asked about first.' },
    ],
    ask: [
      { bn: 'তুমি কী কী পারো?', en: 'What can you do?' },
      { bn: 'অ্যাপটা কীভাবে চালাব?', en: 'How do I use the app?' },
      { bn: 'এই সপ্তাহের কাজ দেখাও', en: 'Show this week’s tasks' },
    ],
  },
};
