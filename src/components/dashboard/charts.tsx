/**
 * Dashboard charts drawn on the server as SVG and HTML: no chart library and
 * no browser JavaScript, so they are light, sharp at any width and readable
 * without colour (every series is labelled and every point has a tooltip).
 */

export interface Series {
  key: string;
  label: string;
  /** A CSS colour, e.g. "var(--color-chart-counted)". */
  color: string;
  /** One value per x position; null leaves a gap. */
  values: (number | null)[];
  /** Filled area under the line (the price-chart look); the first series only, usually. */
  area?: boolean;
}

const W = 100;
const H = 40;

/** A smooth path that never overshoots the data (monotone cubic), in chart units. */
function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  const n = points.length;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) slopes.push((points[i + 1][1] - points[i][1]) / (points[i + 1][0] - points[i][0] || 1));
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === n - 1) return slopes[n - 2];
    return slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
  });
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const dx = (x1 - x0) / 3;
    d += ` C${x0 + dx},${y0 + tangents[i] * dx} ${x1 - dx},${y1 - tangents[i + 1] * dx} ${x1},${y1}`;
  }
  return d;
}

/** Up to five round tick values from 0 (or the minimum) to just above the maximum. */
function ticks(min: number, max: number): number[] {
  if (max === min) return [min, min + 1];
  const raw = (max - min) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Number(v.toFixed(6)));
  if (out[out.length - 1] < max) out.push(Number((out[out.length - 1] + step).toFixed(6)));
  return out;
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));

/**
 * Line or area chart over evenly spaced time buckets. `fromZero` starts the
 * axis at 0 (counts); scores use their own range so small changes show.
 */
