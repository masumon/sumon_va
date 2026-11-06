"""Missed-call intelligence (Brain_Prompt §9.2, acceptance tests 7-12): context, hypotheses, burst control. No database, no network."""
import copy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.assistant import call_context as cc
from app.assistant import wa_brain as brain
from app.assistant import wa_config as wc

T0 = datetime(2026, 11, 6, 10, 0, tzinfo=timezone.utc)


def cfg(**calls):
    c = copy.deepcopy(wc.DEFAULT_CONFIG)
    c["calls"].update(calls)
    return c


def person(**over):
    return SimpleNamespace(**{"is_family": False, "is_vip": False, "tags": None, "category": None, "channel": "sms", **over})


def call(minutes, alert=None):
    m = {"id": f"c{minutes}", "direction": "in", "body": cc.MISSED_TEXT, "status": "received", "reason": None,
         "created_at": T0 + timedelta(minutes=minutes), "meta": {"call": True}}
    if alert:
        m["meta"]["call_alert"] = alert
    return m


def text(minutes, body, direction="in", status="received", reason=None):
    return {"id": f"t{minutes}{direction}", "direction": direction, "body": body, "status": status, "reason": reason,
            "created_at": T0 + timedelta(minutes=minutes), "meta": {}}


def simulate(minutes_list, contact=None, tasks=None, c=None, extra=None):
    """Feed a series of calls one by one the way wa_flow does; returns the insights. Alerts are recorded in meta like _process does."""
    history, out = list(extra or []), []
    for mins in minutes_list:
        recent = sorted(history, key=lambda m: m["created_at"], reverse=True)
        ins = cc.analyze(c or cfg(), contact or person(), recent, tasks or [], T0 + timedelta(minutes=mins), 5)
        out.append(ins)
        history.append(call(mins, {"p": ins.priority, "n": ins.attempts_burst} if ins.alert else None))
    return out


# ── 7-9: context and honesty ──────────────────────────────────────────────────

def test_a_lone_call_from_a_stranger_stays_quiet_but_says_so_honestly():
    ins = simulate([0])[0]
    assert not ins.alert and ins.priority == 5 and ins.level == "নিম্ন"
    assert "প্রমাণ নেই" in ins.hypotheses[0][0] and ins.suppressed_why


def test_earlier_messages_and_open_tasks_are_part_of_the_alert():
    recent = [text(-30, "ভাই ডিজাইনটা কবে পাব?")]
    tasks = [{"title": "লোগো ডিজাইন", "due_at": T0 - timedelta(days=1)}]
    ins = cc.analyze(cfg(), person(), recent, tasks, T0, 5)
    assert ins.alert and ins.priority == 3
    joined = " ".join(ins.facts)
    assert "১টি বার্তার উত্তর যায়নি".replace("১", "1") in joined and "1টি খোলা কাজ" in joined and "সময় পেরিয়েছে" in joined
    assert "ডিজাইনটা কবে" in joined  # a business contact: the last words are shown


def test_a_reason_is_always_a_labelled_hypothesis_with_confidence_never_a_fact():
    ins = cc.analyze(cfg(), person(), [text(-10, "টাকা পাঠালাম?")], [], T0, 5)
    assert "অনুমান" in ins.summary and "আস্থা" in ins.summary
    assert all(level in ("উচ্চ", "মাঝারি", "নিম্ন") for _, level in ins.hypotheses)
    assert "নিশ্চিত নয়" in ins.note


def test_a_private_contacts_words_never_appear_in_the_summary():
    me = person(is_family=True)
    ins = cc.analyze(cfg(), me, [text(-5, "আম্মার অপারেশন কাল")], [], T0, 5)
    assert "অপারেশন" not in ins.summary + ins.note + " ".join(ins.facts)
    assert ins.alert and ins.priority == 2  # family stays at least high


def test_an_owner_reply_is_recognised_and_lowers_the_guess():
    recent = [text(-3, "আচ্ছা দেখছি", "out", "sent", "owner"), text(-20, "কাজটা হয়েছে?")]
    ins = cc.analyze(cfg(), person(), recent, [], T0, 5)
    assert "আপনি আগেই উত্তর দিয়েছেন" in ins.facts
    assert not any("উত্তর না পেয়ে" in h for h, _ in ins.hypotheses)


def test_priority_words_of_the_last_message_lift_the_priority():
    ins = cc.analyze(cfg(), person(), [text(-4, "urgent please call")], [], T0, 5)
    assert ins.priority == 1 and ins.level == "জরুরি" and ins.alert


# ── 10-12: burst control ──────────────────────────────────────────────────────

