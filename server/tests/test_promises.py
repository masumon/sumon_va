"""Promise tracking: the owner's own commitments become tasks (no network, no database)."""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.assistant import promises as p

DHAKA = timezone(timedelta(hours=6))
NOW = datetime(2026, 11, 4, 11, 0, tzinfo=DHAKA)  # a Wednesday


def d(text):
    return p.detect_promise(text, NOW)


@pytest.mark.parametrize("text", [
    "ভাই কাল পাঠাব", "আজই করে দিচ্ছি, চিন্তা করবেন না", "পরশু জানাব ইনশাআল্লাহ", "দেখে বলছি একটু পরে",
    "I will send it tomorrow", "will call you tonight", "I'll get back to you by Friday",
])
def test_positive_promises(text):
    r = d(text)
    assert r and r["title"] and len(r["title"]) <= 80 and r["due_at"]


@pytest.mark.parametrize("text", [
    "কাল পাঠাবেন?", "আমি এটা করব না", "পাঠাব না ভাই", "I will not send it", "I can't call you tomorrow",
    "ok", "ঠিক আছে", "He said \"I will send it tomorrow\" last week", "আপনি কাল পাঠাবেন", "Will you send it tomorrow?",
    "", "ধন্যবাদ ভাই, ভালো আছি",
])
def test_negatives(text):
    assert d(text) is None


def test_due_date_words():
    assert d("কাল পাঠাব")["due_at"] == datetime(2026, 11, 5, 10, 0, tzinfo=DHAKA)
    assert d("পরশু জানাব")["due_at"] == datetime(2026, 11, 6, 10, 0, tzinfo=DHAKA)
    assert d("আগামীকাল দিয়ে দেব")["due_at"].day == 5
    assert d("I will send it tomorrow")["due_at"].day == 5
    assert d("will call you tonight")["due_at"] == datetime(2026, 11, 4, 21, 0, tzinfo=DHAKA)
    assert d("আজ বিকেলে করে দেব")["due_at"] == datetime(2026, 11, 4, 16, 0, tzinfo=DHAKA)
    assert d("I'll send it by Friday")["due_at"] == datetime(2026, 11, 6, 10, 0, tzinfo=DHAKA)


def test_vague_promise_defaults_to_next_day_ten():
    assert d("দেখে বলছি")["due_at"] == datetime(2026, 11, 5, 10, 0, tzinfo=DHAKA)


def test_yesterday_is_not_tomorrow():
    assert d("গতকাল পাঠাব ভেবেছিলাম, এখন করে দিচ্ছি")["due_at"].day == 5  # vague, not "কাল"


def test_long_title_is_cut_to_80():
    r = d("I will send you the complete list of every item " + "and more " * 20)
    assert r and len(r["title"]) <= 80


def test_naive_now_is_treated_as_utc():
    r = p.detect_promise("কাল পাঠাব", datetime(2026, 11, 4, 5, 0))
    assert r["due_at"].day == 5


class FakeDb:
    def __init__(self, titles=()):
        self.titles, self.added = list(titles), []

    async def execute(self, _q):
        return SimpleNamespace(all=lambda: [(t,) for t in self.titles])

    def add(self, x):
        self.added.append(x)
        self.titles.append(x.title)


def run(db, contact, text):
    return asyncio.run(p.track_promise(db, contact, text, NOW))


def test_track_creates_task_once():
    db, c = FakeDb(), SimpleNamespace(id="c1", is_family=False, category="business")
    t = run(db, c, "কাল পাঠাব")
    assert t and t.title == "কাজ করে দেওয়া: কাল পাঠাব" and t.source == "ai" and t.contact_id == "c1"
    assert run(db, c, "কাল পাঠাব") is None  # same open task → no duplicate
    assert len(db.added) == 1


def test_track_ignores_non_promises():
    assert run(FakeDb(), SimpleNamespace(id="c1", is_family=False, category=None), "ধন্যবাদ ভাই") is None


def test_private_contact_gets_generic_title_without_text():
    for c in (SimpleNamespace(id="c2", is_family=True, category=None), SimpleNamespace(id="c3", is_family=False, category="personal")):
        db = FakeDb()
        t = run(db, c, "আম্মু কাল টাকা পাঠাব")
        assert t.title == p.GENERIC_TITLE and "টাকা" not in t.title


