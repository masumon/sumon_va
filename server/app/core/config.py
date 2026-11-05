from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AliasChoices, Field, field_validator


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "ABO Enterprise API"
    APP_ENV: str = "development"
    DEBUG: bool = False
    STARTUP_BOOTSTRAP_ENABLED: bool = False
    SECRET_KEY: str
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    DATABASE_URL: str

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def fix_database_url(cls, v: str) -> str:
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql+asyncpg://", 1)
        return v
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""

    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""

    ADMIN_EMAIL: str = "admin@aboenterprise.com"
    # ABO integration (read-only, off unless both are set): see docs/TRANSFER.md
    ABO_API_BASE: str = ""
    ABO_INTEGRATION_TOKEN: str = ""
    VA_INTEGRATION_TOKEN: str = ""  # token the ABO admin tab uses to call THIS server
    ADMIN_PASSWORD: str = ""

    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    WHATSAPP_NUMBER: str = "8801885411007"
    BUSINESS_EMAIL: str = "info@aboenterprise.com"

    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    # Accept either SMTP_USER or SMTP_USERNAME from the environment.
    SMTP_USER: str = Field(
        default="", validation_alias=AliasChoices("SMTP_USER", "SMTP_USERNAME")
    )
    SMTP_PASSWORD: str = ""
    # From address falls back to the login user when not set separately.
    # Also accepts EMAIL_FROM (Resend-style env) so the sender is a verified
    # domain address, not the gmail BUSINESS_EMAIL (Resend rejects gmail.com).
    SMTP_FROM: str = Field(
        default="",
        validation_alias=AliasChoices("SMTP_FROM", "SMTP_FROM_EMAIL", "EMAIL_FROM"),
    )
    SMTP_TLS: bool = True
    EMAIL_SENDER_NAME: str = Field(
        default="ABO Enterprise",
        validation_alias=AliasChoices("EMAIL_SENDER_NAME", "EMAIL_FROM_NAME", "FROM_NAME"),
    )
    # Optional Reply-To (Resend supports it); e.g. info@aboenterprise.com.
    EMAIL_REPLY_TO: str = ""
    ADMIN_NOTIFY_EMAIL: str = ""

    # Unified inbox - Telegram. All optional: leave empty and the channel stays off.
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_WEBHOOK_SECRET: str = ""
    EMAIL_INBOUND_SECRET: str = ""   # shared secret the Cloudflare Email Worker sends; owner sets it on Render and in the Worker
    EMAIL_IMAP_USER: str = ""        # the mailbox to read (e.g. a Gmail address); with an APP PASSWORD, never the real one
    EMAIL_IMAP_PASSWORD: str = ""
    EMAIL_IMAP_HOST: str = ""         # default imap.gmail.com
    TELEGRAM_OWNER_ID: str = ""   # the owner's own Telegram user id; only this id may command the bot

    # Email provider selection: smtp, resend, sendgrid, mailgun, ses
    EMAIL_PROVIDER: str = "smtp"
    RESEND_API_KEY: str = ""

    ADMIN_NAME: str = "Admin"

    # bKash gateway (optional — only needed if bKash API integration is active)
    BKASH_APP_KEY: str = ""
    BKASH_APP_SECRET: str = ""
    BKASH_USERNAME: str = ""
    BKASH_PASSWORD: str = ""
    BKASH_API_URL: str = "https://tokenized.sandbox.bka.sh/v1.2.0-beta"
    BKASH_CALLBACK_URL: str = ""

    # Nagad gateway (optional)
    NAGAD_MERCHANT_ID: str = ""
    NAGAD_MERCHANT_KEY: str = ""
    NAGAD_API_URL: str = "https://sandbox.mynagad.com:10080/remote-payment-gateway-1.0"
    NAGAD_CALLBACK_URL: str = ""
    NAGAD_MERCHANT_NUMBER: str = ""

    # SSLCommerz (optional)
    SSLCOMMERZ_STORE_ID: str = ""
    SSLCOMMERZ_STORE_PASSWORD: str = ""
    SSLCOMMERZ_IS_SANDBOX: bool = True

    # SMS OTP (optional — GreenWeb / BulkSMS)
    SMS_API_URL: str = ""
    SMS_API_KEY: str = ""

    # GA4 Data API (optional — admin Visitor Analytics tab)
    GA4_PROPERTY_ID: str = ""
    GA4_CLIENT_EMAIL: str = ""
    GA4_PRIVATE_KEY: str = ""

    # Frontend URL for payment callbacks
    FRONTEND_URL: str = "https://www.aboenterprise.com"

    # The phone app's own passkey (fingerprint / face). Bound to the API host because the website's apex redirects
    # (Android's Digital Asset Links check forbids redirects). Origins are the app's signing-key hashes.
    DEVICE_PASSKEY_RP_ID: str = "api.aboenterprise.com"
    DEVICE_PASSKEY_ANDROID_ORIGINS: str = (
        "android:apk-key-hash:VglfD6xy-PHcy-twYsPuAF6lG2mA9qK2ifNTpt-WOLo,"
        "android:apk-key-hash:sHl9FIQ4MIOr0wW0ZUvGBsv2QfVa_dBB9lk9GDJds5I"
    )

    @property
    def device_passkey_origins(self) -> list[str]:
        return [o.strip() for o in self.DEVICE_PASSKEY_ANDROID_ORIGINS.split(",") if o.strip()]

    # Offer notifications (Web Push). Generate once with: python scripts/generate_vapid_keys.py
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_SUBJECT: str = "mailto:info@aboenterprise.com"

    # Separate admin site, e.g. https://admin.aboenterprise.com. Empty = admin stays on the main site
    # (/sumon) exactly as before; setting it switches on the admin origin for CORS, passkeys, e-mail links
    # and Google-Drive backup redirects.
    ADMIN_URL: str = ""

    # Sumon's personal site, e.g. https://sumon.aboenterprise.com (only the WhatsApp assistant). Empty = off.
    # Setting it adds that origin to CORS and passkeys, exactly like ADMIN_URL.
    PERSONAL_URL: str = ""

    # Optional: a GitHub token limited to this repo with "Actions: read & write". When set, the admin's GitHub-backup
    # switch also disables/enables the scheduled workflow itself, so an OFF switch means no run starts at all
    # (otherwise GitHub still starts the run every night and the workflow only skips itself). Empty = manual.
    GITHUB_ACTIONS_TOKEN: str = ""

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def admin_base_url(self) -> str:
        """Validated admin site URL without trailing slash, or "" (feature off). Only https (or local http)."""
        url = (self.ADMIN_URL or "").strip().rstrip("/")
        if url.startswith("https://") or url.startswith("http://localhost"):
            return url
        return ""

    @property
    def personal_base_url(self) -> str:
        """Validated personal-site URL without trailing slash, or "" (feature off). Only https (or local http)."""
        url = (self.PERSONAL_URL or "").strip().rstrip("/")
        if url.startswith("https://") or url.startswith("http://localhost"):
            return url
        return ""

    @property
    def cors_origins(self) -> list[str]:
        """Allowed browser origins: ALLOWED_ORIGINS plus the admin site when it is configured."""
        origins = self.allowed_origins_list
        extra = [u for u in (self.admin_base_url, self.personal_base_url) if u and u not in origins]
        return [*origins, *extra]


settings = Settings()  # type: ignore[call-arg]
