import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';

const HIT_COLOR = '#16a34a';
const MISS_COLOR = '#dc2626';
const LINE_COLOR = '#2563eb';

export default function CacheChart({ stats }) {
  if (stats.length === 0) {
    return (
      <p style={{ color: '#9ca3af', marginTop: '1rem' }}>
        Start the simulator to see live cache performance data.
      </p>
    );
  }

  const hits = stats.filter(s => s.xCache === 'HIT').length;
  const misses = stats.filter(s => s.xCache === 'MISS').length;
  const total = stats.length;
  const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;
  const recentRps = stats.filter(s => Date.now() - s.timestamp < 1000).length;
  const avgMs = total > 0 ? Math.round(stats.reduce((s, r) => s + r.responseTime, 0) / total) : 0;

  const pieData = [
    { name: 'HIT', value: hits },
    { name: 'MISS', value: misses },
  ];

  const lineData = stats.map((s, i) => ({ i, ms: s.responseTime }));

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2 style={{ marginBottom: '1rem' }}>Cache Performance</h2>

      {/* Summary counters */}
      <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <Stat label="Req / sec (last 1s)" value={recentRps} />
        <Stat label="Hit rate" value={`${hitRate}%`} color={hitRate > 80 ? HIT_COLOR : MISS_COLOR} />
        <Stat label="Avg response" value={`${avgMs}ms`} />
        <Stat label="Total requests" value={total} />
      </div>

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Donut chart */}
        <div>
          <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Hit / Miss Ratio</h3>
          <PieChart width={200} height={200}>
            <Pie
              data={pieData}
              cx={95}
              cy={95}
              innerRadius={52}
              outerRadius={80}
              dataKey="value"
              paddingAngle={2}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={i === 0 ? HIT_COLOR : MISS_COLOR} />
              ))}
            </Pie>
            <Tooltip formatter={(v, name) => [v, name]} />
            <Legend />
          </PieChart>
        </div>

        {/* Response time line chart */}
        <div style={{ flex: 1, minWidth: 300 }}>
          <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Response Time — last {stats.length} requests</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={lineData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="i" hide />
              <YAxis unit="ms" width={48} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${v}ms`, 'Response time']} />
              <Line type="monotone" dataKey="ms" stroke={LINE_COLOR} dot={false} strokeWidth={2} name="Response time" />
            </LineChart>
          </ResponsiveContainer>
          <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            HIT / MISS inferred from response time (threshold: 30ms). Browser security prevents reading
            X-Cache header directly from cross-origin redirects.
          </p>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: '1.75rem', fontWeight: 700, color: color || '#111' }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{label}</div>
    </div>
  );
}
