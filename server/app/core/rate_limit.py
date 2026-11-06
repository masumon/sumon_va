from datetime import datetime, timedelta
from typing import Dict
from collections import defaultdict

from fastapi import HTTPException, Request, status

# In-memory limiter — correct for this deployment: Render runs a single
# uvicorn worker (render.yaml --workers 1), so one process sees all traffic.

_MAX_TRACKED_KEYS = 10_000


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: Dict[str, list[datetime]] = defaultdict(list)

    def _sweep(self) -> None:
        """Drop fully-expired keys so the dict can't grow without bound."""
        cutoff = datetime.utcnow() - timedelta(seconds=self.window_seconds)
        stale = [k for k, times in self.requests.items() if not times or times[-1] <= cutoff]
        for k in stale:
            self.requests.pop(k, None)

    def is_allowed(self, key: str) -> bool:
        now = datetime.utcnow()
        cutoff = now - timedelta(seconds=self.window_seconds)
        if len(self.requests) > _MAX_TRACKED_KEYS:
            self._sweep()
        self.requests[key] = [
            req_time for req_time in self.requests[key] if req_time > cutoff
        ]

        if len(self.requests[key]) < self.max_requests:
            self.requests[key].append(now)
            return True
        return False


def _valid_ip(value: str | None) -> str | None:
    import ipaddress

    try:
        return str(ipaddress.ip_address((value or "").strip()))
    except ValueError:
        return None


# Cloudflare's published edge ranges (cloudflare.com/ips). CF-Connecting-IP is believed only when the connection really came from one of them.
_CF_NETS = [
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
    "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22", "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32",
    "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
]


def _is_cloudflare(ip: str | None) -> bool:
    import ipaddress

    try:
        addr = ipaddress.ip_address(ip or "")
    except ValueError:
        return False
    return any(addr in ipaddress.ip_network(n) for n in _CF_NETS)


def client_ip(request: Request) -> str:
    """Real client IP that a visitor cannot forge.

    The last X-Forwarded-For hop is the address Render's own proxy saw (not forgeable). When that hop is a Cloudflare edge address,
    Cloudflare sat in front and CF-Connecting-IP is the real visitor. Otherwise the header is ignored, so someone calling the Render
    address directly cannot dodge a rate limit or a lock by inventing it."""
    forwarded = request.headers.get("x-forwarded-for") or ""
    hops = [h for h in (_valid_ip(x) for x in forwarded.split(",")) if h]
    peer = hops[-1] if hops else (request.client.host if request.client else None)
    if _is_cloudflare(peer):
        cf = _valid_ip(request.headers.get("cf-connecting-ip"))
        if cf:
            return cf
    return peer or "unknown"


def rate_limit(name: str, max_requests: int, window_seconds: int):
    """FastAPI dependency factory — per-IP rate limit for public endpoints.

    Usage: dependencies=[Depends(rate_limit("orders", 15, 600))]
    """
    limiter = RateLimiter(max_requests=max_requests, window_seconds=window_seconds)

    async def _dependency(request: Request) -> None:
        if not limiter.is_allowed(f"{name}:{client_ip(request)}"):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please wait a moment and try again.",
            )

    return _dependency


export_limiter = RateLimiter(max_requests=10, window_seconds=60)