def test_three_calls_in_ten_minutes_from_a_stranger_make_exactly_one_alert():
    ins = simulate([0, 3, 6])
    assert [i.alert for i in ins] == [False, False, True]
    assert ins[2].attempts_burst == 3 and ins[2].priority == 4


def test_three_calls_from_a_known_person_alert_once_not_three_times():
    ins = simulate([0, 3, 6], tasks=[{"title": "রিপোর্ট", "due_at": None}])
    assert [i.alert for i in ins] == [True, False, False]
    assert "আগেই গেছে" in ins[1].suppressed_why


def test_a_fourth_call_does_not_escalate_without_new_evidence_or_a_rule():
    ins = simulate([0, 3, 6, 8])
    assert [i.alert for i in ins] == [False, False, True, False]
    assert not ins[3].escalated


def test_a_new_message_after_the_alert_makes_the_next_call_escalate():
    first = simulate([0, 3, 6])
    history = [call(0), call(3), call(6, {"p": 4, "n": 3}), text(7, "প্লিজ ধরুন")]
    recent = sorted(history, key=lambda m: m["created_at"], reverse=True)
    ins = cc.analyze(cfg(), person(), recent, [], T0 + timedelta(minutes=8), 5)
    assert first[2].alert and ins.alert and ins.escalated


def test_the_owner_can_set_a_rule_that_escalates_by_count():
    c = cfg(escalate_after=5)
    ins = simulate([0, 1, 2, 3, 4], c=c)
    assert [i.alert for i in ins] == [False, False, True, False, True]
    assert ins[4].escalated


def test_a_repeated_identical_call_event_is_not_alerted_twice():
    recent = [call(0, {"p": 3, "n": 1})]
    tasks = [{"title": "রিপোর্ট", "due_at": None}]
    ins = cc.analyze(cfg(), person(), recent, tasks, T0 + timedelta(seconds=30), 5)
    assert not ins.alert


def test_a_call_after_the_burst_window_is_a_new_burst():
    tasks = [{"title": "রিপোর্ট", "due_at": None}]
    ins = cc.analyze(cfg(), person(), [call(0, {"p": 3, "n": 1})], tasks, T0 + timedelta(minutes=45), 5)
    assert ins.alert and ins.attempts_burst == 1 and ins.attempts_day == 2


def test_naive_database_times_do_not_break_the_analysis():
    naive = dict(call(0), created_at=datetime(2026, 11, 6, 10, 0))
    ins = cc.analyze(cfg(), person(), [naive], [], T0 + timedelta(minutes=2), 5)
    assert ins.attempts_burst == 2


# ── applying to the decision ──────────────────────────────────────────────────

def test_apply_notifies_and_never_writes_to_a_caller_by_default():
    d = brain.Decision(reply="কী প্রয়োজন?", reason="ask1", priority=5)
    ins = cc.analyze(cfg(), person(), [text(-10, "কাজটা কবে?")], [], T0, 5)
    assert cc.apply(d, ins, cfg())
    assert d.reply is None and d.reason == "call_missed" and d.notify and d.kind == "call" and d.priority == 3


def test_the_owner_can_switch_the_old_reply_behaviour_back_on():
    d = brain.Decision(reply="কী প্রয়োজন?", reason="ask1")
    cc.apply(d, cc.analyze(cfg(reply=True), person(), [], [], T0, 5), cfg(reply=True))
    assert d.reply == "কী প্রয়োজন?"


def test_a_blocked_number_or_a_silenced_owner_hold_is_never_reopened_by_a_call():
    for reason in ("blocked", "spam", "owner_active"):
        d = brain.Decision(reason=reason, notify=False, priority=5)
        assert cc.apply(d, cc.analyze(cfg(), person(), [], [{"title": "x", "due_at": None}], T0, 5), cfg()) is False
        assert not d.notify and d.reason == reason


def test_a_message_soon_after_a_missed_call_is_noted_as_a_fact():
    assert "ফোন করার পর 4 মিনিট" in cc.after_call_note([call(0)], T0 + timedelta(minutes=4))
    assert cc.after_call_note([call(0)], T0 + timedelta(minutes=50)) == ""
    assert cc.after_call_note([text(0, "hi")], T0 + timedelta(minutes=1)) == ""


def test_the_settings_are_clamped_and_default_to_the_documented_values():
    assert cc.settings({}) == {"burst_min": 10, "escalate_after": 0, "reply": False}
    assert cc.settings({"calls": {"burst_min": 9999, "escalate_after": "x"}})["burst_min"] == 120
    assert wc.DEFAULT_CONFIG["calls"] == {"burst_min": 10, "escalate_after": 0, "reply": False}
