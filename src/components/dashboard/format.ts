/** Number formats shared by the dashboard sections. */

export const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

/** At most two decimals, without trailing zeros. */
export const score = (v: number | null, empty = "No score yet") => (v === null ? empty : String(Number(v.toFixed(2))));
