// Wraps a rendered SVG in a self-contained HTML page with hover tooltips,
// zoom and pan, and SVG/PNG downloads. No external requests.
import { esc } from "./svg.mjs";

export function toHtml({ svg, width, height, title, dark = false, bg, fileBase = "map" }) {
  fileBase = String(fileBase).replace(/[^\w.-]+/g, "-") || "map";
  const page = dark ? "#0B0C0E" : "#ECEAE5";
  const ink = dark ? "#E9E6E0" : "#2A2723";
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
  [data-name]:hover { filter: brightness(1.08) saturate(1.1); cursor: default; }
  @media (prefers-reduced-motion: no-preference) { .route { stroke-dashoffset: 0; } }
</style>
</head>
<body>
<main>
  <div class="bar"><span>Scroll with ⌘/Ctrl to zoom · drag to pan · double-click to reset</span><button data-act="svg">Download SVG</button><button data-act="png">Download PNG</button></div>
  <div class="frame">${svg}</div>
</main>
<div class="tip" role="status"></div>
<script>
(() => {
  const frame = document.querySelector(".frame");
  const svg = frame.querySelector("svg");
  const tip = document.querySelector(".tip");
  const source = svg.outerHTML;
  // Tooltips: use data-name/data-value; drop native <title> popups on those elements.
  for (const el of svg.querySelectorAll("[data-name]")) el.querySelector(":scope > title")?.remove();
  svg.addEventListener("pointermove", (e) => {
    const el = e.target.closest("[data-name]");
    if (!el || !el.dataset.name) { tip.style.opacity = 0; return; }
    tip.innerHTML = "<b></b>" + (el.dataset.value ? "<br><span></span>" : "");
    tip.querySelector("b").textContent = el.dataset.name;
    if (el.dataset.value) tip.querySelector("span").textContent = el.dataset.value;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + "px"; tip.style.top = (e.clientY + 14) + "px"; tip.style.opacity = 1;
  });
  svg.addEventListener("pointerleave", () => (tip.style.opacity = 0));
  // Zoom and pan with CSS transforms.
  let k = 1, tx = 0, ty = 0, drag = null;
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
