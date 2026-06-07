# Layer 6 — README, .env.example, .gitignore

## What this layer does

This layer makes the repo legible to someone who has never seen it — including your future self and anyone reviewing it for the interview. It also adds the safety files that prevent secrets and build artifacts from being accidentally committed.

---

## What .gitignore is and why .env must never be committed

`.gitignore` is a file that tells git which files and directories to ignore. Git will never track, stage, or commit anything listed in it.

The most important entry is `.env`. Your `.env` file contains real secrets:
- AWS credentials (if stored locally)
- Redis host/endpoint
- API Gateway URL

If you commit `.env` to a public GitHub repo, those values are permanently exposed in git history — even if you delete the file in a later commit. The history is forever.

The safe pattern:
- `.env` → gitignored, never committed, contains real values
- `.env.example` → committed, contains only placeholder keys with empty values

Anyone cloning the repo copies `.env.example` to `.env` and fills in their own values.

Other things gitignored:
- `.venv/` — Python virtual environment (hundreds of MB, recreatable with `uv sync`)
- `node_modules/` — npm packages (recreatable with `npm install`)
- `cdk.out/` — CDK synthesis output (generated, not source)
- `__pycache__/`, `.pytest_cache/` — Python bytecode and test caches
- `dist/` — frontend build output

---

## What the README should communicate

The README answers one question: "what is this and how do I use it?" for someone reading the repo cold. It should cover:

1. What the system is and why it was built
2. The architecture at a high level (what talks to what)
3. The tech stack in one place
4. How to run it locally
5. How to deploy it
6. How to run the tests
7. Who built it

It should be concise. A reader should be able to understand the system and get it running in under 5 minutes.

---

## Files created

- `README.md`
- `.env.example`
- `.gitignore`

## Validation

No commands needed. Read them and confirm they look right.
