/** Where JC-316's dock sits: one of the four viewport corners. Pure geometry, so it can be unit tested. */
export type Corner = "br" | "bl" | "tr" | "tl";
export type Rect = { left: number; top: number; right: number; bottom: number };
type Size = { w: number; h: number };

export const CORNERS: Corner[] = ["br", "bl", "tr", "tl"];
export const DOCK_MARGIN = 16;

export function cornerRect(c: Corner, dock: Size, view: Size, m = DOCK_MARGIN): Rect {
  const left = c[1] === "l" ? m : view.w - m - dock.w;
  const top = c[0] === "t" ? m : view.h - m - dock.h;
  return { left, top, right: left + dock.w, bottom: top + dock.h };
}

export function overlapArea(a: Rect, b: Rect) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The corner that hides the least of the target. Stays put when the target is clear or off-screen,
 * and only moves for a clear improvement, so scrolling doesn't make the dock jitter between corners.
 * Ties go to the corner closest to where the dock already is (shortest flight).
 */
export function pickCorner(target: Rect, dock: Size, view: Size, current: Corner): Corner {
  const visible: Rect = {
    left: Math.max(0, target.left),
    top: Math.max(0, target.top),
    right: Math.min(view.w, target.right),
    bottom: Math.min(view.h, target.bottom),
  };
  if (visible.right <= visible.left || visible.bottom <= visible.top) return current;

  const score = (c: Corner) => overlapArea(cornerRect(c, dock, view), visible);
  const now = score(current);
  if (now === 0) return current;

  const here = cornerRect(current, dock, view);
  const travel = (c: Corner) => {
    const r = cornerRect(c, dock, view);
    return Math.hypot(r.left - here.left, r.top - here.top);
  };
  const best = [...CORNERS].sort((a, b) => score(a) - score(b) || travel(a) - travel(b))[0];
  return score(best) < now * 0.8 ? best : current;
}
