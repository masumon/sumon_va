"""Passkeys: relying-party config, stateless challenge tokens, options shape."""
import types

import pytest
from fastapi import HTTPException

from app.api.v1.routes import passkeys as pk


def _req(origin: str):
    return types.SimpleNamespace(headers={"origin": origin})


def test_rp_production_and_localhost():
    rp, origins = pk._rp(_req("https://www.aboenterprise.com"))
    assert rp.endswith("aboenterprise.com") and f"https://www.{rp}" in origins
    assert pk._rp(_req("http://localhost:3000")) == ("localhost", ["http://localhost:3000"])


def test_challenge_token_round_trip_and_purpose_bound():
    tok = pk._challenge_token(b"abc123", "register", "admin:x")
    assert pk._read_challenge(tok, "register", "admin:x") == b"abc123"
    with pytest.raises(HTTPException):
        pk._read_challenge(tok, "login:admin")
    with pytest.raises(HTTPException):
        pk._read_challenge(tok, "register", "admin:someone-else")
    with pytest.raises(HTTPException):
        pk._read_challenge("garbage", "register", "admin:x")


def test_b64u_round_trip():
    raw = bytes(range(40))
    assert pk._unb64u(pk._b64u(raw)) == raw


@pytest.mark.asyncio
async def test_login_options_shape():
    r = await pk.login_options(_req("https://www.aboenterprise.com"), kind="admin")
    o = r.data["options"]
    assert o["rpId"].endswith("aboenterprise.com") and o["challenge"] and o["userVerification"] == "required"
    assert pk._read_challenge(r.data["token"], "login:admin") == pk._unb64u(o["challenge"])
