---
type: reference
---

# Branding and colour

Decided 2026-09-28. The name is **tetanus**: a nod to spinning rust, playful for a home
enthusiast tool. The playfulness lives in the name and the mark. UI copy stays plain: a
disk with pending sectors is not a joke.

## Name

- Lowercase `tetanus` in prose, wordmark and package names. `Tetanus` only at the start
  of a sentence.
- `APP_NAME` in `shared/app.ts` is the single source. Derived names: image
  `ghcr.io/wjdp/tetanus`, host script `tetanus-collect`, unit `tetanus-collect.timer`,
  ZED hook `all-tetanus.sh`, ingest header `Tetanus-Host` (no `X-` prefix; RFC 6648).
- Fixture scrub salt keeps its historical value so already-committed fakes stay stable;
  only the env var is renamed.

## Mark

A hard-disk platter, flat, single colour, no gradients. Chosen 2026-09-28 from six
options; the actuator-arm variants were dropped because the head collided with the hub at
small sizes.

- Outer circle (platter) and inner circle (hub), stroke-based, 2 px at 24 px, round
  caps, so it sits with lucide icons. Everything in `currentColor`.
- Rust: a quarter-arc on the platter at mid-radius, from 12 o'clock to 3 o'clock, a worn
  track. Stroke 2.5 at 24 px, 3 at 16 px. It is the only colour.
- Geometry, viewBox `0 0 24 24`: platter `circle cx=12 cy=12 r=9`; hub
  `circle cx=12 cy=12 r=2.5`; track `path d="M12 6a6 6 0 0 1 6 6"` in `primary`.
- Wordmark: `tetanus` in Inter semibold, tracking tight, mark to the left at cap height.
- Delivered as `app/components/TetanusMark.vue` (inline SVG, `size` prop) and
  `public/favicon.svg` (+ 32 px PNG for old browsers, apple-touch 180 px). Replaces the
  `i-lucide-hard-drive` placeholder in the sidebar header.

## Colour

Nuxt UI 4 colour aliases; Tailwind 4 `@theme` for the custom palette.

| Alias | Palette | Use |
| --- | --- | --- |
| `primary` | `rust` (custom, below) | Brand mark dot, active nav indicator, primary button, focus ring, links on hover. Nothing else. |
| `neutral` | `stone` | Surfaces, borders, body text. Warm to sit with rust. |
| `error` | `alarm` (custom, below) | Failed attribute or disk, pool FAULTED/UNAVAIL, missing disk. Pure red, unmistakable next to rust. |
| `warning` | `amber` | Warning attribute, DEGRADED, scrub with errors, accepted-but-risen. |
| `success` | `emerald` | Recovery notices and explicit "all clear" only. Never the default tile colour. |
| `info` | `sky` | Scrub/resilver in progress, informational banners. |
| `secondary` | `stone` | Unused; alias to neutral so nothing accidentally introduces a second brand hue. |

Which alias each status, state and lifecycle bucket takes, with dot shape and icon, is the
[037 status and icon vocabulary](037-Status-and-icon-vocabulary.md). This table names the
palette; 037 names the rules per status.

Rust palette (desaturated oxide, main step 500). Decided 2026-09-28 against a swatch page;
the more vivid `#d3512f`, a redder and an oranger candidate were rejected as too loud:

```
--color-rust-50:  #fbf4f1;  --color-rust-500: #b5543a;
--color-rust-100: #f5e4de;  --color-rust-600: #9a4530;
--color-rust-200: #eac7bb;  --color-rust-700: #7d3928;
--color-rust-300: #dba28f;  --color-rust-800: #653022;
--color-rust-400: #c97a61;  --color-rust-900: #52291f;
                            --color-rust-950: #2c130e;
```

Alarm palette (pure red for failed; 500 is `#ff0000`; text on light backgrounds uses 600
or darker because 500 on white is 4.0:1):

```
--color-alarm-50:  #fff0f0;  --color-alarm-500: #ff0000;
--color-alarm-100: #ffdcdc;  --color-alarm-600: #d90000;
--color-alarm-200: #ffb8b8;  --color-alarm-700: #b00000;
--color-alarm-300: #ff8585;  --color-alarm-800: #8c0000;
--color-alarm-400: #ff4747;  --color-alarm-900: #700000;
                             --color-alarm-950: #3d0000;
```

Rules that keep red from being overused:

0. **Bright red means failing, nothing else.** `alarm` appears only on a failed state. Rust
   is warm and muted by comparison and must never be pushed towards a saturated red.
1. **Primary never carries status.** Topology tiles, attribute rows, chips and charts use
   `error`/`warning`/`success`/`info` or neutral. A rust tile would read as a fault.
2. **Passed is quiet.** Healthy disks and pools are neutral surfaces with a small
   `success` dot, not green cards. Confirmed against the swatch page. The home screen should be mostly stone; anything red
   or amber on it is a problem. `ONLINE` is the other green: ZFS's own word for healthy,
   rendered `success` as text or a subtle badge, never a surface.
3. **One primary action per view.** Everything else is `neutral` `ghost`/`soft`.
4. **Dark mode first.** Default to system, but design in dark and check light. Fills
   (buttons, nav bar, mark dot) use rust 500 on dark and 600 on light. Text and links use
   rust 400 on dark (500 is 4.0:1 on stone 950, below AA) and 600 on light (6.4:1).
5. **Charts** pick a categorical palette in Phase 6 (dataviz skill); rust is reserved and
   is not a series colour. Status thresholds on charts use the status aliases.

## Type

Inter for UI, JetBrains Mono for serials, WWNs, device paths, hex, raw smartctl. Numbers
in tables are tabular figures (`font-variant-numeric: tabular-nums`).

## Voice

Plain, terse, British. Aliases are the subject ("K2 pending sectors 16, stable 14
months"). Empty states may be light ("No rust yet. Install a collector."); alerts and
status text never are.

## Related

[001](001-Product-goals.md) decision table, [003](003-Architecture-and-data-model.md)
UI section, [037](037-Status-and-icon-vocabulary.md) per-status colour, shape and icon.
