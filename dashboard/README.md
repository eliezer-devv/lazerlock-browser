# Dashboard source

The admin dashboard is built from the modules in this folder into **`../docs/admin.html`** — the single file that
GitHub Pages serves and the Android app bundles into its in-app admin view.

## Editing

**Don't edit `docs/admin.html` directly** — it's generated. Edit the source here, then rebuild:

```
node dashboard/build.mjs
```

and commit both the source change and the regenerated `docs/admin.html`. CI (`dashboard-build.yml`) rebuilds and
fails if the committed `docs/admin.html` is out of sync with the source.

## Files

- `template.html` — the page shell (head, meta, header markup) with two markers:
  `/*__LAZERLOCK_STYLES__*/` and `/*__LAZERLOCK_APP__*/`.
- `styles.css` — all the dashboard CSS (inlined into the `<style>` block).
- `app.js` — the dashboard application script (inlined into the main `<script>`).
- `build.mjs` — concatenates the above into `docs/admin.html`.

This is an in-progress split (part of the refactor). `app.js` will be divided into per-screen/component modules that
`build.mjs` concatenates, with the output staying behavior-identical at each step.
