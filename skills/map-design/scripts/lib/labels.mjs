// Greedy label placement with collision avoidance. Labels that cannot be
// placed cleanly are dropped and counted, never overlapped.
import { textWidth, esc, n } from "./svg.mjs";

export class Placer {
  constructor(bounds) {
    this.bounds = bounds; // [x0, y0, x1, y1]
    this.boxes = [];
    this.dropped = [];
  }

  block(box) {
    this.boxes.push(box);
  }

  blockCircle(x, y, r) {
    this.boxes.push([x - r, y - r, x + r, y + r]);
  }

  fits(box) {
    const [x0, y0, x1, y1] = this.bounds;
    if (box[0] < x0 || box[1] < y0 || box[2] > x1 || box[3] > y1) return false;
    return !this.boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
  }

  /**
   * Place a point label. Tries positions around (x, y) at distance `gap`.
   * Returns { x, y, anchor, box } or null.
   */
  placePoint({ x, y, w, h, gap = 4, positions = ["right", "left", "top", "bottom", "top-right", "bottom-right", "top-left", "bottom-left"], name }) {
    for (const pos of positions) {
      let lx;
      let ly;
      let anchor = "start";
      if (pos === "right") { lx = x + gap; ly = y; }
      else if (pos === "left") { lx = x - gap; ly = y; anchor = "end"; }
      else if (pos === "top") { lx = x; ly = y - gap - h / 2; anchor = "middle"; }
      else if (pos === "bottom") { lx = x; ly = y + gap + h / 2; anchor = "middle"; }
      else if (pos === "top-right") { lx = x + gap * 0.7; ly = y - gap * 0.7 - h / 2; }
      else if (pos === "bottom-right") { lx = x + gap * 0.7; ly = y + gap * 0.7 + h / 2; }
      else if (pos === "top-left") { lx = x - gap * 0.7; ly = y - gap * 0.7 - h / 2; anchor = "end"; }
      else { lx = x - gap * 0.7; ly = y + gap * 0.7 + h / 2; anchor = "end"; }
      const left = anchor === "start" ? lx : anchor === "end" ? lx - w : lx - w / 2;
      const box = [left - 1, ly - h / 2 - 1, left + w + 1, ly + h / 2 + 1];
      if (this.fits(box)) {
        this.boxes.push(box);
        return { x: lx, y: ly, anchor, box };
      }
    }
    if (name) this.dropped.push(name);
    return null;
  }

  /** Place a label centered on (x, y), e.g. an area label. */
  placeCentered({ x, y, w, h, name }) {
    const box = [x - w / 2 - 1, y - h / 2 - 1, x + w / 2 + 1, y + h / 2 + 1];
    if (this.fits(box)) {
      this.boxes.push(box);
      return { x, y, anchor: "middle", box };
    }
    if (name) this.dropped.push(name);
    return null;
  }
}

/** One or more lines of halo'd text. `lines` may hold { text, size, weight, fill, family, italic }. */
export function textBlock({ x, y, anchor = "start", lines, halo, haloWidth = 3, family, letterSpacing, className }) {
  const total = lines.reduce((s, l) => s + l.size * 1.18, 0);
  let cy = y - total / 2;
  const parts = [];
  for (const l of lines) {
    cy += l.size * 1.18;
    const a = {
      x: n(x), y: n(cy - l.size * 0.28), "text-anchor": anchor,
      "font-family": l.family ?? family, "font-size": n(l.size), "font-weight": l.weight ?? 400,
      "font-style": l.italic ? "italic" : undefined, fill: l.fill,
      "letter-spacing": l.letterSpacing ?? letterSpacing,
    };
    const attrs = Object.entries(a).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
    if (halo) {
      parts.push(`<text ${attrs} stroke="${halo}" stroke-width="${haloWidth}" stroke-linejoin="round" stroke-opacity="0.92" paint-order="stroke">${esc(l.text)}</text>`);
    } else parts.push(`<text ${attrs}>${esc(l.text)}</text>`);
  }
  return `<g${className ? ` class="${className}"` : ""}>${parts.join("")}</g>`;
}

export function measureLines(lines, family) {
  return {
    w: Math.max(...lines.map((l) => textWidth(l.text, l.size, l.family ?? family, { weight: l.weight, letterSpacing: Number(l.letterSpacing) || 0 }))),
    h: lines.reduce((s, l) => s + l.size * 1.18, 0),
  };
}
