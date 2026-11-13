// Builds docs/admin.html (the dashboard that GitHub Pages serves and the app's in-app admin bundles) from the source
// modules in this folder. Run it after changing any source file:  node dashboard/build.mjs
//
// This is the first step of splitting the dashboard into small, reusable pieces. For now it only lifts the CSS and the
// app script out of one 5.7k-line file; the output is byte-identical to the hand-maintained admin.html. Later steps
// split app.js into per-screen/component modules (concatenated here) without changing the output's behavior.
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
const app = read('app.js');

// Function replacers so `$`-sequences in the CSS/JS are inserted literally, not treated as replacement patterns.
const out = template
  .replace('/*__LAZERLOCK_STYLES__*/', () => css)
  .replace('/*__LAZERLOCK_APP__*/', () => app);

const target = path.join(dir, '..', 'docs', 'admin.html');
fs.writeFileSync(target, out);
console.log(`Built docs/admin.html (${out.length} bytes, ${out.split('\n').length} lines).`);
