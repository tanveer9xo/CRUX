// Icon picker (about 40 icons, searchable by name) and colour swatches, for the category and goal editors.
import { h, icon, chipStyle, badge } from '../ui.js';
import { PICKER_ICONS } from '../icons.js';
import { COLORS } from '../seed.js';

const label = (key) => key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * { node, get(): { icon, color } }: a live preview, a search box, the icon grid and the colour swatches.
 * Choosing updates the preview and the selected icon's tint straight away.
 */
export function iconAndColor({ icon: startIcon = 'tag', color: startColor = COLORS[0], name = '' } = {}) {
  let chosen = startIcon;
  let color = startColor;
  const preview = h('div', { class: 'preview-row' });
  const grid = h('div', { class: 'picker-grid', role: 'radiogroup', 'aria-label': 'Icon', id: 'icon-grid' });
  const search = h('input', { type: 'search', class: 'input', id: 'icon-search', placeholder: 'Search icons, e.g. cat, fuel, travel', 'aria-label': 'Search icons', autocomplete: 'off', oninput: () => draw() });
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' });

  const drawPreview = () => preview.replaceChildren(badge({ icon: chosen, color }, 'badge badge-lg'), h('span', { class: 'muted small' }, `${label(chosen)}${name ? ` · ${name}` : ''}`));
  function draw() {
    const q = search.value.trim().toLowerCase();
    const list = PICKER_ICONS.filter(([k, words]) => !q || k.includes(q) || words.includes(q));
    grid.replaceChildren(...(list.length ? list.map(([k]) => h('button', {
      class: 'pick', type: 'button', role: 'radio', 'aria-checked': String(k === chosen), 'aria-label': label(k), dataset: { icon: k },
      style: k === chosen ? chipStyle(color) : undefined,
      onclick: () => { chosen = k; draw(); drawPreview(); },
    }, icon(k))) : [h('p', { class: 'pick-empty' }, 'No icon matches. Try another word.')]));
    swatches.replaceChildren(...COLORS.map((c, i) => h('button', {
      class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(c.toLowerCase() === color.toLowerCase()), 'aria-label': `Colour ${i + 1}`, style: { '--c': c },
      onclick: () => { color = c; draw(); drawPreview(); },
    })));
  }
  draw();
  drawPreview();
  return {
    node: h('div', { class: 'picker' },
      h('span', { class: 'field-label' }, 'Icon'), preview, search, grid,
      h('span', { class: 'field-label' }, 'Colour'), swatches),
    get: () => ({ icon: chosen, color }),
  };
}
