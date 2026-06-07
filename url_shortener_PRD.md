# URL Shortener — Product Requirements Document
**For use with Claude Code CLI**
**Author:** Arsalan (with Claude assist)
**Repo:** url-shortener

---

## Overview

Build a production-quality URL shortener for internal Capital One use. The system accepts a long URL, generates a short alias, stores it, and redirects users when the short URL is accessed. This is a real AWS deployment — not a demo.

---

## Repo Structure

```
url-shortener/
├── .env.example
├── README.md
├── architecture/
│   └── system_design.png        ← placeholder, will be added manually
├── backend/
│   ├── lambdas/
│   │   ├── create_url/
│   │   │   └── handler.py
│   │   └── redirect_url/
│   │       └── handler.py
│   └── shared/
│       └── hashing.py
├── infrastructure/
│   ├── app.py
│   └── stacks/
│       └── url_shortener_stack.py
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── components/
│       │   ├── UrlForm.jsx
│       │   ├── LoadSimulator.jsx
│       │   └── CacheChart.jsx
│       └── index.js
└── tests/
    ├── test_hashing.py
    ├── test_create_url.py
    └── test_redirect_url.py
```

---

## Environment Variables

All configuration via environment variables. Never hardcode values.

Create a `.env.example` file at the repo root with the following. The actual `.env` file is gitignored.

```
# Base domain for short URLs (e.g. https://api-id.execute-api.us-east-1.amazonaws.com/prod)
BASE_DOMAIN=

# DynamoDB table name
TABLE_NAME=

# Redis host (ElastiCache endpoint)
REDIS_HOST=

# Redis port (default 6379)
REDIS_PORT=6379

# Redis TTL in seconds for cached aliases (default 3600 = 1 hour)
REDIS_TTL=3600

# AWS region
AWS_REGION=us-east-1

# Short alias length in characters
ALIAS_LENGTH=6
```

---

## Functional Requirements

- Accept a long URL via POST, return a short alias URL
- Redirect to the original URL when the short alias is accessed via GET
- Multiple short URLs can point to the same long URL (no deduplication)
- No deletion — all URLs are permanent
- Internal use only (auth assumed to exist externally, not in scope)
- HTTPS only
- Sub 500ms response time for redirects
- Create response can take up to 1 second

---

## Non-Functional Requirements

- Region: us-east-1
- Scale: 3,000 URL creations/day, 10,000 redirects/day
- Highly available
- Cache-aside pattern for redirects (Redis first, DynamoDB fallback)
- One command deploy: `cdk deploy`

---

## Backend

### `backend/shared/hashing.py`

Two functions:

**`is_valid_url_syntax(url: str) -> bool`**
- Use `urlparse` from `urllib.parse`
- Return `True` only if both `scheme` and `netloc` are present
- Wrap in try/except ValueError

**`generate_alias(original_url: str, epoch_time: int) -> tuple[str, str]`**
- Returns `(alias, message)` tuple
- Validate: empty string URL, epoch_time <= 0, invalid URL syntax → return `("", "Invalid Input Data")`
- Strip trailing slash from URL before hashing: `original_url.rstrip('/')`
- Concatenate: `cleaned_url + str(epoch_time)`
- Hash with SHA-256 using `.digest()` (raw bytes, not hex)
- Base62-encode the digest using `base62.encodebytes()`
- Return first `ALIAS_LENGTH` characters (read from env var, default 6) + `"Success"`
- Same URL at different epoch times produces different aliases (intentional — multiple short URLs can point to same long URL)

**Imports needed:** `hashlib`, `base62`, `os`, `urllib.parse.urlparse`

---

### `backend/lambdas/create_url/handler.py`

Standard AWS Lambda handler. No FastAPI. No Flask.

**Module-level initialization (runs once on warm start):**
```python
import boto3, os, json, time
from dotenv import load_dotenv
import sys
sys.path.append('/var/task/shared')  # Lambda layer path for shared module
from hashing import generate_alias

load_dotenv()
BASE_DOMAIN = os.environ['BASE_DOMAIN']
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])
```

**Handler function: `handler(event, context)`**