export function TrendChart({
  id,
  labels,
  series,
  fromZero = false,
  height = "h-56",
  compact = false,
  valueLabel,
}: {
  id: string;
  labels: string[];
  series: Series[];
  fromZero?: boolean;
  height?: string;
  compact?: boolean;
  valueLabel?: (v: number) => string;
}) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (all.length === 0 || labels.length === 0) return <p className={`flex ${height} items-center justify-center text-sm text-gray-500`}>No data for this period yet.</p>;
  const lo = fromZero ? 0 : Math.min(...all);
  const hi = Math.max(...all);
  const axis = compact ? [lo, hi === lo ? lo + 1 : hi] : ticks(lo, hi);
  const min = axis[0];
  const max = axis[axis.length - 1];
  const x = (i: number) => (labels.length === 1 ? W / 2 : (i / (labels.length - 1)) * W);
  const y = (v: number) => H - ((v - min) / (max - min || 1)) * H;
  const show = valueLabel ?? fmt;
  // A handful of x labels, evenly spread, always including the last.
  const every = Math.max(1, Math.ceil(labels.length / (compact ? 2 : 6)));
  const last = labels.length - 1;
  // Regular ticks plus the last one; a regular tick too close to the last would overlap it.
  const xTicks = labels.map((l, i) => ({ l, i })).filter(({ i }) => i === last || (i % every === 0 && last - i >= every));

  return (
    <div className={compact ? "" : "pl-8"}>
      <div className={`relative ${height}`}>
        {!compact &&
          axis.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-dashed border-gray-200" style={{ top: `${(y(t) / H) * 100}%` }}>
              <span className="absolute -left-8 -translate-y-1/2 text-[11px] tabular-nums text-gray-500">{show(t)}</span>
            </div>
          ))}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            {series
              .filter((s) => s.area)
              .map((s) => (
                <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
          </defs>
          {series.map((s) => {
            const points = s.values.flatMap((v, i) => (v === null ? [] : [[x(i), y(v)] as [number, number]]));
            const line = smoothPath(points);
            return (
              <g key={s.key}>
                {s.area && points.length > 1 && <path d={`${line} L${points[points.length - 1][0]},${H} L${points[0][0]},${H} Z`} fill={`url(#${id}-${s.key})`} />}
                <path d={line} fill="none" stroke={s.color} strokeWidth={compact ? 2 : 2.25} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
        </svg>
        {/* Points as HTML so they stay round at any width; each has a tooltip. */}
        {series.map((s) =>
          s.values.map((v, i) =>
            v === null || (compact && i !== s.values.length - 1) ? null : (
              <span
                key={`${s.key}-${i}`}
                title={`${labels[i]}: ${s.label} ${show(v)}`}
                className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm transition-transform hover:scale-150"
                style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(v) / H) * 100}%`, background: s.color }}
              />
            ),
          ),
        )}
      </div>
      {!compact && (
        <div className="relative mt-2 h-4 text-[11px] text-gray-500">
          {xTicks.map(({ l, i }, n) => (
            <span
              key={i}
              // Phones show every other label so they never run together.
              className={`absolute whitespace-nowrap ${i === 0 ? "" : i === last ? "-translate-x-full" : "-translate-x-1/2"} ${n % 2 === 1 && i !== last ? "hidden sm:inline" : ""}`}
              style={{ left: `${(x(i) / W) * 100}%` }}
            >
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: string | number }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
          {item.value !== undefined && <span className="font-medium tabular-nums text-gray-900">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A ring split into parts, with the total in the middle. */
export function Donut({ parts, total, caption, size = "size-36", thickness = 5 }: { parts: { label: string; value: number; color: string }[]; total: number; caption: string; size?: string; thickness?: number }) {
  const r = 15.9155; // circumference 100, so dash lengths are percentages
  let offset = 25; // start at twelve o'clock
  return (
    <div className={`relative mx-auto shrink-0 ${size}`}>
      <svg viewBox="0 0 42 42" className="size-full" aria-hidden="true">
        <circle cx="21" cy="21" r={r} fill="none" stroke="#eef1f5" strokeWidth={thickness} />
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => {
              const pct = (p.value / total) * 100;
              const el = (
                <circle key={p.label} cx="21" cy="21" r={r} fill="none" stroke={p.color} strokeWidth={thickness} strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={offset}>
                  <title>{`${p.label}: ${p.value} (${Math.round(pct)}%)`}</title>
                </circle>
              );
              offset -= pct;
              return el;
            })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums text-brand-navy-900">{total}</span>
        <span className="text-[11px] text-gray-500">{caption}</span>
      </div>
    </div>
  );
}

/** One bar split into parts, e.g. which responses count in the scores. */
export function SplitBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
      {total > 0 &&
        parts
          .filter((p) => p.value > 0)
          .map((p) => <div key={p.label} title={`${p.label}: ${p.value}`} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
    </div>
  );
}

/**
 * A small trend line with a soft fill and no axes, for KPI cards. Each month
 * is in the accessible text; the numbers themselves are written on the card.
 */
export function Sparkline({ id, values, color, label, className = "h-12 w-28" }: { id: string; values: number[]; color: string; label: string; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => [(i / (values.length - 1)) * W, H - 2 - (v / max) * (H - 6)] as [number, number]);
  const line = smoothPath(points);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`overflow-visible ${className}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Small bars, one per period, the latest in full colour; each bar has a tooltip. */
export function MiniBars({ labels, values, color, valueLabel = fmt }: { labels: string[]; values: number[]; color: string; valueLabel?: (v: number) => string }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex h-14 items-end gap-1" role="img" aria-label={labels.map((l, i) => `${l} ${valueLabel(values[i])}`).join(", ")}>
      {values.map((v, i) => (
        <span
          key={labels[i]}
          title={`${labels[i]}: ${valueLabel(v)}`}
          className="min-h-[3px] flex-1 rounded-t-[3px]"
          style={{ height: `${Math.max(5, (v / max) * 100)}%`, background: color, opacity: i === values.length - 1 ? 1 : 0.55 }}
        />
      ))}
    </div>
  );
}
