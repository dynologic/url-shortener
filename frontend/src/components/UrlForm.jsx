import { useState } from 'react';

export default function UrlForm({ onShortUrl, apiUrl }) {
  const API_URL = apiUrl || import.meta.env.VITE_API_URL || '';
  const [url, setUrl] = useState('');
  const [shortUrl, setShortUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setShortUrl('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ long_url: url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to shorten URL');
      setShortUrl(data.short_url);
      onShortUrl(data.short_url);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h2 style={{ marginBottom: '1rem' }}>Shorten a URL</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://example.com/long/path"
          required
          style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '1rem', border: '1px solid #d1d5db', borderRadius: 4 }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ padding: '0.5rem 1.25rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '1rem' }}
        >
          {loading ? 'Shortening…' : 'Shorten'}
        </button>
      </form>
      {shortUrl && (
        <p style={{ marginTop: '0.75rem' }}>
          Short URL:{' '}
          <a href={shortUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
            {shortUrl}
          </a>
        </p>
      )}
      {error && <p style={{ color: '#dc2626', marginTop: '0.5rem' }}>{error}</p>}
    </section>
  );
}