1. Parse body: `body = json.loads(event['body'])`
2. Extract: `long_url = body.get('long_url')`
3. If `long_url` is None → return 400
4. `epoch_time = int(time.time())`
5. Call `alias, message = generate_alias(long_url, epoch_time)`
6. If message != "Success" → return 400 with message
7. Write to DynamoDB:
```python
table.put_item(Item={
    'alias': alias,
    'long_url': long_url,
    'created_at': epoch_time
})
```
8. Return 200:
```python
{
    "statusCode": 200,
    "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
    "body": json.dumps({"short_url": f"{BASE_DOMAIN}/{alias}", "message": "Success"})
}
```

**Error handling:** All exceptions caught with `except Exception as e` → return 500 with error message string.

**Return format for all responses:**
```python
{
    "statusCode": <int>,
    "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
    "body": json.dumps({...})
}
```

---

### `backend/lambdas/redirect_url/handler.py`

Standard AWS Lambda handler. Cache-aside pattern.

**Module-level initialization:**
```python
import boto3, os, json, redis
from dotenv import load_dotenv

load_dotenv()
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])
redis_client = redis.Redis(
    host=os.environ['REDIS_HOST'],
    port=int(os.environ.get('REDIS_PORT', 6379)),
    decode_responses=True
)
REDIS_TTL = int(os.environ.get('REDIS_TTL', 3600))
```

**Handler function: `handler(event, context)`**

1. Extract alias: `alias = event.get('pathParameters', {}).get('alias')`
2. If alias is None or empty → return 400
3. Check Redis:
```python
long_url = redis_client.get(alias)
```
4. If Redis hit → return 301 redirect with header `X-Cache: HIT`
5. If Redis miss → query DynamoDB:
```python
response = table.get_item(Key={'alias': alias})
item = response.get('Item')
```
6. If item not found → return 404
7. If found → write to Redis cache:
```python
redis_client.set(alias, item['long_url'], ex=REDIS_TTL)
```
8. Return 301 redirect with header `X-Cache: MISS`

**301 redirect response format:**
```python
{
    "statusCode": 301,
    "headers": {
        "Location": long_url,
        "X-Cache": "HIT" or "MISS",
        "Access-Control-Allow-Origin": "*"
    },
    "body": ""
}
```

**Error handling:** All exceptions caught with `except Exception as e` → return 500.

---

## Infrastructure

### `infrastructure/stacks/url_shortener_stack.py`

AWS CDK stack in Python. One stack, all resources.

**Resources to create:**

**VPC**
- New VPC with public and private subnets
- NAT Gateway enabled (Lambda needs internet access for DynamoDB/API calls if in VPC)

**DynamoDB Table**
- Table name: from env or CDK context, passed as Lambda env var
- Partition key: `alias` (String)
- Billing: PAY_PER_REQUEST
- Removal policy: RETAIN (never delete data accidentally)

**ElastiCache Redis**
- Single node (not cluster — scale is low enough)
- Node type: `cache.t3.micro`
- Engine: Redis 7.x
- Place in private subnet of the VPC
- Security group: allow inbound 6379 from Lambda security group only

**Lambda: create_url**
- Runtime: Python 3.11
- Handler: `handler.handler`
- Code: `backend/lambdas/create_url/` + `backend/shared/` bundled together
- Memory: 256MB
- Timeout: 10 seconds
- Environment variables: `TABLE_NAME`, `BASE_DOMAIN`, `ALIAS_LENGTH`
- IAM: DynamoDB PutItem permission on the table
- Place in VPC private subnet

**Lambda: redirect_url**
- Runtime: Python 3.11
- Handler: `handler.handler`
- Code: `backend/lambdas/redirect_url/` + `backend/shared/` bundled together
- Memory: 256MB
- Timeout: 5 seconds
- Environment variables: `TABLE_NAME`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_TTL`
- IAM: DynamoDB GetItem permission on the table
- Place in VPC private subnet (same subnet as Redis)
- Security group: allow outbound 6379 to Redis security group

**API Gateway (HTTP API)**
- POST `/create` → create_url Lambda
- GET `/{alias}` → redirect_url Lambda
- CORS enabled (allow all origins for now)
- Stage: `prod`

**CloudWatch Alarms**
- create_url error rate > 5% over 5 minutes → alarm
- redirect_url error rate > 5% over 5 minutes → alarm
- redirect_url p99 latency > 500ms → alarm

**Outputs**
- Print API Gateway URL after deploy (this becomes BASE_DOMAIN)

### `infrastructure/app.py`
- Standard CDK app entry point
- Instantiate `UrlShortenerStack`
- Read env/context for stack name and account/region

---

## Tests

### `tests/test_hashing.py`

Seven test cases using pytest:

1. `test_valid_url_returns_alias` — valid URL returns 6-char alias and "Success"
2. `test_same_url_same_epoch_deterministic` — same inputs always produce same alias
3. `test_same_url_diff_epoch_different_alias` — same URL different epoch = different alias
4. `test_trailing_slash_same_as_no_slash` — `https://a.com/` and `https://a.com` with same epoch = same alias
5. `test_empty_url_returns_error` — empty string returns `("", "Invalid Input Data")`
6. `test_invalid_url_no_scheme_returns_error` — `"confluence/page"` returns `("", "Invalid Input Data")`
7. `test_epoch_zero_returns_error` — epoch_time=0 returns `("", "Invalid Input Data")`

