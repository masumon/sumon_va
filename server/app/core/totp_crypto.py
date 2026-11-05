"""At-rest encryption for AdminUser.totp_secret.

Uses Fernet (symmetric AES-128-CBC + HMAC) keyed from a SHA-256 derivation of
SECRET_KEY, so no new secret needs to be provisioned. decrypt_totp_secret()
falls back to returning the raw value when it isn't a valid Fernet token —
this keeps pre-existing plaintext secrets (written before this module
existed) working without a data migration; they are transparently
re-encrypted the next time the user goes through setup/enable.
"""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


def _fernet() -> Fernet:
    key = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_totp_secret(plain_secret: str) -> str:
    return _fernet().encrypt(plain_secret.encode("utf-8")).decode("utf-8")


def decrypt_totp_secret(stored_value: str) -> str:
    try:
        return _fernet().decrypt(stored_value.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        # Legacy plaintext secret written before encryption-at-rest was added.
        return stored_value
