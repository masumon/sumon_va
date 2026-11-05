"""Product / service draft from a web link (supplier or maker page).

Safety: only public http(s) hosts — every hop of a redirect is re-checked and
private, loopback, link-local and reserved addresses are refused (no SSRF).
Pages are capped in size and time. Nothing is saved; the admin reviews it.
"""
from __future__ import annotations

import html
import ipaddress
import json
import re
import socket
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

MAX_BYTES = 1_500_000
TIMEOUT = httpx.Timeout(12.0, connect=6.0)
UA = "Mozilla/5.0 (compatible; ABO-Enterprise-admin/1.0; +https://www.aboenterprise.com)"


class LinkError(Exception):
    """Bangla message for the admin."""


def _check_host(url: str) -> None:
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise LinkError("শুধু http/https ওয়েব লিংক দেওয়া যাবে।")
    if u.port not in (None, 80, 443):
        raise LinkError("এই লিংকটি খোলা যাবে না।")
    try:
        infos = socket.getaddrinfo(u.hostname, None)
    except OSError as exc:
        raise LinkError("ওয়েবসাইটটি খুঁজে পাওয়া যায়নি — লিংকটি ঠিক আছে কিনা দেখুন।") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise LinkError("এই লিংকটি খোলা যাবে না (ভেতরের/প্রাইভেট ঠিকানা)।")


async def fetch_page(url: str) -> tuple[str, str]:
    """(final_url, html). Follows at most 4 redirects, re-checking each host."""
    url = url.strip()
    if url.startswith("www."):
        url = "https://" + url
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": UA, "Accept": "text/html,*/*;q=0.5"}) as client:
        for _ in range(5):
            _check_host(url)
            async with client.stream("GET", url) as r:
                if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                    url = urljoin(url, r.headers["location"])
                    continue
                if r.status_code >= 400:
                    raise LinkError(f"পাতাটি খোলা যায়নি (কোড {r.status_code})।")
                ctype = r.headers.get("content-type", "")
                if "html" not in ctype and "xml" not in ctype:
                    raise LinkError("লিংকটি কোনো ওয়েব পাতা নয় (ছবি/ফাইল)।")
                buf = bytearray()
                async for chunk in r.aiter_bytes():
                    buf.extend(chunk)
                    if len(buf) > MAX_BYTES:
                        break
                return url, buf.decode(r.encoding or "utf-8", errors="replace")
    raise LinkError("অনেকবার অন্য পাতায় পাঠাচ্ছে — অন্য লিংক দিন।")


def _meta(page: str, *names: str) -> str:
    for n in names:
        m = re.search(r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]*content=["\']([^"\']+)' % re.escape(n), page, re.I) \
            or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']%s["\']' % re.escape(n), page, re.I)
        if m:
            return html.unescape(m.group(1)).strip()
    return ""


def _jsonld_product(page: str) -> dict[str, Any]:
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', page, re.S | re.I):
        try:
            data = json.loads(block.strip())
        except ValueError:
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        for it in items:
            if isinstance(it, dict) and "product" in str(it.get("@type", "")).lower():
                return it
    return {}


def extract(final_url: str, page: str) -> dict[str, Any]:
    """Facts from the page: title, description, image, price, brand, text."""
    prod = _jsonld_product(page)
    title = _meta(page, "og:title", "twitter:title") or (re.search(r"<title[^>]*>(.*?)</title>", page, re.S | re.I) or [None, ""])[1]
    offers = prod.get("offers") or {}
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    image = prod.get("image") or _meta(page, "og:image", "twitter:image")
    if isinstance(image, list):
        image = image[0] if image else ""
    if isinstance(image, dict):
        image = image.get("url", "")
    brand = prod.get("brand") or ""
    if isinstance(brand, dict):
        brand = brand.get("name", "")
    body = re.sub(r"<(script|style|noscript|svg|header|footer|nav)[^>]*>.*?</\1>", " ", page, flags=re.S | re.I)
    body = html.unescape(re.sub(r"<[^>]+>", " ", body))
    body = re.sub(r"\s+", " ", body).strip()
    price = offers.get("price") if isinstance(offers, dict) else None
    return {
        "url": final_url,
        "title": html.unescape(str(prod.get("name") or title or "")).strip()[:200],
        "description": html.unescape(str(prod.get("description") or _meta(page, "og:description", "description"))).strip()[:1500],
        "image_url": urljoin(final_url, str(image)) if image else "",
        "price": str(price) if price not in (None, "") else "",
        "currency": str(offers.get("priceCurrency", "")) if isinstance(offers, dict) else "",
        "brand": str(brand)[:80],
        "text": body[:4000],
    }


LINK_SYSTEM = (
    "You prepare catalogue drafts for ABO Enterprise, a shop in Beanibazar, Sylhet, Bangladesh. "
    "From the FACTS of a web page, write a {kind} draft. Use only what the facts support — never invent "
    "specifications, warranty or prices. Bangla: natural, polite (আপনি), standard spelling; English: clear. "
    "Description: 2-4 short paragraphs or bullet lines starting with '• '. Specs: only clear facts (model, power, "
    "ports, size, colour…), max 12. Tags: 5-10 short search words (Bangla and English). "
    'Reply as JSON: {{"name_bn": "", "name_en": "", "short_bn": "", "short_en": "", "description_bn": "", '
    '"description_en": "", "brand": "", "specs": {{"key": "value"}}, "tags": [""]}}'
)


def normalize_draft(raw: Any, facts: dict[str, Any]) -> dict[str, Any]:
    d = raw if isinstance(raw, dict) else {}
    s = lambda k, n=2000: str(d.get(k) or "").strip()[:n]  # noqa: E731
    specs = d.get("specs") if isinstance(d.get("specs"), dict) else {}
    tags = [str(t).strip()[:40] for t in (d.get("tags") or []) if str(t).strip()][:12]
    return {
        "name_bn": s("name_bn", 200), "name_en": s("name_en", 200) or facts["title"],
        "short_bn": s("short_bn", 300), "short_en": s("short_en", 300),
        "description_bn": s("description_bn"), "description_en": s("description_en") or facts["description"],
        "brand": s("brand", 80) or facts["brand"],
        "specs": {str(k).strip()[:60]: str(v).strip()[:120] for k, v in list(specs.items())[:12] if str(k).strip() and str(v).strip()},
        "tags": tags,
        "image_url": facts["image_url"], "source_price": facts["price"], "source_currency": facts["currency"],
        "source_url": facts["url"],
    }
