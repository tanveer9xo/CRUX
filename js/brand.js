// CRUX brand: the name and its mark (two strokes crossing at the crux), in one place.
// Pure strings, so tools/build-icons.mjs can render PNG icons from it in Node and a test can check the splash.
export const APP_NAME = 'CRUX';
export const BRAND = { ground: '#0E1116', a: '#3DDC97', b: '#8FB8FF' };

// Drawn on a 512 grid; everything sits within r ≈ 190 of the centre, inside the maskable safe zone.
const MARK = [
  `<path d="M156 156L356 356" fill="none" stroke="${BRAND.b}" stroke-width="64" stroke-linecap="round"/>`,
  `<path d="M356 156L156 356" fill="none" stroke="${BRAND.a}" stroke-width="64" stroke-linecap="round"/>`,
].join('');

export function markSVG({ ground = 'rounded', scale = 1, size = null, attrs = '' } = {}) {
  const bg = ground === 'rounded' ? `<rect width="512" height="512" rx="112" fill="${BRAND.ground}"/>`
    : ground === 'square' ? `<rect width="512" height="512" fill="${BRAND.ground}"/>` : '';
  const off = Math.round(256 * (1 - scale) * 1000) / 1000;
  const mark = scale === 1 ? MARK : `<g transform="translate(${off} ${off}) scale(${scale})">${MARK}</g>`;
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"${dim}${attrs ? ` ${attrs}` : ''}>${bg}${mark}</svg>`;
}

export function splashHTML() {
  return `<div id="splash" class="splash" aria-hidden="true">${markSVG({ size: 72 })}<span class="wordmark">${APP_NAME}</span></div>`;
}
