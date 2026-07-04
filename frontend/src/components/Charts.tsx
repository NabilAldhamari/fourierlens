/** Small dependency-free SVG charts for the metrics panel. */

interface RadialProps {
  freqs: number[];
  power: number[];
  slope?: number;
  width?: number;
  height?: number;
}

/** Log-log radial power spectrum with the fitted 1/f^alpha slope line. */
export function RadialProfileChart({ freqs, power, slope, width = 280, height = 150 }: RadialProps) {
  const pts = freqs
    .map((f, i) => [f, power[i]] as const)
    .filter(([f, p]) => f > 0 && p > 0);
  if (pts.length < 3) return <div className="chart-empty">no data</div>;

  const lx = pts.map(([f]) => Math.log10(f));
  const ly = pts.map(([, p]) => Math.log10(p));
  const xMin = Math.min(...lx), xMax = Math.max(...lx);
  const yMin = Math.min(...ly), yMax = Math.max(...ly);
  const pad = 24;
  const sx = (v: number) => pad + ((v - xMin) / (xMax - xMin || 1)) * (width - pad - 6);
  const sy = (v: number) => height - 16 - ((v - yMin) / (yMax - yMin || 1)) * (height - 22);

  const path = lx.map((x, i) => `${i === 0 ? "M" : "L"}${sx(x).toFixed(1)},${sy(ly[i]).toFixed(1)}`).join(" ");

  // fitted line through the mid-band, anchored at its centroid
  let fit = null;
  if (slope !== undefined && Number.isFinite(slope)) {
    const mid = pts.filter(([f]) => f >= 0.02 && f <= 0.7);
    if (mid.length > 2) {
      const cx = mid.reduce((s, [f]) => s + Math.log10(f), 0) / mid.length;
      const cy = mid.reduce((s, [, p]) => s + Math.log10(p), 0) / mid.length;
      const x0 = Math.log10(0.02), x1 = Math.log10(0.7);
      fit = (
        <line
          x1={sx(x0)} y1={sy(cy - slope * (x0 - cx))}
          x2={sx(x1)} y2={sy(cy - slope * (x1 - cx))}
          stroke="#fb923c" strokeWidth={1.5} strokeDasharray="5 3"
        />
      );
    }
  }

  return (
    <svg width={width} height={height} className="chart">
      <text x={pad} y={11} className="chart-title">radial power (log-log)</text>
      {slope !== undefined && Number.isFinite(slope) && (
        <text x={width - 6} y={11} textAnchor="end" className="chart-accent">α = {slope.toFixed(2)}</text>
      )}
      <path d={path} fill="none" stroke="#7dd3fc" strokeWidth={1.6} />
      {fit}
      <line x1={pad} y1={height - 16} x2={width - 6} y2={height - 16} stroke="#2a3142" />
      <line x1={pad} y1={height - 16} x2={pad} y2={14} stroke="#2a3142" />
      <text x={pad} y={height - 4} className="chart-label">low freq</text>
      <text x={width - 6} y={height - 4} textAnchor="end" className="chart-label">Nyquist</text>
    </svg>
  );
}

interface OrientationProps {
  histogram: number[];
  dominant?: number;
  width?: number;
  height?: number;
}

/** Orientation energy histogram over [0, 180) degrees. */
export function OrientationChart({ histogram, dominant, width = 280, height = 110 }: OrientationProps) {
  if (!histogram?.length) return <div className="chart-empty">no data</div>;
  const pad = 8;
  const max = Math.max(...histogram) || 1;
  const bw = (width - pad * 2) / histogram.length;
  return (
    <svg width={width} height={height} className="chart">
      <text x={pad} y={11} className="chart-title">orientation energy</text>
      {dominant !== undefined && (
        <text x={width - 6} y={11} textAnchor="end" className="chart-accent">peak {dominant.toFixed(0)}°</text>
      )}
      {histogram.map((v, i) => {
        const h = (v / max) * (height - 36);
        return (
          <rect
            key={i}
            x={pad + i * bw + 0.5}
            y={height - 18 - h}
            width={Math.max(bw - 1, 1)}
            height={h}
            fill="#7dd3fc"
            opacity={0.45 + 0.55 * (v / max)}
          />
        );
      })}
      <line x1={pad} y1={height - 18} x2={width - pad} y2={height - 18} stroke="#2a3142" />
      <text x={pad} y={height - 5} className="chart-label">0°</text>
      <text x={width / 2} y={height - 5} textAnchor="middle" className="chart-label">90°</text>
      <text x={width - pad} y={height - 5} textAnchor="end" className="chart-label">180°</text>
    </svg>
  );
}
