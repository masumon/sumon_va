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


def client_ip(request: Request) -> str:
    """Real client IP. All public traffic arrives through Cloudflare, which sets
    CF-Connecting-IP itself (a visitor cannot forge it), so it wins; then the
    first X-Forwarded-For hop (Render's proxy), then the socket address."""
    cf = _valid_ip(request.headers.get("cf-connecting-ip"))
    if cf:
        return cf
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = _valid_ip(forwarded.split(",")[0])
        if first:
            return first
    return request.client.host if request.client else "unknown"


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
