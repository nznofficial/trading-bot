import { describe, expect, it } from "vitest";
import { cornerRect, overlapArea, pickCorner } from "@/lib/dock-placement";

const view = { w: 1280, h: 800 };
const dock = { w: 440, h: 300 };

describe("dock placement", () => {
  it("computes corner rects inside the margin", () => {
    expect(cornerRect("br", dock, view)).toEqual({ left: 824, top: 484, right: 1264, bottom: 784 });
    expect(cornerRect("tl", dock, view)).toEqual({ left: 16, top: 16, right: 456, bottom: 316 });
  });

  it("measures overlap", () => {
    expect(overlapArea({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 5, top: 5, right: 20, bottom: 20 })).toBe(25);
    expect(overlapArea({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(0);
  });

  it("stays home when the target is clear", () => {
    expect(pickCorner({ left: 40, top: 40, right: 400, bottom: 200 }, dock, view, "br")).toBe("br");
  });

  it("takes the shortest flight to a clear corner", () => {
    // A row across the bottom covers both bottom corners: up on the same side.
    expect(pickCorner({ left: 24, top: 600, right: 1256, bottom: 640 }, dock, view, "br")).toBe("tr");
    // A tall column on the right covers both right corners: across to the left.
    expect(pickCorner({ left: 900, top: 0, right: 1200, bottom: 800 }, dock, view, "br")).toBe("bl");
  });

  it("ignores targets scrolled off-screen", () => {
    expect(pickCorner({ left: 900, top: 900, right: 1200, bottom: 1000 }, dock, view, "br")).toBe("br");
  });

  it("doesn't move for a marginal gain", () => {
    // A full-viewport panel overlaps every corner about equally.
    expect(pickCorner({ left: 0, top: 0, right: 1280, bottom: 800 }, dock, view, "tl")).toBe("tl");
  });
});
