"""Any AI key, any model: OpenAI-compatible APIs (OpenAI, OpenRouter, Groq,
DeepSeek, xAI, Mistral, Together, a self-hosted server …) and Anthropic Claude.
Google Gemini keeps its own path in ai_gemini.py.

The provider is detected from the key's prefix, or chosen by the admin.
Every call is plain HTTPS with a timeout; errors raise httpx.HTTPStatusError
or a network exception for the caller to handle (it never crashes the site).
"""
from __future__ import annotations

import base64
import re
from typing import Any

import httpx

# id → label, kind, default base URL, preferred models (cheap/fast first).
PROVIDERS: dict[str, dict[str, Any]] = {
    "gemini": {"label": "Google Gemini", "kind": "gemini", "base": "", "models": ()},
    "openai": {"label": "OpenAI (ChatGPT)", "kind": "openai", "base": "https://api.openai.com/v1",
               "models": ("gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini", "gpt-5", "gpt-4o")},
    "anthropic": {"label": "Anthropic Claude", "kind": "anthropic", "base": "https://api.anthropic.com/v1",
                  "models": ("claude-haiku-5-5", "claude-sonnet-5-5", "claude-haiku-4-5", "claude-sonnet-4-5")},
    "openrouter": {"label": "OpenRouter", "kind": "openai", "base": "https://openrouter.ai/api/v1",
                   "models": ("openrouter/auto", "google/gemini-2.5-flash", "openai/gpt-4o-mini")},
    "groq": {"label": "Groq", "kind": "openai", "base": "https://api.groq.com/openai/v1",
             "models": ("llama-3.3-70b-versatile", "llama-3.1-8b-instant")},
    "deepseek": {"label": "DeepSeek", "kind": "openai", "base": "https://api.deepseek.com/v1", "models": ("deepseek-chat",)},
    "xai": {"label": "xAI Grok", "kind": "openai", "base": "https://api.x.ai/v1", "models": ("grok-4-fast", "grok-3-mini")},
    "mistral": {"label": "Mistral", "kind": "openai", "base": "https://api.mistral.ai/v1", "models": ("mistral-small-latest", "mistral-large-latest")},
    "nvidia": {"label": "NVIDIA", "kind": "openai", "base": "https://integrate.api.nvidia.com/v1",
               "models": ("meta/llama-3.3-70b-instruct", "qwen/qwen3-235b-a22b", "google/gemma-3-27b-it")},
    "cloudflare": {"label": "Cloudflare Workers AI", "kind": "openai", "base": "",
                   "models": ("@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/google/gemma-3-12b-it", "@cf/qwen/qwen3-30b-a3b-fp8")},
    "vercel": {"label": "Vercel AI Gateway", "kind": "openai", "base": "https://ai-gateway.vercel.sh/v1",
               "models": ("google/gemini-2.5-flash", "openai/gpt-4o-mini", "meta/llama-3.3-70b")},
    "local": {"label": "নিজের কম্পিউটার (Ollama/LM Studio)", "kind": "openai", "base": "", "models": ()},
    "custom": {"label": "অন্য (OpenAI-সামঞ্জস্যপূর্ণ)", "kind": "openai", "base": "", "models": ()},
}


def detect(key: str) -> str:
    """Best guess of the provider from the key's shape."""
    k = (key or "").strip()
    if k.startswith(("AIza", "AQ.")):
        return "gemini"
    if k.startswith("sk-ant-"):
        return "anthropic"
    if k.startswith("sk-or-"):
        return "openrouter"
    if k.startswith("gsk_"):
        return "groq"
    if k.startswith("xai-"):
        return "xai"
    if k.startswith("sk-"):
        return "openai"
    return "custom"


def kind_of(provider: str) -> str:
    return PROVIDERS.get(provider, PROVIDERS["custom"])["kind"]


def base_of(provider: str, base_url: str = "") -> str:
    return (base_url or PROVIDERS.get(provider, {}).get("base") or "").rstrip("/")


def _openai_headers(key: str) -> dict:
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json",
            "HTTP-Referer": "https://www.aboenterprise.com", "X-Title": "ABO Enterprise Admin"}


