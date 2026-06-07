# URL Shortener — Project Context for Claude Code

## What this project is

A production URL shortener built for internal Capital One use, and as a follow-through on a system design interview commitment. Built from scratch with Claude Code in a single session.

**Live frontend:** see CloudFront output from `cdk deploy` (password protected)
**API:** see ApiUrl output from `cdk deploy`
**AWS Account:** us-east-1 (account ID kept out of source control)

---

## Credentials and access

- **Frontend login:** username `owen`, password passed via CDK context at deploy time (`-c frontend_password=...`). Never stored in code.
- **AWS IAM user:** `url-shortener-deploy` (AdministratorAccess)
- **DynamoDB table name:** printed as `TableName` output after `cdk deploy`

---

## Architecture

```
Browser → CloudFront (Basic Auth) → S3 (React frontend)
Browser → API Gateway → create_url Lambda → DynamoDB
Browser → API Gateway → redirect_url Lambda → Redis (HIT)
                                            └→ DynamoDB (MISS) → write back to Redis
```

- VPC with 2 public + 2 private subnets, 1 NAT Gateway
- Lambda in private subnets, ElastiCache Redis in private subnets
- Lambda SG → Redis SG on port 6379 only
- CloudFront Function handles Basic Auth before requests reach S3

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + recharts, hosted on S3 + CloudFront |
| API | AWS API Gateway HTTP API |
| Compute | AWS Lambda Python 3.11 |
| Cache | ElastiCache Redis (cache.t3.micro, single node) |
| Database | DynamoDB PAY_PER_REQUEST, RemovalPolicy.RETAIN |
| IaC | AWS CDK Python (cdk.json at project root) |
| Monitoring | CloudWatch alarms (error rate + p99 latency) |

---

## Repo structure

```
url-shortener/
├── CLAUDE.md                          ← this file
├── README.md
├── .env.example
├── .gitignore
├── cdk.json                           ← CDK app entry point
├── pyproject.toml                     ← uv project (Python 3.11)
├── backend/
│   ├── lambdas/
│   │   ├── create_url/handler.py      ← POST /create
│   │   └── redirect_url/handler.py    ← GET /{alias}, DELETE /{alias}
│   └── shared/
│       └── hashing.py                 ← SHA-256 + base62 alias generation
├── infrastructure/
│   ├── app.py                         ← CDK app entry
│   └── stacks/
│       └── url_shortener_stack.py     ← all AWS resources in one stack
├── frontend/
│   ├── package.json                   ← Vite + React + recharts
│   ├── .env                           ← VITE_API_URL (gitignored)
│   ├── .env.example
│   └── src/
│       ├── App.jsx
│       └── components/
│           ├── UrlForm.jsx            ← POST /create, shows short URL
│           ├── LoadSimulator.jsx      ← fires GET requests, tracks HIT/MISS
│           ├── CacheChart.jsx         ← recharts pie + line chart
│           └── RequestFlow.jsx        ← live SVG architecture diagram with animated dots
├── tests/
│   ├── test_hashing.py                ← 7 tests
│   ├── test_create_url.py             ← 4 tests
│   └── test_redirect_url.py           ← 5 tests
└── explanations/
    ├── layer1_hashing.md
    ├── layer2_create_url.md
    ├── layer3_redirect_url.md
    ├── layer4_cdk_infrastructure.md
    ├── layer5_react_frontend.md
    └── layer6_readme_and_config.md
```

---

## API routes

| Method | Path | Handler | Purpose |
|---|---|---|---|
| POST | /create | create_url | Accepts long_url, returns short URL |
| GET | /{alias} | redirect_url | 301 redirect, cache-aside pattern |
| DELETE | /{alias} | redirect_url | Clears Redis cache for alias |

---

## Key implementation decisions

**Hashing:** SHA-256 of `url + epoch_time`, base62-encoded, first 6 chars. Epoch included so same URL submitted twice gets different aliases (intentional — no deduplication by design).

**Cache-aside:** Redis checked first on every GET. HIT returns from memory (~1ms). MISS queries DynamoDB (~20ms), writes result back to Redis with 1-hour TTL.

**BASE_DOMAIN:** Not known until first deploy. Workflow: `cdk deploy` → copy ApiUrl output → `cdk deploy -c base_domain=<url>`.

**Lambda bundling:** Custom `_LocalBundler` class (jsii ILocalBundling) in the CDK stack. Runs `uv pip install --target` for deps, copies handler + shared/ into the asset output. No Docker needed.

**Frontend env vars:** Vite project uses `VITE_API_URL` prefix (not `REACT_APP_`). CRA was not used because Node 24 is incompatible with react-scripts 5.

**HIT/MISS detection in browser:** Browser security prevents reading X-Cache header from cross-origin 301 responses (opaqueredirect type). HIT/MISS is inferred from response time — under 30ms = HIT. Works well in practice since Redis hits are ~5ms and DynamoDB misses are ~30-50ms.

**DELETE /cache:** Added to redirect_url Lambda (same function, checks `event['requestContext']['http']['method']`). Lets frontend clear Redis before each demo run so MISS → HIT transition is always visible.

---

## Deploy commands

```bash
# First time only
cdk bootstrap

# Standard deploy (always pass base_domain and frontend_password)
cdk deploy --require-approval never \
  -c base_domain=https://<your-api-id>.execute-api.us-east-1.amazonaws.com \
  -c frontend_password=<your-password>

# Tear down (DynamoDB table is retained)
cdk destroy

# Run tests
uv run pytest tests/ -v

# Frontend dev server
cd frontend && npm start
```

---

## Cost (~$60/month while running)

| Resource | Cost |
|---|---|
| NAT Gateway | ~$35/month (hourly) |
| ElastiCache t3.micro | ~$25/month (hourly) |
| Lambda / DynamoDB / API GW | ~$0 at this scale |

Run `cdk destroy` when not in use. DynamoDB data survives (`RemovalPolicy.RETAIN`).

---

## Known issues / notes

- `npm install` may need `--cache /tmp/npm-cache` due to a permissions issue in `~/.npm`. Fix: `sudo chown -R $(whoami) ~/.npm`
- The CDK stack rebuilds and re-uploads Lambda zips on every deploy even if only the frontend changed. This is expected — CDK hashes the asset content.
- `pybase62` is the PyPI package name but installs as `base62.py` — import as `import base62`.
- Test files for create_url and redirect_url both import a module named `handler`. They use different loading strategies to avoid sys.modules collision: test_create_url uses `import handler`, test_redirect_url uses `importlib.util.spec_from_file_location`.

---

## Author

Arsalan — with Claude Code assist
