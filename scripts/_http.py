"""Shared HTTP-fetch helper with retry-and-backoff.

Used by the static (non-Playwright) per-day fetchers — fetch_rocket,
fetch_mnd_state, fetch_nerdwallet_state. Each used to do a single
urllib.request.urlopen with no retry; a transient network blip or SSL
handshake timeout (we observed `TimeoutError: read operation timed out`
on a scheduled 06:30 UTC run on 2026-06-03) was enough to lose today's
row for that state. This module wraps that single call in the same
3-attempt retry pattern fetch_bankrate_state.py uses for the Playwright
side, so transient failures stop costing us data points.
"""
from __future__ import annotations
import socket
import sys
import time
import urllib.error
import urllib.request

# 3 attempts total: initial, +4s sleep, retry, +12s sleep, final retry.
RETRY_BACKOFFS_S: list[int] = [4, 12]

# Caught broadly so any transient transport failure (DNS hiccup, TCP RST,
# slow SSL handshake, IPv6 fallback timeout) triggers a retry rather than
# bubbling up.
_TRANSIENT_EXCEPTIONS: tuple[type[BaseException], ...] = (
    urllib.error.HTTPError,
    urllib.error.URLError,
    TimeoutError,
    socket.timeout,
    ConnectionError,
    OSError,
)


def fetch_html(
    url: str,
    headers: dict[str, str],
    timeout: int = 30,
    log_prefix: str = "  ",
) -> str | None:
    """Retry-with-backoff HTTP GET. Returns the decoded body or None when
    every attempt fails. Per-attempt failures are written to stderr so
    GitHub Actions surfaces them inline; success returns silently.
    """
    last_err: BaseException | None = None
    for attempt in range(len(RETRY_BACKOFFS_S) + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", errors="ignore")
        except _TRANSIENT_EXCEPTIONS as e:
            last_err = e
            print(
                f"{log_prefix}attempt {attempt + 1}/{len(RETRY_BACKOFFS_S) + 1} "
                f"failed for {url}: {e}",
                file=sys.stderr,
            )
            if attempt < len(RETRY_BACKOFFS_S):
                time.sleep(RETRY_BACKOFFS_S[attempt])
    if last_err is not None:
        print(
            f"{log_prefix}giving up after {len(RETRY_BACKOFFS_S) + 1} attempts: {last_err}",
            file=sys.stderr,
        )
    return None
