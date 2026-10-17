// Pole of inaccessibility: the point inside a polygon farthest from its edge,
// with that distance. Used to put area labels where they actually fit.
// After the polylabel algorithm by Vladimir Agafonkin (Mapbox, ISC license).

function pointToSegmentDistSq(px, py, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) [x, y] = b;
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}

function signedDist(x, y, polygon) {
  let inside = false;
  let min = Infinity;
  for (const ring of polygon) {
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      min = Math.min(min, pointToSegmentDistSq(x, y, a, b));
    }
  }
  return min === 0 ? 0 : (inside ? 1 : -1) * Math.sqrt(min);
}

function cell(x, y, h, polygon) {
  const d = signedDist(x, y, polygon);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
}

export function polylabel(polygon, precision = 1) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon[0]) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const hgt = maxY - minY;
  const size = Math.min(w, hgt);
  if (size === 0) return { x: minX, y: minY, r: 0 };
  let h = size / 2;
  const queue = [];
  for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) queue.push(cell(x + h, y + h, h, polygon));
  let best = cell(minX + w / 2, minY + hgt / 2, 0, polygon);
  let guard = 0;
  while (queue.length && guard++ < 20000) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[bi].max) bi = i;
    const c = queue.splice(bi, 1)[0];
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    h = c.h / 2;
    queue.push(cell(c.x - h, c.y - h, h, polygon), cell(c.x + h, c.y - h, h, polygon), cell(c.x - h, c.y + h, h, polygon), cell(c.x + h, c.y + h, h, polygon));
  }
  return { x: best.x, y: best.y, r: Math.max(0, best.d) };
}

/**
 * Parse an SVG path made of M/L/Z commands (what d3-geo emits for polygons)
 * into rings, group them into polygons by containment, and return the best
 * label point across the polygons: { x, y, r }.
 */
export function labelPointFromPath(d) {
  if (!d) return null;
  const rings = [];
  let ring = null;
  const re = /([MLZ])([^MLZ]*)/g;
  let m;
  while ((m = re.exec(d))) {
    if (m[1] === "M") {
      if (ring?.length > 2) rings.push(ring);
      ring = [];
    }
    if (m[1] === "Z") {
      if (ring?.length > 2) rings.push(ring);
      ring = null;
      continue;
    }
    const nums = m[2].split(/[ ,]+/).filter(Boolean).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) ring?.push([nums[i], nums[i + 1]]);
  }
  if (ring?.length > 2) rings.push(ring);
  if (!rings.length) return null;
  const area = (r) => {
    let s = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
    return s / 2;
  };
  // Largest rings are outer shells; smaller rings inside them are holes.
  const sorted = rings.map((r) => ({ r, a: Math.abs(area(r)) })).sort((a, b) => b.a - a.a);
  const shells = sorted.slice(0, 4);
  let best = null;
  for (const s of shells) {
    const holes = sorted.filter((o) => o !== s && o.a < s.a && signedDist(o.r[0][0], o.r[0][1], [s.r]) > 0).map((o) => o.r);
    const p = polylabel([s.r, ...holes], 0.5);
    if (!best || p.r > best.r) best = p;
  }
  return best;
}
