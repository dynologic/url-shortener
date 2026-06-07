import { useState, useRef, useCallback, useEffect } from 'react';

const HIT_THRESHOLD_MS = 30;
const AUTO_STOP_SECONDS = 15;
export default function LoadSimulator({ shortUrl, onStat, apiUrl, defaultAlias }) {
  const [targetUrl, setTargetUrl] = useState('');
  const [rps, setRps] = useState(5);
  const [running, setRunning] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_STOP_SECONDS);
  const [errorMsg, setErrorMsg] = useState('');
  const [requestCount, setRequestCount] = useState(0);
  const [clearOnStart, setClearOnStart] = useState(true);
  const [clearing, setClearing] = useState(false);
  const intervalRef = useRef(null);
  const countdownRef = useRef(null);
  const targetRef = useRef('');

  // Set default from runtime config once it loads
  useEffect(() => {
    if (apiUrl && defaultAlias && !targetUrl) {
      const full = `${apiUrl}/${defaultAlias}`;
      setTargetUrl(full);
      targetRef.current = full;
    }
  }, [apiUrl, defaultAlias]);

  // Auto-fill when a URL is created via the form above
  useEffect(() => {
    if (shortUrl) {
      setTargetUrl(shortUrl);
      targetRef.current = shortUrl;
      setErrorMsg('');
    }
  }, [shortUrl]);

  const stop = useCallback(() => {
    clearInterval(intervalRef.current);
    clearInterval(countdownRef.current);
    intervalRef.current = null;
    countdownRef.current = null;
    setRunning(false);
    setCountdown(AUTO_STOP_SECONDS);
  }, []);

  const fireRequest = useCallback(async () => {
    const url = targetRef.current;
    if (!url) return;
    const start = performance.now();
    let isRedirect = false;
    try {
      const res = await fetch(url, { redirect: 'manual' });
      // A valid short URL returns an opaque redirect (301)
      // Any other type means the alias doesn't exist or the URL is wrong
      isRedirect = res.type === 'opaqueredirect';
      if (!isRedirect) {
        setErrorMsg('Alias not found — check the short URL above (got a non-redirect response)');
        stop();
        return;
      }
      setErrorMsg('');
    } catch {
      setErrorMsg('Network error — check your connection or URL');
      stop();
      return;
    }
    const responseTime = Math.round(performance.now() - start);
    setRequestCount(c => c + 1);
    onStat({
      timestamp: Date.now(),
      xCache: responseTime < HIT_THRESHOLD_MS ? 'HIT' : 'MISS',
      responseTime,
    });
  }, [onStat, stop]);

  async function clearCache() {
    const url = targetRef.current;
    if (!url) return;
    setClearing(true);
    try {
      await fetch(url, { method: 'DELETE' });
      setErrorMsg('');
    } catch {
      // ignore — worst case the cache still has the entry
    } finally {
      setClearing(false);
    }
  }

  async function start() {
    if (intervalRef.current || !targetRef.current) return;
    if (clearOnStart) await clearCache();
    setErrorMsg('');
    setRequestCount(0);
    setRunning(true);
    setCountdown(AUTO_STOP_SECONDS);
    intervalRef.current = setInterval(fireRequest, Math.round(1000 / rps));
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { stop(); return AUTO_STOP_SECONDS; }
        return prev - 1;
      });
    }, 1000);
  }

  useEffect(() => () => stop(), [stop]);

  const circumference = 2 * Math.PI * 18;
  const progress = countdown / AUTO_STOP_SECONDS;
  const canStart = targetUrl.trim().startsWith('http');

  return (
    <section style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <h2 style={{ margin: 0 }}>Load Simulator</h2>
        {/* Always-visible status badge */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          padding: '0.2rem 0.6rem', borderRadius: 99, fontSize: '0.78rem', fontWeight: 600,
          background: running ? '#dcfce7' : '#f3f4f6',
          color: running ? '#16a34a' : '#6b7280',
          border: `1px solid ${running ? '#86efac' : '#e5e7eb'}`,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: running ? '#16a34a' : '#9ca3af',
            boxShadow: running ? '0 0 0 2px #bbf7d0' : 'none',
            animation: running ? 'pulse 1.2s infinite' : 'none',
          }} />
          {running ? `Running · ${requestCount} req sent` : 'Idle'}
        </span>
      </div>

      {/* CSS pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Error banner */}
      {errorMsg && (
        <div style={{
          marginBottom: '0.75rem', padding: '0.6rem 0.9rem',
          background: '#fef2f2', border: '1px solid #fca5a5',
          borderRadius: 6, color: '#dc2626', fontSize: '0.875rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          <span style={{ fontWeight: 700 }}>Error:</span> {errorMsg}
        </div>
      )}

      {/* Target URL input */}
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={{ display: 'block', fontSize: '0.875rem', color: '#374151', marginBottom: '0.3rem' }}>
          Short URL to test
        </label>
        <input
          type="url"
          value={targetUrl}
          readOnly
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '0.4rem 0.6rem', fontSize: '0.875rem',
            border: `1px solid ${errorMsg ? '#fca5a5' : '#e5e7eb'}`,
            borderRadius: 4, color: '#6b7280',
            background: '#f9fafb', cursor: 'default',
          }}
        />
        <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.25rem' }}>
          Auto-fills when you shorten a URL above.
        </p>
      </div>

      {/* Cache controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem', color: '#374151', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={clearOnStart}
            disabled={running}
            onChange={e => setClearOnStart(e.target.checked)}
          />
          Clear cache before each run
        </label>
        <button
          onClick={clearCache}
          disabled={running || clearing || !canStart}
          style={{
            padding: '0.3rem 0.8rem', fontSize: '0.8rem',
            background: '#fff', border: '1px solid #d1d5db',
            borderRadius: 4, cursor: canStart && !running ? 'pointer' : 'not-allowed',
            color: '#374151',
          }}
        >
          {clearing ? 'Clearing…' : 'Clear Cache Now'}
        </button>
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem' }}>
          Requests / sec:
          <input
            type="number" min={1} max={50} value={rps} disabled={running}
            onChange={e => setRps(Math.min(50, Math.max(1, Number(e.target.value))))}
            style={{ width: 60, padding: '0.3rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4 }}
          />
        </label>

        <button
          onClick={running ? stop : start}
          disabled={!canStart}
          style={{
            padding: '0.5rem 1.25rem',
            background: running ? '#dc2626' : canStart ? '#16a34a' : '#d1d5db',
            color: '#fff', border: 'none', borderRadius: 4,
            cursor: canStart ? 'pointer' : 'not-allowed', fontSize: '1rem',
          }}
        >
          {running ? 'Stop' : 'Start'}
        </button>

        {running && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
              <svg width="44" height="44" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="22" cy="22" r="18" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                <circle cx="22" cy="22" r="18" fill="none"
                  stroke={countdown <= 5 ? '#dc2626' : '#16a34a'}
                  strokeWidth="3"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - progress)}
                  style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }}
                />
              </svg>
              <span style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.75rem',
                color: countdown <= 5 ? '#dc2626' : '#374151',
              }}>
                {countdown}s
              </span>
            </div>
            <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
              auto-stop in {countdown}s · {rps} req/s
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
