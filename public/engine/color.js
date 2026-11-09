// WCAG 2.x contrast math and minimal-change color repair.

export function parseColor(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.slice(0, 3).some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}

export function toHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function channel(v) {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: hue(p, q, h + 1 / 3) * 255, g: hue(p, q, h) * 255, b: hue(p, q, h - 1 / 3) * 255 };
}

function rounded(c) {
  return { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) };
}

/**
 * Find the color closest to `fg` (same hue and saturation, lightness moved as little
 * as possible) that reaches `target` contrast against `bg`.
 * Returns { color, ratio } or null if impossible in that hue.
 */
export function repairColor(fg, bg, target = 4.5) {
  const goal = target + 0.08; // small margin so rounding never lands below the threshold
  if (contrast(fg, bg) >= goal) return { color: rounded(fg), ratio: contrast(fg, bg) };
  const hsl = rgbToHsl(fg);
  const candidates = [];
  for (const dir of [-1, 1]) {
    const end = dir < 0 ? 0 : 1;
    const extreme = rounded(hslToRgb({ ...hsl, l: end }));
    if (contrast(extreme, bg) < goal) continue;
    let lo = hsl.l, hi = end; // lo fails, hi passes
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (contrast(rounded(hslToRgb({ ...hsl, l: mid })), bg) >= goal) hi = mid; else lo = mid;
    }
    const color = rounded(hslToRgb({ ...hsl, l: hi }));
    candidates.push({ color, ratio: contrast(color, bg), shift: Math.abs(hi - hsl.l) });
  }
  if (!candidates.length) {
    for (const c of [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }]) {
      if (contrast(c, bg) >= target) return { color: c, ratio: contrast(c, bg) };
    }
    return null;
  }
  candidates.sort((a, b) => a.shift - b.shift);
  const { color, ratio } = candidates[0];
  return { color, ratio };
}

export function isNeutralExtreme(c) {
  const { s, l } = rgbToHsl(c);
  return s < 0.15 && (l > 0.9 || l < 0.1);
}
