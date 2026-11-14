// Builds docs/admin.html (the dashboard that GitHub Pages serves and the app's in-app admin bundles) from the source
// modules in this folder. Run it after changing any source file:  node dashboard/build.mjs
//
// The dashboard is split into small source pieces: the CSS in styles.css, and the app script in per-screen/component
// modules under app/ (concatenated here in filename order). The output stays byte-identical to the previous
// hand-maintained admin.html; each split step is verified to leave docs/admin.html unchanged.
//
// The generated docs/admin.html is committed, so Pages and the APK build consume it directly with no build on their
// side. CI (dashboard-build.yml) rebuilds and fails if the committed output is stale — so the source is the source of
// truth and nobody hand-edits the generated file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const template = read('template.html');
const css = read('styles.css');

// The app script lives in numbered fragment files under app/. They are concatenated in filename order (00-, 01-, …),
// and each fragment already carries the newline that separated it from the next, so joining with no separator
// reproduces the original single-file app.js byte-for-byte.
const appDir = path.join(dir, 'app');
const app = fs.readdirSync(appDir)
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => fs.readFileSync(path.join(appDir, f), 'utf8'))
  .join('');

// Function replacers so `$`-sequences in the CSS/JS are inserted literally, not treated as replacement patterns.
const out = template
  .replace('/*__LAZERLOCK_STYLES__*/', () => css)
  .replace('/*__LAZERLOCK_APP__*/', () => app);

const target = path.join(dir, '..', 'docs', 'admin.html');
fs.writeFileSync(target, out);
console.log(`Built docs/admin.html (${out.length} bytes, ${out.split('\n').length} lines).`);
