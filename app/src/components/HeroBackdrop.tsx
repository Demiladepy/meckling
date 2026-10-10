import s from "./HeroBackdrop.module.css";

/**
 * The hero's background: a price chart on both flanks that climbs into a dashed limit line and can't cross it.
 * Candles that reach the limit stop at it and are capped in ember: the product's idea as a picture. The centre stays
 * clear for the headline. Decorative only; drawn in code so it is sharp at any size.
 */
const W = 1440;
const H = 640;
const LIMIT_Y = 250;
const STEP = 30;
const BODY = 17;
/** The headline column, kept empty. */
const CLEAR_FROM = W * 0.27;
const CLEAR_TO = W * 0.73;

type Candle = { x: number; open: number; close: number; high: number; low: number };

/** A deterministic random walk, so the chart is identical on every render and on the server. */
function walk(fromX: number, toX: number, start: number, drift: number, seed0: number): Candle[] {
  let seed = seed0;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const out: Candle[] = [];
  let price = start;
  for (let x = fromX; x < toX; x += STEP) {
    const open = price;
    // Pull back down when the walk presses into the limit, the way price meets a cap and turns.
    const pull = open < LIMIT_Y + 30 ? 26 : 0;
    const close = Math.max(LIMIT_Y - 30, Math.min(H - 40, open + drift + pull + (rand() - 0.5) * 56));
    const high = Math.min(open, close) - 8 - rand() * 30;
    const low = Math.max(open, close) + 8 + rand() * 30;
    out.push({ x, open, close, high, low });
    price = close;
  }
  return out;
}

export function HeroBackdrop() {
  const left = walk(STEP / 2, CLEAR_FROM, 560, -15, 11);
  const right = walk(CLEAR_TO + STEP / 2, W, 330, -4, 29);
  return (
    <div className={s.backdrop} aria-hidden>
      <div className={s.dots} />
      <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {[...left, ...right].map((c, i) => {
          const blocked = c.high < LIMIT_Y;
          const top = Math.max(LIMIT_Y, Math.min(c.open, c.close));
          const bottom = Math.max(c.open, c.close);
          const tone = blocked ? s.blocked : c.close < c.open ? s.up : s.down;
          return (
            <g key={i} className={tone}>
              <line x1={c.x} x2={c.x} y1={Math.max(LIMIT_Y, c.high)} y2={c.low} className={s.wick} />
              <rect x={c.x - BODY / 2} y={top} width={BODY} height={Math.max(4, bottom - top)} rx={2} />
              {blocked && <rect x={c.x - BODY / 2 - 3} y={LIMIT_Y - 10} width={BODY + 6} height={8} rx={2} className={s.stop} />}
            </g>
          );
        })}
        <line x1="0" x2={CLEAR_FROM} y1={LIMIT_Y} y2={LIMIT_Y} className={s.limit} />
        <line x1={CLEAR_TO} x2={W} y1={LIMIT_Y} y2={LIMIT_Y} className={s.limit} />
        <text x={W - 36} y={LIMIT_Y - 22} textAnchor="end" className={s.limitText}>
          Your limit
        </text>
      </svg>
    </div>
  );
}