def _anthropic_headers(key: str) -> dict:
    return {"x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}


async def list_models(client: httpx.AsyncClient, provider: str, key: str, base_url: str = "") -> list[str]:
    """Model ids the key can use (best effort; empty when listing is not offered)."""
    try:
        if kind_of(provider) == "anthropic":
            r = await client.get(f"{base_of(provider, base_url)}/models", headers=_anthropic_headers(key))
        else:
            r = await client.get(f"{base_of(provider, base_url)}/models", headers=_openai_headers(key))
        if r.status_code != 200:
            return []
        data = r.json()
        items = data.get("data", data if isinstance(data, list) else [])
        return [str(m.get("id")) for m in items if isinstance(m, dict) and m.get("id")]
    except Exception:  # noqa: BLE001
        return []


def _pick(listed: list[str], preferred: tuple[str, ...]) -> list[str]:
    """Preferred models that exist first, then other chat-looking listed ones."""
    chat = [m for m in listed if not re.search(r"embed|whisper|tts|audio|image|dall|moderation|realtime|transcribe|search|vision-preview", m, re.I)]
    first = [m for m in preferred if not listed or m in listed]
    return list(dict.fromkeys([*first, *chat[:5]]))[:8]


async def generate(provider: str, key: str, model: str, system: str, user: str, *, base_url: str = "",
                   max_tokens: int = 2048, json_mode: bool = False, images: list[tuple[str, bytes]] | None = None,
                   timeout: float = 90.0) -> str:
    """One chat completion → reply text."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=10.0)) as client:
        return await _generate(client, provider, key, model, system, user, base_url=base_url,
                               max_tokens=max_tokens, json_mode=json_mode, images=images)


async def _generate(client: httpx.AsyncClient, provider: str, key: str, model: str, system: str, user: str, *,
                    base_url: str = "", max_tokens: int = 2048, json_mode: bool = False,
                    images: list[tuple[str, bytes]] | None = None) -> str:
    base = base_of(provider, base_url)
    if kind_of(provider) == "anthropic":
        content: list[dict] = [{"type": "text", "text": user}]
        for mime, data in images or []:
            content.append({"type": "image", "source": {"type": "base64", "media_type": mime, "data": base64.b64encode(data).decode("ascii")}})
        sys_text = system + ("\nReply with JSON only." if json_mode else "")
        r = await client.post(f"{base}/messages", headers=_anthropic_headers(key), json={
            "model": model, "max_tokens": max_tokens, "temperature": 0.2, "system": sys_text,
            "messages": [{"role": "user", "content": content}],
        })
        if r.status_code != 200:
            raise httpx.HTTPStatusError("generate", request=r.request, response=r)
        return "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text").strip()

    # OpenAI-compatible
    user_content: Any = user
    if images:
        user_content = [{"type": "text", "text": user}] + [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"}}
            for mime, data in images
        ]
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_content}],
        "max_tokens": max_tokens, "temperature": 0.2,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    r = await client.post(f"{base}/chat/completions", headers=_openai_headers(key), json=body)
    if r.status_code == 400 and json_mode:  # some servers lack JSON mode / max_tokens name
        body.pop("response_format", None)
        r = await client.post(f"{base}/chat/completions", headers=_openai_headers(key), json=body)
    if r.status_code == 400 and "max_tokens" in r.text:
        body["max_completion_tokens"] = body.pop("max_tokens")
        body.pop("temperature", None)
        r = await client.post(f"{base}/chat/completions", headers=_openai_headers(key), json=body)
    if r.status_code != 200:
        raise httpx.HTTPStatusError("generate", request=r.request, response=r)
    msg = ((r.json().get("choices") or [{}])[0].get("message") or {})
    content = msg.get("content")
    if isinstance(content, list):
        content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return str(content or "").strip()


def reason(exc: httpx.HTTPStatusError) -> str:
    try:
        err = exc.response.json().get("error")
        if isinstance(err, dict):
            return str(err.get("message") or "")[:160]
        return str(err or "")[:160]
    except Exception:  # noqa: BLE001
        return ""


async def find_model(provider: str, key: str, base_url: str = "", model: str = "") -> tuple[str, str]:
    """(working model, "") or ("", Bangla error). Tries the given model first."""
    if not base_of(provider, base_url):
        return "", "এই প্রদানকারীর জন্য API ঠিকানা (Base URL) দিন।"
    last: httpx.HTTPStatusError | None = None
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=8.0)) as client:
        listed = [] if model else await list_models(client, provider, key, base_url)
        candidates = [model] if model else _pick(listed, PROVIDERS.get(provider, {}).get("models", ()))
        for cand in candidates:
            try:
                await _generate(client, provider, key, cand, "Reply with the single word OK.", "Say OK", base_url=base_url, max_tokens=64)
                return cand, ""
            except httpx.HTTPStatusError as exc:
                last = exc
                if exc.response.status_code in (401, 403):
                    break
                if exc.response.status_code == 429:
                    return cand, ""  # key works, just rate-limited right now
                continue
    if last is not None:
        code = last.response.status_code
        why = reason(last)
        if code in (401, 403):
            return "", f"কী সঠিক নয় বা অনুমতি নেই ({why or code})।"
        if code == 402:
            return "", f"এই অ্যাকাউন্টে ব্যালান্স/ক্রেডিট নেই ({why or code})।"
        return "", f"কোনো মডেল কাজ করেনি — মডেলের নাম লিখে আবার চেষ্টা করুন ({why or code})।"
    return "", "কোনো মডেল পাওয়া যায়নি — মডেলের নাম লিখে আবার চেষ্টা করুন।"
