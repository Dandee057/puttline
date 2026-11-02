/** Scoring: what a score is called, the stroke limit, and the running total against par. */

/** After this many strokes over par the ball is picked up, so nobody gets stuck on a hole. */
export const PICK_UP_OVER_PAR = 4;
export const maxStrokes = (par: number) => par + PICK_UP_OVER_PAR;

export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return "Hole in one!";
  const d = strokes - par;
  switch (d) {
    case -3: return "Albatross!";
    case -2: return "Eagle!";
    case -1: return "Birdie!";
    case 0: return "Par";
    case 1: return "Bogey";
    case 2: return "Double bogey";
    case 3: return "Triple bogey";
    default: return d < 0 ? `${-d} under par!` : `${d} over par`;
  }
}

/** "E" for even, "−2", "+3": how golf writes a score against par. */
export function toPar(strokes: number, par: number): string {
  const d = strokes - par;
  return d === 0 ? "E" : d < 0 ? `−${-d}` : `+${d}`;
}

/** The running total over the holes played so far (undefined entries are holes not yet played). */
export function totals(strokes: (number | undefined)[], pars: number[]): { strokes: number; par: number } {
  let s = 0, p = 0;
  strokes.forEach((x, i) => { if (x !== undefined) { s += x; p += pars[i]; } });
  return { strokes: s, par: p };
}
