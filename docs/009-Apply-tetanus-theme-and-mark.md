---
type: task
status: done
---

# Apply tetanus theme and mark

Applies [008](008-Branding-and-colour.md) (branding and colour spec) to the Phase 1
scaffold: palettes, Nuxt UI colour aliases, the mark, favicons.

## Scope

1. `rust` and `alarm` palettes in `app/assets/css/main.css`'s `@theme static` block,
   plus a `tabular` utility for table numerics.
2. Nuxt UI colour aliases in `app/app.config.ts`: `primary: rust`, `neutral:
   secondary: stone`, `error: alarm`, `warning: amber`, `success: emerald`,
   `info: sky`.
3. `app/components/TetanusMark.vue` (platter, hub, optional arm and head), used in
   `AppSidebar.vue` in place of the `i-lucide-hard-drive` placeholder.
4. Favicons in `public/`, wired into `nuxt.config.ts`'s `app.head.link`.

## Findings

- **No `nuxt.config.ts` `ui.theme.colors` change needed.** Nuxt UI 4's colour plugin
  (`@nuxt/ui/dist/runtime/plugins/colors.js`) emits `--ui-color-{alias}-{shade}: var(--color-{palette}-{shade}, <tailwind fallback>)` for every key in `app.config.ts`'s
  `ui.colors`. `resolveColors()` only needs new names in `ui.theme.colors` when
  introducing an alias beyond Nuxt UI's default set (`primary`, `secondary`, `success`,
  `info`, `warning`, `error`, `neutral`); this spec reuses those existing alias keys and
  just points them at custom palettes (`rust`, `alarm`) declared as Tailwind theme
  variables in `main.css`. Confirmed by grepping the `pnpm build` output CSS
  (`.output/public/_nuxt/*.css`) for `rust-500` and the palette's hex value.
- **Rust ramp was revised mid-task.** The spec's original 500 (`#d3512f`) was replaced
  with a muted ramp (500 `#b5543a`) partway through; `main.css` was committed once with
  the old values and once as a follow-up `Theme:` commit with the new ones, before
  anything downstream (mark, favicons) was built on it.
- **Dark-mode text/links should use rust 400, not 500.** Rust 500 on stone 950 is
  ~4.0:1, under the 4.5:1 text threshold in 008 rule 4; 400 clears it. Fills (mark
  head, buttons, focus rings) stay 500 as specced. Not yet applied anywhere — no
  dark-mode text currently uses `text-primary`; flagged here for whoever adds the
  first one.
- **Mark is option C from the mark options page:** platter, hub and a rust quarter-arc
  track at mid-radius. The actuator-arm head from the first draft of 008 collided with
  the hub at 24 px and was replaced before merge; no `arm` prop survives.
- **Favicon renderer: `rsvg-convert`** (present on this machine). `inkscape` and
  ImageMagick `magick`/`convert` were also available but not needed. `sharp` is not a
  project dependency and was not installed. `apple-touch-icon.png` uses `rsvg-convert
  -b '#0c0a09'` for the background per 008, rendered from a copy of the SVG with the
  strokes swapped to `#f5f5f4`, since a PNG cannot carry the dark-mode media query.
- Everything in 008 was applied as written (bar the ramp/geometry revisions above);
  nothing was dropped.

## Done when

- `pnpm lint:ci`, `pnpm typecheck`, `pnpm test` and `pnpm build` are green with the
  new palettes, aliases, mark and favicons in place.
- `pnpm build` output CSS contains the current rust 500 hex and the sidebar header
  renders `TetanusMark` instead of the lucide hard-drive icon.
