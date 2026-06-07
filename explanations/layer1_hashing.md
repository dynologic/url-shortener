# Layer 1 — Hashing Module

## What this layer does and why it exists

Every time someone submits a long URL, we need to generate a short, unique alias — something like `aB3kZp`. The hashing module is the single function responsible for that transformation. It lives in `backend/shared/` (not inside either Lambda) so it can be tested in complete isolation from AWS.

---

## What SHA-256 is

SHA-256 is a cryptographic hash function. You feed it any string and it produces a fixed 32-byte output. The properties we care about:

- **Deterministic:** same input always produces the same output
- **Avalanche effect:** changing one character in the input completely changes the output
- **One-way:** you cannot reverse the output back to the input

We use `.digest()` (raw bytes) rather than `.hexdigest()` (hex string) because the next step — base62 encoding — operates on raw bytes and produces a denser, shorter output.

---

## What base62 encoding is

After hashing, we have 32 raw bytes. We need to turn that into a short, URL-safe string. Base62 uses the character set `[0-9A-Za-z]` — 62 characters. Every character is safe in a URL with no escaping needed.

With 6 base62 characters you get 62^6 = **56 billion** possible aliases. At 3,000 creations per day, you would need ~50,000 years to exhaust the space.

---

## Why we include epoch time in the hash key

The requirement says: *"Multiple short URLs can point to the same long URL."* If you submit `https://example.com` twice, you should get two different short aliases.

If we only hashed the URL itself, `https://example.com` would always produce the same alias. By concatenating `url + epoch_time` before hashing, two submissions of the same URL at different seconds produce different hashes and therefore different aliases. This is intentional.

---

## The two functions

**`is_valid_url_syntax(url)`**
Validates that a URL has both a scheme (`https://`) and a netloc (`example.com`). Returns a bool. Uses `urlparse` from the standard library.

**`generate_alias(original_url, epoch_time)`**
- Validates inputs (empty URL, epoch <= 0, invalid syntax) — returns `("", "Invalid Input Data")` on failure
- Strips trailing slash so `https://a.com/` and `https://a.com` produce the same alias
- Concatenates `url + epoch_time`, SHA-256 hashes it, base62-encodes it
- Returns first 6 characters (configurable via `ALIAS_LENGTH` env var) + `"Success"`

---

## What the 7 tests verify

| Test | What it checks |
|---|---|
| `test_valid_url_returns_alias` | Happy path — 6-char alphanumeric alias returned |
| `test_same_url_same_epoch_deterministic` | No random element — same inputs always give same output |
| `test_same_url_diff_epoch_different_alias` | Epoch is actually affecting the hash |
| `test_trailing_slash_same_as_no_slash` | Slash stripping works — same logical URL, same alias |
| `test_empty_url_returns_error` | Empty string rejected cleanly |
| `test_invalid_url_no_scheme_returns_error` | `"confluence/page"` is not a valid URL |
| `test_epoch_zero_returns_error` | Zero is not a valid timestamp |

---

## Files created

- `backend/shared/hashing.py`
- `tests/test_hashing.py`

## Validation

```bash
uv run pytest tests/test_hashing.py -v
```

Expected: 7 passed.

---

## Note on the package name

The PRD references `base62` but the actual PyPI package is `pybase62`. It installs its module as `base62.py`, so `import base62` works correctly. The dependency in `pyproject.toml` is `pybase62`.
