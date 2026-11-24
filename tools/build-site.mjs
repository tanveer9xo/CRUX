// Assembles the deployable site: only the app files, nothing from tests/, tools/ or docs.
//   node tools/build-site.mjs [outDir]      (default: _site)
// Used by the Pages workflow and by tests/browser/app.mjs, so the browser test checks exactly what ships.
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SITE_FILES = ['index.html', 'manifest.webmanifest', 'sw.js', '.nojekyll', 'css', 'js', 'icons'];

/** The precache list from sw.js, without the leading "./". */
export function precacheList() {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const list = sw.slice(sw.indexOf('const ASSETS'), sw.indexOf('];', sw.indexOf('const ASSETS')));
  return [...new Set([...list.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean))];
}

export function buildSite(out = join(ROOT, '_site')) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of SITE_FILES) cpSync(join(ROOT, f), join(out, f), { recursive: true });
  // Every file the service worker precaches must be in the site, or installing it fails.
  const assets = precacheList();
  const missing = assets.filter((a) => !existsSync(join(out, a)));
  if (missing.length) throw new Error(`Precached but not in the site: ${missing.join(', ')}`);
  return { out, assets };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { out, assets } = buildSite(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log(`Site built in ${out} (${assets.length} precached files present)`);
}