### `tests/test_create_url.py`

Use `unittest.mock` to mock `boto3` and `generate_alias`. Do not make real AWS calls.

Test cases:
1. Valid input → 200 with short_url in body
2. Missing `long_url` in body → 400
3. `generate_alias` returns error → 400
4. DynamoDB `put_item` raises exception → 500

### `tests/test_redirect_url.py`

Use `unittest.mock` to mock `boto3` and `redis`.

Test cases:
1. Redis cache hit → 301 with correct Location header and `X-Cache: HIT`
2. Redis cache miss, DynamoDB hit → 301 with correct Location header and `X-Cache: MISS`
3. Redis miss, DynamoDB miss → 404
4. Missing alias in path → 400
5. Redis raises exception → 500

---

## Frontend

React app. Functional components with hooks only. No class components.

### Pages / Components

**`App.jsx`**
- Main layout
- Two sections: URL Shortener form, Load Simulator
- Clean, minimal design

**`UrlForm.jsx`**
- Input field for long URL
- Submit button: calls `POST /create` on API Gateway
- Displays returned short URL as a clickable link
- Error state if API call fails

**`LoadSimulator.jsx`**
- Number input: requests per second (1-50)
- Start/Stop button
- On start: fires GET requests to a short alias at the chosen rate using `setInterval`
- Tracks each response: cache hit (X-Cache: HIT) or cache miss (X-Cache: MISS), response time in ms
- Passes stats up to parent or shared state for charting

**`CacheChart.jsx`**
- Live updating chart (use `recharts` library)
- Three panels:
  1. Cache hit vs miss ratio (pie or donut chart, live updating)
  2. Response time over time (line chart, last 60 data points)
  3. Requests per second counter (number display)

### Config
- API base URL read from environment variable `REACT_APP_API_URL`
- Add to `.env.example`: `REACT_APP_API_URL=`

---

## README

Sections:

1. **Overview** — what this is and why it was built (fulfillment of a system design interview commitment)
2. **Architecture** — reference to `architecture/system_design.png`, description of components, trade-off note: Lambda chosen over EKS because at 10K requests/day it is more cost-effective and operationally simpler; EKS would be appropriate at higher scale
3. **Stack** — table of components and choices
4. **Local Setup** — clone, install dependencies, copy `.env.example` to `.env`, fill in values
5. **Deploy** — `cdk bootstrap` (first time only), `cdk deploy`, note that API Gateway URL output becomes `BASE_DOMAIN`
6. **Running Tests** — `pytest tests/`
7. **Frontend** — `npm install`, `npm start`, set `REACT_APP_API_URL`
8. **Author** — Arsalan (with Claude assist)

---

## Dependency Notes

**Python (backend):**
- `boto3`
- `redis`
- `base62`
- `python-dotenv`
- `pytest` (dev)

**Python (CDK):**
- `aws-cdk-lib`
- `constructs`
- `python-dotenv`

**Frontend:**
- `react`
- `recharts`
- `axios` or native `fetch`

---

## Constraints and Decisions

| Decision | Choice | Reason |
|---|---|---|
| Compute | Lambda (not EKS) | 10K req/day does not justify EKS overhead or cost |
| Cache | ElastiCache Redis | Sub-500ms redirect requirement; cache-aside pattern |
| DB | DynamoDB | Serverless, no ops, matches scale |
| Collision strategy | Include epoch in hash key | Same URL submitted twice gets different aliases — matches requirement that multiple short URLs can point to same long URL |
| Alias length | 6 chars base62 | 62^6 = ~56 billion possible aliases, more than sufficient |
| Frontend build | Claude-assisted | Noted in README |
| Auth | Out of scope | Assumed to exist externally |
| Deletion | Not supported | All URLs permanent per requirements |
