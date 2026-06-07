import { useState, useCallback, useEffect } from 'react';
import UrlForm from './components/UrlForm';
import LoadSimulator from './components/LoadSimulator';
import CacheChart from './components/CacheChart';
import RequestFlow from './components/RequestFlow';

const MAX_STATS = 60;

export default function App() {
  const [stats, setStats] = useState([]);
  const [shortUrl, setShortUrl] = useState('');
  const [latestStat, setLatestStat] = useState(null);
  const [config, setConfig] = useState({ apiUrl: '', defaultAlias: '' });

  // Load runtime config from S3/CloudFront — never baked into the JS bundle
  useEffect(() => {
    fetch('/config.json')
      .then(r => r.json())
      .then(setConfig)
      .catch(() => {}); // silent fail for local dev without config
  }, []);

  const addStat = useCallback((stat) => {
    setStats(prev => [...prev.slice(-(MAX_STATS - 1)), stat]);
    setLatestStat(stat);
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>URL Shortener</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        Capital One internal — cache-aside demo with Redis + DynamoDB
      </p>
      <UrlForm onShortUrl={setShortUrl} apiUrl={config.apiUrl} />
      <hr style={{ margin: '2rem 0', borderColor: '#e5e7eb' }} />
      <LoadSimulator
        shortUrl={shortUrl}
        onStat={addStat}
        apiUrl={config.apiUrl}
        defaultAlias={config.defaultAlias}
      />
      <RequestFlow latestStat={latestStat} />
      <CacheChart stats={stats} />
    </div>
  );
}
