# Layer 5 — React Frontend

## What this layer does and why it exists

The frontend has two jobs:
1. A form to shorten URLs (calls the `POST /create` Lambda)
2. A load simulator with a live chart to visualize cache behaviour (fires GET requests and tracks `X-Cache: HIT` vs `MISS` responses over time)

The second part is what makes this demo interesting — you can watch the cache warm up in real time.

---

## What React is

React is a JavaScript library for building UIs. You write small, reusable **components** (functions that return HTML-like JSX), and React handles updating the browser whenever data changes.

Three core concepts:

**Components** — everything is a function that returns UI:
```jsx
function Button({ label, onClick }) {
  return <button onClick={onClick}>{label}</button>;
}
```

**State (`useState`)** — data that, when changed, causes the component to re-render:
```jsx
const [count, setCount] = useState(0);
// count starts at 0
// calling setCount(1) re-renders the component with count = 1
```

**Effects (`useEffect`)** — code that runs after a render, used for timers, fetch calls, and cleanup:
```jsx
useEffect(() => {
  const id = setInterval(() => doSomething(), 1000);
  return () => clearInterval(id);  // cleanup when component unmounts
}, [dependency]);  // re-runs when dependency changes
```

---

## What the load simulator does technically

When you click Start:
1. `setInterval` fires a `fetch()` to `GET /{alias}` at your chosen rate (e.g. 10 times/second = interval of 100ms)
2. Each response is inspected for two things: the `X-Cache` header (`HIT` or `MISS`) and how long the request took (measured with `Date.now()` before/after the fetch)
3. Those results are added to a shared stats array in state
4. The chart re-renders automatically because state changed

When you click Stop, `clearInterval` cancels the timer and the requests stop.

---

## What recharts is

Recharts is a React charting library built on D3. You describe your chart declaratively — give it data and it renders SVG. It re-renders whenever the data prop changes, which is how the live update works.

```jsx
<LineChart data={points}>
  <Line dataKey="responseTime" />
  <XAxis dataKey="time" />
</LineChart>
```

---

## How the frontend calls the API Gateway URL

The API base URL is read from an environment variable: `REACT_APP_API_URL`. React (Create React App / Vite) automatically injects environment variables prefixed with `REACT_APP_` into the browser bundle at build time.

You set it in a `.env` file at the frontend root:
```
REACT_APP_API_URL=https://xxx.execute-api.us-east-1.amazonaws.com
```

Before deploy, you set this to your API Gateway URL from the CDK output.

---

## Component structure

```
App.jsx
├── UrlForm.jsx         — POST /create, shows returned short URL
├── LoadSimulator.jsx   — fires GET requests, measures cache/latency
└── CacheChart.jsx      — recharts visualisation of stats
```

`App.jsx` owns the shared `stats` state and passes it down. `LoadSimulator` updates stats; `CacheChart` reads them.

---

## Why frontend uses npm, not uv

React is a JavaScript ecosystem. `npm` is the Node.js package manager. `uv` is Python-only. These are separate ecosystems — the frontend and backend just happen to live in the same repo.

---

## Files created

- `frontend/src/App.jsx`
- `frontend/src/components/UrlForm.jsx`
- `frontend/src/components/LoadSimulator.jsx`
- `frontend/src/components/CacheChart.jsx`
- `frontend/src/index.js`
- `frontend/package.json`
- `frontend/.env.example`

## Validation

```bash
cd frontend
npm install
npm start
```

Expected: browser opens at `localhost:3000` showing the URL form and load simulator with no console errors.
