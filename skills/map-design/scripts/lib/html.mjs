// Wraps a rendered SVG in a self-contained HTML page with hover details and
// highlights, zoom and pan, and SVG/PNG downloads. No external requests.
//
// Hover works two ways. Data-map elements carry data-name/data-value. Posters
// pass `features`: named streets, waterways, parks and buildings with their
// screen geometry (see hover.mjs), found under the cursor with a grid index so
// even hairline streets can be picked. Either way the feature under the cursor
// is outlined in the theme's accent colour on an overlay that never reaches the
// downloaded SVG or PNG.
import { esc } from "./svg.mjs";

export function toHtml({ svg, width, height, title, dark = false, bg, fileBase = "map", features = [], accent = "#E8590C" }) {
  fileBase = String(fileBase).replace(/[^\w.-]+/g, "-") || "map";
  const page = dark ? "#0B0C0E" : "#ECEAE5";
  const ink = dark ? "#E9E6E0" : "#2A2723";
  const hl = /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : "#E8590C";
  // JSON inside <script> must not contain "</".
  const index = JSON.stringify(features).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ?? "Map")}</title>
<meta name="generator" content="map-design">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: ${page}; color: ${ink}; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: ${width}px; margin: 28px auto 40px; padding: 0 16px; }
  .bar { display: flex; gap: 8px; justify-content: flex-end; align-items: center; margin-bottom: 10px; }
  .bar span { margin-right: auto; opacity: .65; }
  button { font: inherit; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 6px; padding: 5px 12px; cursor: pointer; opacity: .78; }
  button:hover { opacity: 1; }
  .frame { position: relative; overflow: hidden; border-radius: 6px; background: ${bg ?? "transparent"}; box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 12px 40px rgba(0,0,0,.10); touch-action: none; }
  .frame svg { display: block; width: 100%; height: auto; transform-origin: 0 0; }
  .tip { position: fixed; pointer-events: none; padding: 6px 10px; border-radius: 6px; background: rgba(20,20,22,.92); color: #fff; font-size: 13px; opacity: 0; transition: opacity .08s; max-width: 280px; z-index: 2; }
  .tip b { font-weight: 600; }
  .tip span { opacity: .8; }
  [data-name]:hover { filter: brightness(1.08) saturate(1.1); cursor: default; }
  .hl * { pointer-events: none; }
  @media (prefers-reduced-motion: no-preference) { .route { stroke-dashoffset: 0; } }
</style>
</head>
<body>
<main>
  <div class="bar"><span>Scroll with ⌘/Ctrl to zoom · drag to pan · double-click to reset</span><button data-act="svg">Download SVG</button><button data-act="png">Download PNG</button></div>
  <div class="frame">${svg}</div>
</main>
<div class="tip" role="status"></div>
<script type="application/json" id="map-features">${index}</script>
<script>
(() => {
  const frame = document.querySelector(".frame");
  const svg = frame.querySelector("svg");
  const tip = document.querySelector(".tip");
  let drag = null;
  const source = svg.outerHTML;
  // Hover: data-name elements first, then the feature index (posters).
  for (const el of svg.querySelectorAll("[data-name]")) el.querySelector(":scope > title")?.remove();
  const NS = "http://www.w3.org/2000/svg";
  const HL = ${JSON.stringify(hl)};
  const VB = svg.viewBox.baseVal;
  const layer = document.createElementNS(NS, "g");
  layer.setAttribute("class", "hl");
  const items = JSON.parse(document.getElementById("map-features").textContent);
  // Decode [x0, y0, dx, dy, …] in tenths of a unit into flat coordinate arrays.
  for (const it of items) {
    it.g = it.g.map((enc) => {
      const pts = new Float32Array(enc.length);
      let x = 0, y = 0;
      for (let i = 0; i < enc.length; i += 2) { x += enc[i]; y += enc[i + 1]; pts[i] = x / 10; pts[i + 1] = y / 10; }
      return pts;
    });
    if (it.k === "a") {
      it.area = 0;
      for (const r of it.g) { let a = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] + r[i]) * (r[j + 1] - r[i + 1]); it.area += Math.abs(a / 2); }
    }
  }
  // Grid index over segment and ring bounding boxes.
  const CELL = 24, cols = Math.ceil(VB.width / CELL) + 1;
  const grid = new Map();
  const put = (i, x0, y0, x1, y1) => {
    const c0 = Math.max(0, Math.floor(x0 / CELL)), c1 = Math.floor(x1 / CELL);
    const r0 = Math.max(0, Math.floor(y0 / CELL)), r1 = Math.floor(y1 / CELL);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const k = r * cols + c, list = grid.get(k);
      if (!list) grid.set(k, [i]); else if (list[list.length - 1] !== i) list.push(i);
    }
  };
  items.forEach((it, i) => {
    for (const p of it.g) {
      if (it.k === "l") {
        for (let j = 2; j < p.length; j += 2) put(i, Math.min(p[j - 2], p[j]), Math.min(p[j - 1], p[j + 1]), Math.max(p[j - 2], p[j]), Math.max(p[j - 1], p[j + 1]));
      } else {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let j = 0; j < p.length; j += 2) { x0 = Math.min(x0, p[j]); x1 = Math.max(x1, p[j]); y0 = Math.min(y0, p[j + 1]); y1 = Math.max(y1, p[j + 1]); }
        put(i, x0, y0, x1, y1);
      }
    }
  });
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const inside = (it, x, y) => {
    let n = false;
    for (const r of it.g) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) n = !n;
    }
    return n;
  };
  // A line within half the reach wins over the area the cursor is in; past that
  // the area wins. Among areas the smallest one containing the point wins, so a
  // building inside a park is found before the park.
  function pick(x, y, tol) {
    const seen = new Set();
    let best = null, score = Infinity;
    const c0 = Math.floor((x - tol) / CELL), c1 = Math.floor((x + tol) / CELL);
    const r0 = Math.floor((y - tol) / CELL), r1 = Math.floor((y + tol) / CELL);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      for (const i of grid.get(r * cols + c) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const it = items[i];
        let s = Infinity;
        if (it.k === "l") {
          for (const p of it.g) for (let j = 2; j < p.length; j += 2) s = Math.min(s, segDist(x, y, p[j - 2], p[j - 1], p[j], p[j + 1]));
          if (s > tol) s = Infinity;
        } else if (inside(it, x, y)) s = tol / 2 + it.area / 1e12;
        if (s < score) { score = s; best = it; }
      }
    }
    return best;
  }
  const shapeOf = (it) => {
    let d = "";
    for (const p of it.g) {
      d += "M" + p[0] + "," + p[1];
      for (let j = 2; j < p.length; j += 2) d += "L" + p[j] + "," + p[j + 1];
      if (it.k === "a") d += "Z";
    }
    const path = (stroke, w, fill, op) => {
      const e = document.createElementNS(NS, "path");
      e.setAttribute("d", d);
      e.setAttribute("fill", fill);
      if (op) e.setAttribute("fill-opacity", op);
      e.setAttribute("stroke", stroke);
      e.setAttribute("stroke-width", w);
      e.setAttribute("stroke-linecap", "round");
      e.setAttribute("stroke-linejoin", "round");
      e.setAttribute("vector-effect", "non-scaling-stroke");
      return e;
    };
    return it.k === "l"
      ? [path("rgba(0,0,0,.45)", 7, "none"), path(HL, 4, "none")]
      : [path(HL, 2.5, HL, 0.32)];
  };
  // Outline a data-name element with a copy drawn on top of it.
  const cloneOf = (el) => {
    if (!/^(path|circle|rect|polygon|polyline|ellipse|line)$/.test(el.tagName)) return [];
    const c = el.cloneNode(false);
    c.removeAttribute("data-name");
    c.removeAttribute("class");
    c.setAttribute("stroke", HL);
    c.setAttribute("stroke-width", 2.5);
    c.setAttribute("stroke-opacity", 1);
    c.setAttribute("vector-effect", "non-scaling-stroke");
    if (el.getAttribute("fill") && el.getAttribute("fill") !== "none") c.setAttribute("fill-opacity", 0);
    return [c];
  };
  let current = null;
  function show(target, e, name, info) {
    if (target !== current) {
      current = target;
      layer.replaceChildren();
      if (target) {
        const shapes = target.g ? shapeOf(target) : cloneOf(target);
        if (target.g) { layer.append(...shapes); svg.append(layer); }
        else if (shapes.length) { layer.append(...shapes); target.after(layer); }
      }
    }
    if (!target) { tip.style.opacity = 0; return; }
    tip.innerHTML = "<b></b>" + (info ? "<br><span></span>" : "");
    tip.querySelector("b").textContent = name;
    if (info) tip.querySelector("span").textContent = info;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + "px"; tip.style.top = (e.clientY + 14) + "px"; tip.style.opacity = 1;
  }
  svg.addEventListener("pointermove", (e) => {
    if (drag) return;
    const el = e.target.closest("[data-name]");
    if (el && el.dataset.name) return show(el, e, el.dataset.name, el.dataset.value);
    if (!items.length) return show(null, e);
    const r = svg.getBoundingClientRect();
    const k = VB.width / r.width;
    const x = VB.x + (e.clientX - r.left) * k, y = VB.y + (e.clientY - r.top) * k;
    const it = pick(x, y, 6 * k);
    show(it, e, it?.n, it?.i);
  });
  svg.addEventListener("pointerleave", (e) => show(null, e));
  // Zoom and pan with CSS transforms.
  let k = 1, tx = 0, ty = 0;
  const apply = () => (svg.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + k + ")");
  frame.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const r = frame.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const nk = Math.min(12, Math.max(1, k * Math.exp(-e.deltaY * 0.0022)));
    tx = px - (px - tx) * (nk / k); ty = py - (py - ty) * (nk / k); k = nk;
    if (k === 1) { tx = 0; ty = 0; }
    apply();
  }, { passive: false });
  frame.addEventListener("pointerdown", (e) => { if (k > 1) { drag = [e.clientX - tx, e.clientY - ty]; frame.setPointerCapture(e.pointerId); } });
  frame.addEventListener("pointermove", (e) => { if (drag) { tx = e.clientX - drag[0]; ty = e.clientY - drag[1]; apply(); } });
  frame.addEventListener("pointerup", () => (drag = null));
  frame.addEventListener("dblclick", () => { k = 1; tx = 0; ty = 0; apply(); });
  // Downloads.
  const save = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  document.querySelector('[data-act="svg"]').onclick = () => save(new Blob([source], { type: "image/svg+xml" }), ${JSON.stringify(fileBase)} + ".svg");
  document.querySelector('[data-act="png"]').onclick = () => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = ${width} * 2; c.height = ${height} * 2;
      const g = c.getContext("2d"); g.scale(2, 2); g.drawImage(img, 0, 0, ${width}, ${height});
      c.toBlob((b) => save(b, ${JSON.stringify(fileBase)} + ".png"), "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
  };
})();
</script>
</body>
</html>
`;
}
