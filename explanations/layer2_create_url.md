# Layer 2 — create_url Lambda

## What this layer does and why it exists

This Lambda handles URL creation. It receives a POST request from API Gateway containing a long URL, generates a short alias using the hashing module, writes the mapping to DynamoDB, and returns the short URL to the caller.

---

## What AWS Lambda is

Lambda is AWS's serverless compute service. You write a function, upload it, and AWS runs it — you never touch a server. Lambda only runs when triggered (e.g., an HTTP request arrives at API Gateway), and you pay only for the milliseconds it actually executes.

Every Lambda function has this signature:

```python
def handler(event, context):
```

- **`event`** — a Python dict containing everything about the incoming request: HTTP method, path, headers, query params, body. The shape depends on what triggered the Lambda.
- **`context`** — metadata about the Lambda execution itself (function name, remaining time, request ID). Not used here.

---

## What API Gateway is and how it passes requests to Lambda

API Gateway sits in front of Lambda and translates HTTP requests into Lambda events. When someone does:

```
POST /create
{"long_url": "https://example.com/very/long/path"}
```

API Gateway turns that into a Lambda `event` dict where `event['body']` is the JSON string `'{"long_url": "https://example.com/very/long/path"}'`. It is a string, not a dict — the handler must call `json.loads(event['body'])` to parse it.

The handler returns a dict with `statusCode`, `headers`, and `body`. API Gateway converts that back into an HTTP response.

---

## What DynamoDB is

DynamoDB is AWS's managed NoSQL key-value database. No servers to manage, scales automatically.

Key concepts:
- **Table** — like a database table but schemaless (each item can have different attributes)
- **Partition key** — the primary key. Every item must have one. Ours is `alias` (e.g. `"aB3kZp"`).
- **put_item** — writes one item. If an item with the same partition key already exists, it overwrites it. (Collision is astronomically unlikely with 56 billion possible aliases.)
- **PAY_PER_REQUEST billing** — pay per read/write, no minimum. Right-sized for variable load.

---

## Why boto3 is initialized at module level

When Lambda starts for the first time, it runs all module-level code (imports, `boto3.resource(...)`, `dynamodb.Table(...)`). This is a **cold start**. After that, the same container is reused for subsequent requests — only `handler()` runs. This is a **warm start**.

By initializing boto3 at module level, we pay the connection cost once per container lifecycle, not once per request. Putting it inside `handler()` would re-establish the client on every single invocation.

---

## What mocking is and why we mock AWS

The tests must not call real AWS — that would require valid credentials, a real DynamoDB table, and would cost money. We use `unittest.mock.patch` to replace boto3's real behavior with a fake we control.

When `@patch('handler.boto3.resource')` is applied, boto3 never connects to AWS. The test receives a `MagicMock` object that records all calls made on it, allowing assertions like: "was `put_item` called with the right alias?"

---

## What the 4 tests verify

| Test | What it checks |
|---|---|
| Valid input → 200 | Happy path — short_url present in response body |
| Missing `long_url` → 400 | Body parses but required field is absent |
| `generate_alias` returns error → 400 | Bad URL propagates the error correctly |
| DynamoDB raises exception → 500 | AWS failure is caught and returns a clean 500 |

---

## Files created

- `backend/lambdas/create_url/handler.py`
- `tests/test_create_url.py`

## Validation

```bash
uv add boto3
uv run pytest tests/test_create_url.py -v
```

Expected: 4 passed.
