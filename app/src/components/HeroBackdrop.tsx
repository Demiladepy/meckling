import s from "./HeroBackdrop.module.css";

/**
 * The hero's background: one price line on a quiet chart grid, climbing toward your limit. Where the agent tried to
 * push past it, the attempt stays as a dashed ghost and the real line runs flat along the limit, with a small ember
 * mark for each refused order: the product's idea as a picture. Decorative only; drawn in code so it is sharp at any
 * size, and faded behind the headline so the text always reads.
 */
const W = 1440;
const H = 640;
const LIMIT_Y = 236;
const STEP = 24;
const GRID = [116, 236, 356, 476, 596];
const PRICES = ["98,400", "97,600", "96,800", "96,000", "95,200"];

/** A deterministic walk that rises across the band and presses into the limit on the right. */
function walk(): number[] {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const ys: number[] = [];
  let noise = 0;
  for (let x = 0; x <= W - 3 * STEP; x += STEP) {
    noise = noise * 0.72 + (rand() - 0.5) * 30;
    // Climb to the limit, keep pressing against it through the right flank (each push is a refused order), then
    // ease back below it.
    const p = x / W;
    const rising = p < 0.72;
    const pressing = !rising && p < 0.95;
    const trend = rising
      ? 560 - 300 * (p / 0.72)
      : pressing
        ? LIMIT_Y - 6 + 30 * Math.cos((2 * Math.PI * (p - 0.72)) / 0.075)
        : LIMIT_Y + 24 + 900 * (p - 0.95);
    const calm = pressing ? 0.25 : 1;
    const swell = calm * (34 * Math.sin(x / 150) + 18 * Math.sin(x / 61));
    ys.push(trend + swell + calm * noise);
  }
  return ys;
}

/** Catmull-Rom through the points, as cubic Béziers: a smooth line without a charting library. */
function smooth(pts: [number, number][]): string {
  let d = `M${pts[0]![0]},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)]!;
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[i + 1]!;
    const [x3, y3] = pts[Math.min(pts.length - 1, i + 2)]!;
    d += ` C${(x1 + (x2 - x0) / 6).toFixed(1)},${(y1 + (y2 - y0) / 6).toFixed(1)} ${(x2 - (x3 - x1) / 6).toFixed(1)},${(y2 - (y3 - y1) / 6).toFixed(1)} ${x2},${y2.toFixed(1)}`;
  }
  return d;
}

export function HeroBackdrop() {
  const raw = walk();
  const tried: [number, number][] = raw.map((y, i) => [i * STEP, y]);
  const held: [number, number][] = raw.map((y, i) => [
    i * STEP,
    Math.max(LIMIT_Y, y),
  ]);
  // A refused order: each place the attempt peaks above the limit.
  const refused = raw
    .map((y, i) => ({
      x: i * STEP,
      y,
      peak:
        y < LIMIT_Y - 6 &&
        y <= (raw[i - 1] ?? Infinity) &&
        y <= (raw[i + 1] ?? Infinity),
    }))
    .filter((p) => p.peak);
  const line = smooth(held);
  const last = held[held.length - 1]!;
  const tagged = refused.find((p) => p.x > W * 0.78 && p.x < W * 0.9);

  return (
    <div className={s.backdrop} aria-hidden>
      <div className={s.stage}>
        <svg
          className={s.chart}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="hb-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2f9e78" stopOpacity="0.09" />
              <stop offset="100%" stopColor="#2f9e78" stopOpacity="0" />
            </linearGradient>
          </defs>
          {GRID.map((y) => (
            <line
              key={y}
              x1="0"
              x2={W}
              y1={y}
              y2={y}
              className={s.grid}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            d={`${line} L${last[0]},${H} L0,${H} Z`}
            fill="url(#hb-fill)"
            className={s.area}
          />
          <path
            d={smooth(tried)}
            className={s.tried}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1="0"
            x2={W}
            y1={LIMIT_Y}
            y2={LIMIT_Y}
            className={s.limit}
            vectorEffect="non-scaling-stroke"
          />
          <path d={line} className={s.line} vectorEffect="non-scaling-stroke" />
          {refused.map((p) => (
            <line
              key={p.x}
              x1={p.x}
              x2={p.x}
              y1={LIMIT_Y - 9}
              y2={LIMIT_Y + 9}
              className={s.refused}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <span
          className={s.now}
          style={{
            left: `${(last[0] / W) * 100}%`,
            top: `${(last[1] / H) * 100}%`,
          }}
        />
        <div className={s.axis}>
          {GRID.map((y, i) => (
            <span key={y} style={{ top: `${(y / H) * 100}%` }}>
              {PRICES[i]}
            </span>
          ))}
        </div>
        <span className={s.limitTag} style={{ top: `${(LIMIT_Y / H) * 100}%` }}>
          Your limit
        </span>
        {tagged && (
          <span
            className={s.refusedTag}
            style={{
              left: `${(tagged.x / W) * 100}%`,
              top: `${(LIMIT_Y / H) * 100}%`,
            }}
          >
            Order refused
          </span>
        )}
      </div>
    </div>
  );
}
