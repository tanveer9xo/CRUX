// Colour maths for contrast checks and the category/goal chips. Pure: tests/color.test.js.
// WCAG 2.x relative luminance and contrast ratio; chips are a muted tint of the item's colour with the icon drawn in a
// version of that colour adjusted (only as far as needed) to reach 3:1 against the tint, in either theme.

export function hexToRgb(hex) {
  const v = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}
export const rgbToHex = (rgb) => `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Mix `a` into `b` by `t` (0 → b, 1 → a). */
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.map((c, i) => c * t + B[i] * (1 - t)));
}

/** The chip surfaces per theme (keep in step with --surface-2 in css/app.css; a test checks). */
export const CHIP_SURFACE = { dark: '#1E242D', light: '#F0F2F5' };
export const TINT = { dark: 0.16, light: 0.16 };

/**
 * { bg, fg } for a category/goal chip: bg is a low-saturation tint of the colour on the theme's surface; fg is the
 * colour itself, lightened (dark theme) or darkened (light theme) in small steps until it reaches 3:1 on bg.
 * Stored colours are never changed: this is display-time only.
 */
export function chipColors(hex, theme = 'dark') {
  const surface = CHIP_SURFACE[theme] ?? CHIP_SURFACE.dark;
  const bg = mix(hex, surface, TINT[theme] ?? TINT.dark);
  const toward = theme === 'light' ? '#000000' : '#FFFFFF';
  let fg = hex;
  for (let i = 1; contrast(fg, bg) < 3 && i <= 20; i++) fg = mix(toward, hex, i * 0.05);
  return { bg, fg };
}
