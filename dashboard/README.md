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
- `app/` — the dashboard application script, split into numbered per-screen/component modules
  (`00-dom.js`, `01-messages.js`, … `20-start.js`). `build.mjs` reads them in filename order and
  concatenates them into the main `<script>`.
- `build.mjs` — assembles the above into `docs/admin.html`.

### The `app/` modules

The script is one program split across files only for editing; they share one scope once concatenated (no imports
between them), so order matters and is fixed by the numeric prefix. Foundations come first (DOM helpers, messaging,
address rules, config, crypto, the save outbox, data decoding, logs, state, shared UI), then one module per screen
(navigation, sign-in, account, requests, sites, phones, settings, timers, protection, messages), then `20-start.js`
boots the app. The files are cut at exact line boundaries so concatenating them reproduces the previous single-file
`app.js` byte-for-byte; keep that true — a change belongs inside the module whose concern it is, and the rebuilt
`docs/admin.html` is what must stay correct.
