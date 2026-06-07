import hashlib
import os
import base62
from urllib.parse import urlparse

ALIAS_LENGTH = int(os.environ.get('ALIAS_LENGTH', 6))


def is_valid_url_syntax(url: str) -> bool:
    """Return True only if url has both scheme and netloc."""
    try:
        parsed = urlparse(url)
        return bool(parsed.scheme and parsed.netloc)
    except ValueError:
        return False


def generate_alias(original_url: str, epoch_time: int) -> tuple[str, str]:
    """Return (alias, message) for the given url and epoch time."""
    if not original_url or epoch_time <= 0 or not is_valid_url_syntax(original_url):
        return ("", "Invalid Input Data")

    cleaned = original_url.rstrip('/')
    raw = hashlib.sha256((cleaned + str(epoch_time)).encode()).digest()
    alias = base62.encodebytes(raw)[:ALIAS_LENGTH]
    return (alias, "Success")
