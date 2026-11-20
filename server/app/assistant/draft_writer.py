"""Reading what the other person is really asking, and a safe draft that always exists.

Used by `wa_ai.suggest_reply` (the "সহকারী লিখে দিক" button in every chat):
  * `read_pattern()` looks at the person's last message(s) and names the kind of message (a "when?" question, a price question,
    a request, money, a complaint, a greeting, a family check-in, ...) and gives the AI one plain hint how to answer it;
  * `rule_draft()` writes a short, polite draft from rules alone: it is the answer when no AI is connected or every AI fails,
    so the button never comes back empty. It never invents a price, a date, an amount or a promise.
  * `TONES` are the owner's "write it another way" choices.
Pure functions, no database, no network.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.assistant import wa_brain as brain

TONES = ("auto", "short", "warm", "formal")
TONE_HINT = {
    "auto": "",
    "short": "খুব ছোট করে লেখো: এক বাক্য।",
    "warm": "আন্তরিক, উষ্ণ ও আপন সুরে লেখো।",
    "formal": "ভদ্র ও আনুষ্ঠানিক সুরে লেখো (আপনি সম্বোধন)।",
}


@dataclass(frozen=True)
class Pattern:
    kind: str
    label: str  # plain Bangla for the owner ("সে জানতে চাইছে কবে")
    hint: str   # one instruction for the AI


def _has(text: str, rx: str) -> bool:
    return re.search(rx, brain._spell(text.lower()), re.I) is not None  # noqa: SLF001 — same spelling rules as the brain


# Order matters: the first fitting kind wins (urgent beats everything, a family check-in beats a plain question).
_RULES: tuple[tuple[str, str, str, str], ...] = (
    ("urgent", r"জরুরি|জরুর|এখনই|ইমার্জেন্সি|urgent|emergency|asap|joruri",
     "জরুরি কিছু বলছে", "জানাও যে বার্তাটা দেখেছ এবং যত দ্রুত সম্ভব ব্যবস্থা নেবে/ফোন করবে; কোনো সময় বানাবে না।"),
    ("condolence", r"ইন্নালিল্লাহ|মারা গেছে|মারা গেছেন|ইন্তেকাল|মৃত্যু|passed away|died",
     "দুঃখের খবর দিচ্ছে", "সংক্ষেপে সমবেদনা জানাও, দোয়া করো; অন্য কোনো কথা নয়।"),
    ("sick", r"অসুস্থ|জ্বর|হাসপাতাল|ডাক্তার|ব্যথা|sick|fever|hospital",
     "অসুস্থতার কথা বলছে", "খোঁজ নাও, দ্রুত সুস্থতা কামনা করো, দরকার হলে পাশে থাকার কথা বলো।"),
    ("family_check", r"খেয়েছ|খাইছ|খাইসো|খেয়েছেন|কেমন আছ|কেমন আছেন|ভালো আছ|kemon acho|kemon achen|khaiso|kheyecho|how are you",
     "খোঁজখবর নিচ্ছে", "আন্তরিকভাবে নিজের খবর দাও এবং তার খবরও জিজ্ঞেস করো।"),
    ("thanks", r"ধন্যবাদ|শুকরিয়া|জাযাকাল্লাহ|thanks|thank you|thx|tnx",
     "ধন্যবাদ দিচ্ছে", "ছোট করে স্বাগত জানাও / ধন্যবাদ ফিরিয়ে দাও।"),
    ("sorry", r"দুঃখিত|সরি|মাফ করবেন|sorry|apologi",
     "দুঃখ প্রকাশ করছে", "সহজভাবে বলো সমস্যা নেই, সম্পর্ক স্বাভাবিক রাখো।"),
    ("complaint", r"এখনো|এখনও|কতদিন|কত দিন|বিরক্ত|কেন হয়নি|হয়নি কেন|দেরি|still|why not|late|delay",
     "অভিযোগ/তাড়া দিচ্ছে", "দুঃখ প্রকাশ করো, দেরির দায় নাও, জানাও খোঁজ নিয়ে দ্রুত জানাবে; নতুন তারিখ বানাবে না।"),
    ("money", r"টাকা|বিকাশ|নগদ|রকেট|পেমেন্ট|পাঠিয়েছি|পাঠাইছি|দাম দিয়েছি|taka|bkash|nagad|payment|paid|sent money",
     "টাকা-পয়সার কথা বলছে", "টাকা পেয়েছ কি না নিশ্চিত না জেনে কিছু স্বীকার করবে না; বলো দেখে নিশ্চিত হয়ে জানাবে।"),
    ("price", r"দাম|কত টাকা|কত পড়বে|কত হবে|রেট|খরচ|price|cost|rate|koto",
     "দাম জানতে চাইছে", "দাম NOTES-এ না থাকলে কোনো সংখ্যা দেবে না; বলো দামটা দেখে জানাচ্ছ।"),
    ("when", r"কবে|কখন|কয়টায়|কটায়|কত দিন লাগবে|kobe|kokhon|when|what time",
     "সময়/তারিখ জানতে চাইছে", "নির্দিষ্ট সময় NOTES-এ না থাকলে বানাবে না; বলো নিশ্চিত হয়ে সময় জানাবে।"),
    ("where", r"কোথায়|কই|কোন জায়গায়|ঠিকানা|লোকেশন|kothay|where|location|address",
     "জায়গা/ঠিকানা জানতে চাইছে", "ঠিকানা NOTES-এ না থাকলে বানাবে না; বলো জানিয়ে দেবে।"),
    ("status", r"হয়েছে\s*\?|হইছে|কী অবস্থা|কি অবস্থা|কাজটা|আপডেট|hoise|hoyeche|update|status|done\s*\?",
     "কাজের অবস্থা জানতে চাইছে", "NOTES-এ অবস্থা থাকলে সেটা বলো; না থাকলে বলো খোঁজ নিয়ে জানাবে।"),
    ("request", r"দিবেন|দেবেন|দেন|দাও|পাঠান|পাঠাও|করে দিন|করে দাও|লাগবে|দরকার|প্লিজ|please|plz|pls|need|send me|can you",
     "কিছু চাইছে/অনুরোধ করছে", "অনুরোধটা স্বীকার করো; নিশ্চিত না হলে কথা দেবে না, বলো দেখে জানাবে।"),
    ("meet", r"দেখা করব|দেখা হবে|আসবেন|আসবে|আসতে পারি|meet|come over|visit",
     "দেখা করতে চাইছে", "আগ্রহ দেখাও; সময় নিজে ঠিক করবে না, বলো সুবিধামতো সময় জানাবে।"),
    ("salam", r"আসসালামু|সালাম|assalam|salam",
     "সালাম দিচ্ছে", "সালামের জবাব (ওয়ালাইকুম আসসালাম) দাও এবং ছোট করে জিজ্ঞেস করো কীভাবে সাহায্য করতে পারি।"),
    ("greeting", r"হ্যালো|হাই|নমস্কার|শুভ সকাল|শুভ রাত্রি|hello|\bhi\b|hey|good morning|good night|good evening",
     "শুভেচ্ছা জানাচ্ছে", "প্রেরকের ভাষা ও শুভেচ্ছার ধরন মিলিয়ে ভদ্রভাবে স্বাগত জানাও (ইংরেজিতে লিখলে ইংরেজিতে, নমস্কার হলে নমস্কার, হ্যালো হলে হ্যালো; সালাম না দিলে ওয়ালাইকুম আসসালাম বলবে না)।"),
)


def read_pattern(text: str) -> Pattern:
    t = (text or "").strip()
    if not t:
        return Pattern("empty", "নতুন কোনো বার্তা নেই", "ছোট, ভদ্র একটি বার্তা লেখো।")
    for kind, rx, label, hint in _RULES:
        if _has(t, rx):
            return Pattern(kind, label, hint)
    if brain.is_question(t):
        return Pattern("question", "প্রশ্ন করছে", "প্রশ্নটার সরাসরি উত্তর দাও; তথ্য না থাকলে বলো জেনে জানাবে।")
    return Pattern("statement", "কিছু জানাচ্ছে", "বুঝেছ বলে ছোট করে সাড়া দাও।")


_BN = {
    "urgent": "{a}বার্তাটা দেখেছি, বিষয়টা জরুরি বুঝতে পারছি। যত দ্রুত সম্ভব দেখছি, একটু পরেই জানাচ্ছি।",
    "condolence": "ইন্না লিল্লাহি ওয়া ইন্না ইলাইহি রাজিউন। {a}খবরটা শুনে খুব খারাপ লাগছে। আল্লাহ তাঁকে জান্নাত দান করুন।",
    "sick": "{a}শুনে খারাপ লাগল। নিজের যত্ন নিন, আল্লাহ দ্রুত সুস্থ করে দিন। কিছু লাগলে জানাবেন।",
    "family_check": "{a}আলহামদুলিল্লাহ, ভালো আছি। আপনি কেমন আছেন? খাওয়া-দাওয়া ঠিকমতো করছেন তো?",
    "thanks": "{a}আপনাকেও অনেক ধন্যবাদ।",
    "sorry": "{a}কোনো সমস্যা নেই, চিন্তা করবেন না।",
    "complaint": "{a}দেরির জন্য দুঃখিত। বিষয়টা এখনই খোঁজ নিচ্ছি, দ্রুত জানাচ্ছি।",
    "money": "{a}ঠিক আছে, দেখে নিশ্চিত হয়ে আপনাকে জানাচ্ছি।",
    "price": "{a}দামটা দেখে আপনাকে জানাচ্ছি।",
    "when": "{a}সময়টা নিশ্চিত হয়ে আপনাকে জানাচ্ছি।",
    "where": "{a}ঠিকানাটা আপনাকে জানিয়ে দিচ্ছি।",
    "status": "{a}খোঁজ নিয়ে কাজের অবস্থা আপনাকে জানাচ্ছি।",
    "request": "{a}ঠিক আছে, বিষয়টা দেখছি। একটু পরে জানাচ্ছি।",
    "meet": "{a}অবশ্যই। সুবিধামতো সময়টা জানিয়ে দেব।",
    "salam": "ওয়ালাইকুম আসসালাম{c} কেমন আছেন? বলুন, কীভাবে সাহায্য করতে পারি?",
    "greeting": "হ্যালো{c} কেমন আছেন? বলুন, কীভাবে সাহায্য করতে পারি?",
    "question": "{a}ভালো প্রশ্ন। একটু দেখে আপনাকে জানাচ্ছি।",
    "statement": "{a}ঠিক আছে, বুঝেছি।",
    "empty": "{a}কেমন আছেন?",
}
_BN_FAMILY = {  # the same kinds, said the way one talks at home ("তুমি")
    "family_check": "{a}আলহামদুলিল্লাহ ভালো আছি। তুমি কেমন আছ? খেয়েছ?",
    "salam": "ওয়ালাইকুম আসসালাম{c} কেমন আছ?",
    "greeting": "হ্যালো{c} কেমন আছ?",
    "request": "{a}আচ্ছা, দেখছি। একটু পরে জানাচ্ছি।",
    "question": "{a}একটু দেখে তোমাকে জানাচ্ছি।",
    "statement": "{a}আচ্ছা, ঠিক আছে।",
    "money": "{a}আচ্ছা, দেখে জানাচ্ছি।",
    "when": "{a}সময়টা ঠিক করে তোমাকে জানাচ্ছি।",
    "sick": "{a}শুনে খারাপ লাগল। ওষুধ খেয়েছ? বিশ্রাম নাও, আমি খোঁজ নিচ্ছি।",
    "thanks": "{a}আরে, এটা তো কিছুই না।",
    "empty": "{a}কেমন আছ?",
}
_EN = {
    "urgent": "{a}I've seen your message and understand it's urgent. I'm looking into it and will get back to you shortly.",
    "condolence": "{a}I'm so sorry to hear this. My deepest condolences, and prayers for the family.",
    "sick": "{a}Sorry to hear that. Please take care and get well soon. Let me know if you need anything.",
    "family_check": "{a}I'm doing well, thank you. How are you?",
    "thanks": "{a}You're welcome!",
    "sorry": "{a}No problem at all, don't worry.",
    "complaint": "{a}Sorry for the delay. I'm checking on it now and will update you soon.",
    "money": "{a}Okay, I'll check and confirm shortly.",
    "price": "{a}Let me check the price and get back to you.",
    "when": "{a}I'll confirm the time and let you know.",
    "where": "{a}I'll share the location with you.",
    "status": "{a}I'll check the status and update you.",
    "request": "{a}Sure, I'm looking into it and will let you know.",
    "meet": "{a}Sure, I'll let you know a convenient time.",
    "salam": "Wa alaikum assalam{c} How can I help you?",
    "greeting": "Hello{c} How can I help you?",
    "question": "{a}Good question, let me check and get back to you.",
    "statement": "{a}Okay, noted.",
    "empty": "{a}Hope you're doing well.",
}


def rule_draft(pattern: Pattern, lang: str = "bn", address: str = "", family: bool = False, variant: int = 0) -> str:
    """A safe draft from rules only. `variant` > 0 changes the opening a little so "another one" never repeats word for word."""
    a = (address or "").strip()
    if lang == "en":
        table, opener, comma = _EN, (f"{a}, " if a else ""), (f" {a}," if a else ",")
    else:
        table = {**_BN, **_BN_FAMILY} if family else _BN
        opener, comma = (f"{a}, " if a else ""), (f" {a}," if a else ",")
    text = table.get(pattern.kind, table["statement"]).format(a=opener, c=comma)
    if variant % 3 == 1 and lang != "en":
        text = text.replace("জানাচ্ছি", "জানিয়ে দেব").replace("দেখছি", "দেখে নিচ্ছি")
    elif variant % 3 == 2 and lang != "en":
        text = text.replace("ঠিক আছে", "জি আচ্ছা") if not family else text.replace("আচ্ছা", "ঠিক আছে")
    return re.sub(r"\s{2,}", " ", text).strip()


def address_for(contact) -> str:  # noqa: ANN001 — WaContact or a test stand-in
    """How the owner addresses this person (`profile.address`, learned or saved). `calls_him` is how THEY address the owner, so it is
    deliberately not used here; never a raw phone number."""
    p = getattr(contact, "profile", None) or {}
    v = p.get("address")
    return str(v).strip()[:30] if v and str(v).strip() else ""
