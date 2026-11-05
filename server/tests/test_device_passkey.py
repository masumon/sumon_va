"""Phone-app sign-in options: assetlinks.json, sign-in by saved phone number, and the app's own passkey.
In-memory SQLite (no network). Real WebAuthn crypto is NOT exercised: verify_registration_response /
verify_authentication_response are mocked; the guard paths (tokens, unknown credentials, auth, limits) are real."""
import types
import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1.routes import inbox as ib
from app.api.v1.routes import passkeys as pk
from app.core.config import settings
from app.core.security import hash_password
from app.models.models import ActivityLog, AdminUser, Passkey, Setting
from app.models.wa import InboxDevice, InboxPairCode

PHONE = "01711223344"


@pytest_asyncio.fixture
async def Session():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        for model in (Setting, ActivityLog, AdminUser, Passkey, InboxDevice, InboxPairCode):
            await conn.run_sync(model.__table__.create)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def req(ip="9.9.9.9"):
    return types.SimpleNamespace(headers={"cf-connecting-ip": ip}, client=None)


async def make_owner(s, email="owner@example.com", with_phone=True):
    u = AdminUser(email=email, password_hash=hash_password("x"), name="সুমন", role="super_admin", is_active=True)
    s.add(u)
    await s.flush()
    if with_phone:
        await ib.flow._set_val(s, ib.PHONE_KEY, ib.normalize_bd_phone(PHONE))
        await ib.flow._set_val(s, ib.PHONE_ADMIN_KEY, str(u.id))
    await s.commit()
    return u


