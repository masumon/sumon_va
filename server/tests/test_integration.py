"""The ABO-admin integration door: off by default, signed, no replay (no network, no database)."""
import asyncio
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.routes import integration as integ
from app.core.config import settings

TOKEN = "t" * 40


def call(token_header=None, ts=None, sig=None, method="GET", path="/api/v1/integration/devices", configured=TOKEN):
    settings.VA_INTEGRATION_TOKEN = configured
    ts = ts if ts is not None else str(int(time.time()))
    sig = sig if sig is not None else integ.expected_signature(TOKEN, ts, method, path)
    req = SimpleNamespace(method=method, url=SimpleNamespace(path=path))
    return asyncio.run(integ.service_auth(req, token_header if token_header is not None else f"Bearer {TOKEN}", ts, sig))


@pytest.fixture(autouse=True)
def _restore():
    old = settings.VA_INTEGRATION_TOKEN
    yield
    settings.VA_INTEGRATION_TOKEN = old


def test_off_when_no_token_is_configured():
    with pytest.raises(HTTPException) as e:
        call(configured="")
    assert e.value.status_code == 404


def test_good_request_passes():
    assert call() is None


def test_wrong_token_is_refused():
    with pytest.raises(HTTPException) as e:
        call(token_header="Bearer nope")
    assert e.value.status_code == 403


def test_old_timestamp_is_refused_even_with_a_valid_signature():
    old = str(int(time.time()) - 3600)
    with pytest.raises(HTTPException) as e:
        call(ts=old)
    assert e.value.status_code == 403


def test_signature_is_bound_to_method_and_path():
    ts = str(int(time.time()))
    for method, path in (("POST", "/api/v1/integration/devices"), ("GET", "/api/v1/integration/pair-code")):
        with pytest.raises(HTTPException):
            call(ts=ts, sig=integ.expected_signature(TOKEN, ts, method, path))
    with pytest.raises(HTTPException):
        call(sig="0" * 64)
