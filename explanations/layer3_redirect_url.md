# Layer 3 — redirect_url Lambda

## What this layer does and why it exists

This Lambda handles the redirect. When someone visits a short URL (e.g. `https://short.ly/aB3kZp`), API Gateway extracts the alias from the path and passes it to this Lambda. The Lambda looks up the original URL and returns a 301 redirect so the browser goes to the right place — ideally in under 500ms.

---

## The cache-aside pattern

Cache-aside means: check the cache first, and only go to the database if the cache doesn't have the answer.

```
Request → Lambda → Redis (cache)
                     ↓ miss
                  DynamoDB (source of truth)
                     ↓ found
                  write back to Redis for next time
                     ↓
                  Return redirect
```

On a cache **hit**: we never touch DynamoDB. Redis responds in ~1ms. Fast.
On a cache **miss**: we query DynamoDB (~10–20ms), then write the result into Redis so the *next* request for the same alias is a hit.

This matters because at 10,000 redirects/day, popular aliases get hit repeatedly. Without caching, every redirect would hit DynamoDB. With caching, only the first request for each alias is slow.

---

## What Redis is

Redis is an in-memory key-value store. Everything lives in RAM, which is why it is so fast (~1ms responses vs ~10ms for DynamoDB).

Key concepts:
- **key/value:** we store `alias → long_url` (e.g. `"aB3kZp" → "https://example.com/very/long/path"`)
- **TTL (Time To Live):** each key has an expiry time in seconds. After that time, Redis automatically deletes the key. We use 3600 seconds (1 hour) by default. This prevents the cache from holding stale data forever and keeps memory usage bounded.
- **decode_responses=True:** Redis stores bytes by default. This flag makes the client return Python strings instead, so we do not need to manually decode every response.

---

## What ElastiCache is

ElastiCache is AWS's managed Redis service. You do not install or maintain Redis yourself — AWS runs it inside your VPC. The Lambda connects to it using the Redis client pointing at the ElastiCache endpoint (a hostname like `my-cluster.abc123.ng.0001.use1.cache.amazonaws.com`).

Because ElastiCache runs inside a VPC (private network), the Lambda must also be inside the same VPC to reach it. This is why both are placed in the private subnet in the CDK stack.

---

## Why 301 and what the Location header does

HTTP status code 301 means "Moved Permanently". The browser receives the response, sees the `Location` header containing the original URL, and immediately navigates there. The user never sees the short URL page — the redirect is transparent.

301 also tells browsers and CDNs to cache the redirect, which further reduces load. (302 would be "Moved Temporarily" and would not be cached by browsers.)

---

## What the X-Cache header is for

`X-Cache: HIT` or `X-Cache: MISS` is a custom response header we add to every redirect. It is not used by the browser for the redirect itself — it is purely informational.

The React frontend's load simulator reads this header from each response and uses it to power the live cache hit/miss chart. It is also useful for debugging: you can watch requests in the browser dev tools and see which ones are hitting Redis vs going all the way to DynamoDB.

---

## Why Redis and DynamoDB are both needed

| | Redis | DynamoDB |
|---|---|---|
| Speed | ~1ms | ~10–20ms |
| Durability | In-memory, data lost on restart | Persistent, never loses data |
| Cost | Fixed hourly cost | Pay per read/write |
| Purpose | Speed up hot aliases | Store all aliases permanently |

Redis alone is not enough — if the ElastiCache node restarts, all cached data is gone. DynamoDB is the source of truth. Redis is just a fast layer in front of it.

DynamoDB alone would work, but redirects could be slow under load since every request hits the database.

---

## What the 5 tests verify

| Test | What it checks |
|---|---|
| Redis hit → 301 with X-Cache: HIT | Happy path when alias is cached |
| Redis miss, DynamoDB hit → 301 with X-Cache: MISS | Cache miss flow + DynamoDB fallback |
| Redis miss, DynamoDB miss → 404 | Alias does not exist anywhere |
| Missing alias in path → 400 | No `alias` path parameter at all |
| Redis raises exception → 500 | Cache failure handled cleanly |

---

## Files created

- `backend/lambdas/redirect_url/handler.py`
- `tests/test_redirect_url.py`

## Validation

```bash
uv add redis
uv run pytest tests/test_redirect_url.py -v
```

Expected: 5 passed.