async def make_dev(s, user):
    d = InboxDevice(name="t", admin_id=user.id, token_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    s.add(d)
    await s.commit()
    return d


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    ib._otp_fail.clear()
    from app.api.v1.routes import auth as auth_routes
    auth_routes._login_failures.clear()
    sent = {"mail": [], "tg": []}

    async def fake_mail(to, subject, html, *a, **k):
        sent["mail"].append((to, html))

    async def fake_tg(chat, text, *a, **k):
        sent["tg"].append((chat, text))

    monkeypatch.setattr(ib, "send_email", fake_mail)
    monkeypatch.setattr(ib.telegram, "configured", lambda: True)
    monkeypatch.setattr(ib.telegram, "send_text", fake_tg)
    monkeypatch.setattr(settings, "TELEGRAM_OWNER_ID", "555")
    from datetime import datetime
    monkeypatch.setattr(ib, "_now", lambda: datetime.utcnow())  # SQLite returns naive datetimes; Postgres is tz-aware
    return sent


# ── assetlinks.json ──────────────────────────────────────────────────────────
def test_assetlinks_is_served_directly_as_json():
    from app.main import app

    r = TestClient(app).get("/.well-known/assetlinks.json", follow_redirects=False)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert "max-age" in r.headers["cache-control"]
    body = r.json()
    assert body[0]["relation"] == ["delegate_permission/common.get_login_creds"]
    t = body[0]["target"]
    assert t["namespace"] == "android_app" and t["package_name"] == "com.masumon.sumonva"
    assert t["sha256_cert_fingerprints"] == [
        "56:09:5F:0F:AC:72:F8:F1:DC:CB:EB:70:62:C3:EE:00:5E:A5:1B:69:80:F6:A2:B6:89:F3:53:A6:DF:96:38:BA",
        "B0:79:7D:14:84:38:30:83:AB:D3:05:B4:65:4B:C6:06:CB:F6:41:F5:5A:FD:D0:41:F6:59:3D:18:32:5D:B3:92",
    ]


def test_config_defaults():
    assert settings.DEVICE_PASSKEY_RP_ID == "va-api.aboenterprise.com"
    assert len(settings.device_passkey_origins) == 2 and all(o.startswith("android:apk-key-hash:") for o in settings.device_passkey_origins)


# ── phone-number code sign-in ────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_phone_number_gets_the_code_by_email_and_telegram_and_can_sign_in(Session, clean_state):
    async with Session() as s:
        u = await make_owner(s)
        r = await ib.otp_request(ib.OtpRequestIn(email="০১৭১১-২২৩৩৪৪"), req(), s)  # Bangla digits + dash are fine
        assert r == {"ok": True, "minutes": ib.OTP_MINUTES}
        assert len(clean_state["mail"]) == 1 and clean_state["mail"][0][0] == u.email
        chat, text = clean_state["tg"][0]
        assert chat == "555" and "আপনার সাইন-ইন কোড" in text
        code = text.split(":")[1].split()[0]
        out = await ib.otp_verify(ib.OtpVerifyIn(email=PHONE, code=code, name="ফোন"), req(), s)
        assert out["token"] and out["name"] == "সুমন" and out["device_id"]
        with pytest.raises(HTTPException) as e:  # the code is spent
            await ib.otp_verify(ib.OtpVerifyIn(email=PHONE, code=code), req(), s)
        assert e.value.status_code == 400


@pytest.mark.asyncio
async def test_email_request_does_not_use_telegram_and_telegram_failure_is_harmless(Session, clean_state, monkeypatch):
    async with Session() as s:
        await make_owner(s)
        await ib.otp_request(ib.OtpRequestIn(email="owner@example.com"), req(), s)
        assert len(clean_state["mail"]) == 1 and clean_state["tg"] == []

    async def boom(*a, **k):
        raise RuntimeError("telegram down")

    monkeypatch.setattr(ib.telegram, "send_text", boom)
    async with Session() as s:
        s.add(Setting(key="x", value="y", data_type="string"))  # session still usable
        r = await ib.otp_request(ib.OtpRequestIn(email=PHONE), req("8.8.8.8"), s)
        assert r["ok"] is True


@pytest.mark.asyncio
async def test_unknown_phone_looks_exactly_like_a_known_one(Session, clean_state):
    async with Session() as s:
        await make_owner(s)
        known = await ib.otp_request(ib.OtpRequestIn(email=PHONE), req(), s)
        unknown = await ib.otp_request(ib.OtpRequestIn(email="01999887766"), req(), s)
        junk = await ib.otp_request(ib.OtpRequestIn(email="not a number at all"), req(), s)
        assert known == unknown == junk
        assert len(clean_state["mail"]) == 1 and len(clean_state["tg"]) == 1
        with pytest.raises(HTTPException) as e:
            await ib.otp_verify(ib.OtpVerifyIn(email="01999887766", code="123456"), req(), s)
        assert e.value.status_code == 400 and "কোডটি ভুল" in e.value.detail


@pytest.mark.asyncio
async def test_phone_sign_in_keeps_the_resend_rule_and_the_wrong_tries_lock(Session, clean_state):
    async with Session() as s:
        await make_owner(s)
        await ib.otp_request(ib.OtpRequestIn(email=PHONE), req(), s)
        await ib.otp_request(ib.OtpRequestIn(email=PHONE), req(), s)  # within 60 s: no second code
        assert len(clean_state["mail"]) == 1 and len(clean_state["tg"]) == 1
        for i in range(ib.OTP_MAX_TRIES):
            with pytest.raises(HTTPException) as e:
                await ib.otp_verify(ib.OtpVerifyIn(email=PHONE, code=f"11111{i}"), req(f"7.7.7.{i}"), s)
            assert e.value.status_code == 400
        with pytest.raises(HTTPException) as e:
            await ib.otp_verify(ib.OtpVerifyIn(email=PHONE, code="999999"), req("7.7.7.99"), s)
        assert e.value.status_code == 429


# ── the app's own passkey ────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_passkey_options_use_the_api_host_and_a_device_login_token():
    r = await ib.device_passkey_options()
    o = r["options"]
    assert o["rpId"] == "va-api.aboenterprise.com" and o["userVerification"] == "required" and not o.get("allowCredentials")
    assert pk._read_challenge(r["token"], "device-login") == pk._unb64u(o["challenge"])
    with pytest.raises(HTTPException):  # the web login token cannot be replayed here and vice versa
        pk._read_challenge(r["token"], "login:admin")


@pytest.mark.asyncio
async def test_passkey_verify_guard_paths_give_401(Session):
    async with Session() as s:
        await make_owner(s)
        with pytest.raises(HTTPException) as e:
            await ib.device_passkey_verify(ib.PasskeyVerifyIn(token="garbage", credential={"id": "x"}), req(), s)
        assert e.value.status_code == 401
        tok = (await ib.device_passkey_options())["token"]
        with pytest.raises(HTTPException) as e:
            await ib.device_passkey_verify(ib.PasskeyVerifyIn(token=tok, credential={"id": "nobody"}), req(), s)
        assert e.value.status_code == 401
        # a WEB passkey (owner_type "admin") is not accepted by the app
        s.add(Passkey(owner_type="admin", owner_ref=str(uuid.uuid4()), credential_id="webcred", public_key="AA", sign_count=0))
        await s.commit()
        with pytest.raises(HTTPException) as e:
            await ib.device_passkey_verify(ib.PasskeyVerifyIn(token=tok, credential={"id": "webcred"}), req(), s)
        assert e.value.status_code == 401


@pytest.mark.asyncio
async def test_passkey_verify_success_issues_a_device_like_otp_verify(Session, monkeypatch):
    import webauthn

    seen = {}

    def fake_verify(**kw):
        seen.update(kw)
        return types.SimpleNamespace(new_sign_count=7)

    monkeypatch.setattr(webauthn, "verify_authentication_response", fake_verify)
    async with Session() as s:
        u = await make_owner(s)
        s.add(Passkey(owner_type="admin_app", owner_ref=str(u.id), credential_id="appcred", public_key=pk._b64u(b"k"), sign_count=3))
        await s.commit()
        tok = (await ib.device_passkey_options())["token"]
        out = await ib.device_passkey_verify(ib.PasskeyVerifyIn(token=tok, credential={"id": "appcred"}, name="Pixel", app_version="1.2"), req(), s)
        assert set(out) == {"device_id", "token", "name"} and out["name"] == "সুমন"
        assert seen["expected_rp_id"] == "va-api.aboenterprise.com" and seen["expected_origin"] == settings.device_passkey_origins
        assert seen["require_user_verification"] is True
        row = (await s.execute(select(Passkey).where(Passkey.credential_id == "appcred"))).scalar_one()
        assert row.sign_count == 7 and row.last_used_at is not None
        dev = (await s.execute(select(InboxDevice).where(InboxDevice.id == uuid.UUID(out["device_id"])))).scalar_one()
        assert dev.admin_id == u.id and dev.name == "Pixel" and dev.app_version == "1.2"
        # a removed or deactivated owner is refused
        u.is_active = False
        await s.commit()
        with pytest.raises(HTTPException) as e:
            await ib.device_passkey_verify(ib.PasskeyVerifyIn(token=tok, credential={"id": "appcred"}), req(), s)
        assert e.value.status_code == 401


@pytest.mark.asyncio
async def test_passkey_register_needs_a_paired_device(Session):
    from app.main import app  # the dependency is wired on the real routes

    paths = {(r.path, tuple(sorted(r.methods))) for r in app.routes if hasattr(r, "methods")}
    for p, m in (("/api/v1/device/passkey/register/options", "POST"), ("/api/v1/device/passkey/register/verify", "POST"),
                 ("/api/v1/device/passkey/list", "GET")):
        assert any(path == p and m in meths for path, meths in paths), p
    from app.core.database import get_db

    async def _db():
        async with Session() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    c = TestClient(app)
    for method, url in (("post", "/api/v1/device/passkey/register/options"), ("post", "/api/v1/device/passkey/register/verify"),
                        ("get", "/api/v1/device/passkey/list"), ("delete", f"/api/v1/device/passkey/{uuid.uuid4()}")):
        r = c.request(method.upper(), url, json={"token": "t", "credential": {}} if method == "post" else None)
        assert r.status_code in (401, 422), (url, r.status_code)  # no device token -> never succeeds
    app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_passkey_register_options_verify_list_delete_and_limit(Session, monkeypatch):
    import webauthn

    counter = {"n": 0}

    def fake_reg(**kw):
        counter["n"] += 1
        assert kw["expected_rp_id"] == "va-api.aboenterprise.com" and kw["expected_origin"] == settings.device_passkey_origins
        return types.SimpleNamespace(credential_id=b"cred%d" % counter["n"], credential_public_key=b"pub", sign_count=0)

    monkeypatch.setattr(webauthn, "verify_registration_response", fake_reg)
    async with Session() as s:
        u = await make_owner(s)
        dev = await make_dev(s, u)
        opt = (await ib.device_passkey_register_options(dev, s)).data
        assert opt["options"]["rp"]["id"] == "va-api.aboenterprise.com"
        assert pk._read_challenge(opt["token"], "device-register", f"admin_app:{u.id}")
        with pytest.raises(HTTPException) as e:  # a web register token is not accepted
            web = pk._challenge_token(b"x", "register", f"admin_app:{u.id}")
            await ib.device_passkey_register_verify(ib.PasskeyVerifyIn(token=web, credential={}), dev, s)
        assert e.value.status_code == 400
        for i in range(ib.APP_PASSKEY_MAX):
            tok = pk._challenge_token(b"c", "device-register", f"admin_app:{u.id}")
            r = await ib.device_passkey_register_verify(ib.PasskeyVerifyIn(token=tok, credential={"response": {}}, name=f"ফোন {i}"), dev, s)
            assert r.data["name"] == f"ফোন {i}"
        rows = (await s.execute(select(Passkey))).scalars().all()
        assert len(rows) == 5 and all(p.owner_type == "admin_app" and p.owner_ref == str(u.id) for p in rows)
        with pytest.raises(HTTPException) as e:
            await ib.device_passkey_register_options(dev, s)
        assert e.value.status_code == 400
        with pytest.raises(HTTPException) as e:
            await ib.device_passkey_register_verify(ib.PasskeyVerifyIn(token="x", credential={}), dev, s)
        assert e.value.status_code == 400
        listed = (await ib.device_passkey_list(dev, s)).data
        assert len(listed) == 5
        await ib.device_passkey_delete(uuid.UUID(listed[0]["id"]), dev, s)
        assert len((await ib.device_passkey_list(dev, s)).data) == 4
        with pytest.raises(HTTPException) as e:
            await ib.device_passkey_delete(uuid.uuid4(), dev, s)
        assert e.value.status_code == 404
        # another admin's phone never sees these
        other = await make_owner(s, email="o2@example.com", with_phone=False)
        assert (await ib.device_passkey_list(await make_dev(s, other), s)).data == []
