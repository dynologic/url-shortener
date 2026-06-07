# URL Shortener

A production-quality URL shortener built for internal Capital One use. Built as a follow-through on a system design interview commitment.

## Overview

Accepts a long URL via POST, generates a 6-character base62 alias, and redirects visitors in under 500ms using a cache-aside pattern (Redis first, DynamoDB fallback). A React frontend includes a load simulator that fires requests at a configurable rate and charts cache hit/miss ratios and response times in real time.

## Architecture

```
Browser
  │
  ├── POST /create ──► create_url Lambda ──► DynamoDB
  │
  └── GET /{alias} ──► redirect_url Lambda ──► Redis (HIT)
                                           └──► DynamoDB (MISS) ──► write back to Redis
```

Both Lambdas run in a private VPC subnet. ElastiCache Redis sits in the same private subnet, accessible only from the Lambda security group. A NAT Gateway gives Lambda outbound access to DynamoDB without exposing it to inbound traffic.

Lambda was chosen over ECS/EKS because at 10,000 redirects/day the operational overhead and cost of containers is not justified. EKS becomes appropriate at sustained high-concurrency load (millions of requests/day).

## Stack

| Component | Choice | Reason |
|---|---|---|
| Compute | AWS Lambda (Python 3.11) | Serverless, zero ops, right-sized for scale |
| Database | DynamoDB | Serverless, no ops, PAY_PER_REQUEST billing |
| Cache | ElastiCache Redis | Sub-500ms redirect requirement |
| IaC | AWS CDK (Python) | Single command deploy, version-controlled infra |
| API | API Gateway HTTP API | Managed routing, CORS, no server management |
| Frontend | React + Vite + recharts | Live cache visualisation |

## Local Setup

```bash
git clone <repo-url>
cd url-shortener

# Python environment
uv sync

# Copy and fill in environment variables
cp .env.example .env
# Edit .env with your deployed values (see Deploy section)

# Run all tests
uv run pytest tests/ -v
```

## Deploy

**First time only — bootstrap CDK in your AWS account:**
```bash
npm install -g aws-cdk
cdk bootstrap
```

**Deploy the stack:**
```bash
cdk deploy
```

CDK will print an `ApiUrl` output. Copy that URL.

**Update BASE_DOMAIN with the real API URL:**
```bash
cdk deploy -c base_domain=https://<your-api-id>.execute-api.us-east-1.amazonaws.com
```

This second deploy updates the Lambda environment variable so short URLs point to the correct domain.

## Running Tests

```bash
uv run pytest tests/ -v
```

Expected: 16 tests passing across hashing, create_url, and redirect_url.

## Frontend

```bash
cd frontend
cp .env.example .env
# Set VITE_API_URL to your API Gateway URL
npm install
npm start
```

Opens at `http://localhost:3000`. Shorten a URL, then use the load simulator to visualise cache behaviour.

**Note:** The frontend uses Vite, so the env var prefix is `VITE_` (not `REACT_APP_`). See `frontend/.env.example`.

## Author

Arsalan — with Claude assist
