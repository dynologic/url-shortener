import { useState, useEffect, useRef } from 'react';

const W = 640;
const H = 210;
const R = 30;

const NODES = {
  browser: { x: 55,  y: 105, label: ['Browser'],       color: '#6b7280', fill: '#f9fafb' },
  apigw:   { x: 195, y: 105, label: ['API', 'Gateway'], color: '#7c3aed', fill: '#f5f3ff' },
  lambda:  { x: 345, y: 105, label: ['Lambda'],         color: '#d97706', fill: '#fffbeb' },
  redis:   { x: 495, y: 52,  label: ['Redis'],          color: '#16a34a', fill: '#f0fdf4' },
  dynamo:  { x: 495, y: 165, label: ['DynamoDB'],       color: '#2563eb', fill: '#eff6ff' },
};

// Dot travels through Redis on both HIT and MISS — accurately shows cache-aside:
// HIT:  Browser → API GW → Lambda → Redis → back
// MISS: Browser → API GW → Lambda → Redis (miss) → DynamoDB → back
const HIT_PATH  = ['browser','apigw','lambda','redis',               'lambda','apigw','browser'];
const MISS_PATH = ['browser','apigw','lambda','redis','dynamo','lambda','apigw','browser'];
const DOT_MS = 2200;

function interpolate(path, t) {
  const segs = path.length - 1;
  const raw = t * segs;
  const i = Math.min(Math.floor(raw), segs - 1);
  const frac = raw - i;
  const a = NODES[path[i]];
  const b = NODES[path[i + 1]];
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
    nearNode: frac > 0.78 ? path[i + 1] : (frac < 0.22 && i > 0 ? path[i] : null),
  };
}

export default function RequestFlow({ latestStat }) {
  const [dots, setDots] = useState([]);
  const [lit, setLit] = useState({});
  const dotsRef = useRef([]);
  const rafRef = useRef(null);

  // Spawn a new dot whenever a stat arrives
  useEffect(() => {
    if (!latestStat) return;
    dotsRef.current = [
      ...dotsRef.current,
      {
        id: `${Date.now()}-${Math.random()}`,
        path: latestStat.xCache === 'HIT' ? HIT_PATH : MISS_PATH,
        color: latestStat.xCache === 'HIT' ? '#22c55e' : '#f59e0b',
        t0: performance.now(),
      },
    ];
  }, [latestStat]);

  // Animation loop — runs independently of React renders
  useEffect(() => {
    function tick() {
      const now = performance.now();
      dotsRef.current = dotsRef.current.filter(d => now - d.t0 < DOT_MS);
      const active = dotsRef.current.map(d => ({
        ...d,
        pos: interpolate(d.path, (now - d.t0) / DOT_MS),
      }));
      const newLit = {};
      active.forEach(d => { if (d.pos.nearNode) newLit[d.pos.nearNode] = d.color; });
      setDots(active);
      setLit(newLit);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2 style={{ marginBottom: '0.4rem' }}>Request Flow</h2>
      <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
        Live — dots travel the system in real time as requests fire
      </p>
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem 0.75rem 0.5rem' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>

          {/* Connection lines */}
          {[['browser','apigw'],['apigw','lambda'],['lambda','redis'],['lambda','dynamo']].map(([a, b]) => (
            <line key={a+b}
              x1={NODES[a].x} y1={NODES[a].y}
              x2={NODES[b].x} y2={NODES[b].y}
              stroke="#d1d5db" strokeWidth="2"
            />
          ))}
          {/* Redis ↔ DynamoDB dashed (same VPC subnet) */}
          <line
            x1={NODES.redis.x} y1={NODES.redis.y}
            x2={NODES.dynamo.x} y2={NODES.dynamo.y}
            stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="5 4"
          />

          {/* HIT / MISS labels on the fork */}
          <text x={430} y={72}  fontSize="9.5" fill="#16a34a" fontWeight="600">HIT</text>
          <text x={427} y={148} fontSize="9.5" fill="#f59e0b" fontWeight="600">MISS</text>

          {/* Nodes */}
          {Object.entries(NODES).map(([id, n]) => {
            const isLit = !!lit[id];
            const litColor = lit[id];
            return (
              <g key={id}>
                {isLit && (
                  <circle cx={n.x} cy={n.y} r={R + 10} fill={litColor} opacity={0.15} />
                )}
                <circle
                  cx={n.x} cy={n.y} r={R}
                  fill={isLit ? n.fill : '#fff'}
                  stroke={isLit ? litColor : '#d1d5db'}
                  strokeWidth={isLit ? 2.5 : 1.5}
                />
                {n.label.map((word, i) => (
                  <text key={i}
                    x={n.x}
                    y={n.y + (n.label.length > 1 ? (i === 0 ? -5 : 9) : 4)}
                    textAnchor="middle"
                    fontSize="10.5"
                    fontWeight="600"
                    fill={isLit ? litColor : '#374151'}
                  >
                    {word}
                  </text>
                ))}
              </g>
            );
          })}

          {/* Animated dots */}
          {dots.map(d => (
            <circle key={d.id}
              cx={d.pos.x} cy={d.pos.y} r={7}
              fill={d.color}
              style={{ filter: `drop-shadow(0 0 5px ${d.color})` }}
            />
          ))}
        </svg>

        <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: '#6b7280', paddingTop: '0.25rem' }}>
          <Legend color="#22c55e" label="HIT — served from Redis" />
          <Legend color="#f59e0b" label="MISS — Redis empty, fetched from DynamoDB" />
        </div>
      </div>
    </section>
  );
}

function Legend({ color, label }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
      {label}
    </span>
  );
}