# ── kinds and clock times ─────────────────────────────────────────────────────

@pytest.mark.parametrize("text,kind", [
    ("কাল টাকা দেব", "money"), ("আজ রাতে বিকাশ করে দেব", "money"), ("বেতনের টাকা পরিশোধ করব", "money"),
    ("I will pay you tomorrow", "money"), ("will send the money tonight", "money"),
    ("ঠিক করে দেব কাল", "work"), ("আজই করে দিচ্ছি", "work"), ("I will fix it tomorrow", "work"),
    ("কাল দেখা করব", "meeting"), ("পরশু অফিসে আসুন", "meeting"), ("let's meet tomorrow", "meeting"), ("I will come on Friday", "meeting"),
    ("দেখে বলছি", "reply"), ("পরশু জানাব", "reply"), ("I will let you know tomorrow", "reply"),
])
def test_kinds(text, kind):
    r = d(text)
    assert r and r["kind"] == kind and r["title"].startswith(p.PREFIX[kind])


def test_prefixes_in_bangla():
    assert d("কাল টাকা দেব")["title"].startswith("টাকা দেওয়া:")
    assert d("কাল ঠিক করে দেব")["title"].startswith("কাজ করে দেওয়া:")
    assert d("কাল দেখা করব")["title"].startswith("দেখা করা:")
    assert d("পরশু জানাব")["title"].startswith("জানানো:")


def test_bangla_clock_times_and_digits():
    assert d("কাল সকাল ৯টায় দেখা করব")["due_at"] == datetime(2026, 11, 5, 9, 0, tzinfo=DHAKA)
    assert d("কাল দুপুর ১২টায় দেখা হবে")["due_at"] == datetime(2026, 11, 5, 12, 0, tzinfo=DHAKA)
    assert d("কাল বিকাল ৫টায় অফিসে আসব")["due_at"] == datetime(2026, 11, 5, 17, 0, tzinfo=DHAKA)
    assert d("আজ সন্ধ্যা ৭টায় দেখা করব")["due_at"] == datetime(2026, 11, 4, 19, 0, tzinfo=DHAKA)
    assert d("আজ রাত ৮:৩০ এ টাকা দেব")["due_at"] == datetime(2026, 11, 4, 20, 30, tzinfo=DHAKA)
    assert d("কাল 5টায় দেখা করব")["due_at"] == datetime(2026, 11, 5, 17, 0, tzinfo=DHAKA)


def test_english_clock_times():
    assert d("I will come tomorrow at 5 pm")["due_at"] == datetime(2026, 11, 5, 17, 0, tzinfo=DHAKA)
    assert d("let's meet tomorrow 10:30")["due_at"] == datetime(2026, 11, 5, 10, 30, tzinfo=DHAKA)
    assert d("I will call you at 9 am tomorrow")["due_at"] == datetime(2026, 11, 5, 9, 0, tzinfo=DHAKA)


def test_bangla_weekday_with_time():
    assert d("শুক্রবার বিকাল ৪টায় দেখা করব")["due_at"] == datetime(2026, 11, 6, 16, 0, tzinfo=DHAKA)


def test_clock_without_day_means_next_occurrence():
    assert d("সন্ধ্যা ৭টায় দেখা করব")["due_at"] == datetime(2026, 11, 4, 19, 0, tzinfo=DHAKA)
    assert d("সকাল ৯টায় দেখা করব")["due_at"] == datetime(2026, 11, 5, 9, 0, tzinfo=DHAKA)  # 9:00 today already passed


def test_meeting_title_carries_the_time():
    r = d("দেখা করব, কাল বিকাল ৫টায়")
    assert r["title"].startswith("দেখা করা:") and "05/11 17:00" in r["title"] and len(r["title"]) <= 80


@pytest.mark.parametrize("text", [
    "টাকা দেব না", "কাল আসতে পারব না", "যদি টাকা পাই তাহলে কাল দেব", "যদি টাকা পাই, কাল দেব", "if I get paid I will pay tomorrow",
    "কাল কখন দেখা করব?", "> কাল টাকা দেব\nঠিক আছে ভাই", "Forwarded message: কাল টাকা দেব",
])
def test_kind_negatives(text):
    assert d(text) is None
