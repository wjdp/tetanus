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

A hard-disk platter, flat, single colour, no gradients:

- Outer circle (platter), inner circle (hub), one actuator arm from the lower-right
  corner ending in a small head over the platter. Stroke-based, 2 px at 24 px, round
  caps, so it sits with lucide icons.
- Rust accent: the head is a filled dot in primary; everything else is `currentColor`.
  At favicon sizes drop the arm and keep platter + hub + dot.
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
| `error` | `rose` | Failed attribute or disk, pool FAULTED/UNAVAIL, missing disk. Cool red, distinct from rust. |
| `warning` | `amber` | Warning attribute, DEGRADED, scrub with errors, accepted-but-risen. |
| `success` | `emerald` | Recovery notices and explicit "all clear" only. Never the default tile colour. |
| `info` | `sky` | Scrub/resilver in progress, informational banners. |
| `secondary` | `stone` | Unused; alias to neutral so nothing accidentally introduces a second brand hue. |

Rust palette (oxidised iron, sits between red and orange, main step 500):

```
--color-rust-50:  #fdf4f0;  --color-rust-500: #d3512f;
--color-rust-100: #fbe5db;  --color-rust-600: #b53e22;
--color-rust-200: #f6c8b5;  --color-rust-700: #93321d;
--color-rust-300: #eea287;  --color-rust-800: #772b1d;
--color-rust-400: #e37658;  --color-rust-900: #62261b;
                            --color-rust-950: #35100a;
```

Rules that keep red from being overused:

0. **Bright red means failing, nothing else.** `rose` appears only on a failed state. Rust
   is warm and muted by comparison and must never be pushed towards a saturated red.
1. **Primary never carries status.** Topology tiles, attribute rows, chips and charts use
   `error`/`warning`/`success`/`info` or neutral. A rust tile would read as a fault.
2. **Passed is quiet.** Healthy disks and pools are neutral surfaces with a small
   `success` dot, not green cards. The home screen should be mostly stone; anything red
   or amber on it is a problem.
3. **One primary action per view.** Everything else is `neutral` `ghost`/`soft`.
4. **Dark mode first.** Default to system, but design in dark and check light. Rust 500
   on dark, rust 600 on light; check contrast ≥ 4.5:1 for text uses.
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
UI section.
