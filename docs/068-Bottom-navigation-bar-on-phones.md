---
type: task
status: todo
---

# Bottom navigation bar on phones

Give phones a bottom tab bar for the main sections, so the installed app
([043](043-Installable-PWA.md)) is navigable by thumb without the sidebar drawer.

## Problem

On phones the only navigation is the `UDashboardSidebar` drawer, opened from the
hamburger in `AppPanel`'s navbar at the top of the screen. That is out of thumb reach,
two taps for any section switch, and hides the fault counts until opened. Installed
standalone there is no browser back button either, so the drawer is the only way out
of a detail page.

`NAVIGATION` in `app/utils/navigation.ts` has eight entries (Topology, Faults, Hosts,
Disks, ZFS, Replications, Diary, Settings). Bottom bars hold three to five
(Material: 3–5; Apple HIG: up to 5 on iPhone).

## Approach

- `AppBottomNav.vue` in the default layout, below the content, shown below the `lg`
  breakpoint (where the sidebar collapses to a drawer); sidebar unchanged above it.
- Five slots: four primary sections plus **More**, which opens the existing sidebar
  drawer (`useDashboard().sidebarOpen` or equivalent), so every section stays reachable.
- Primary sections marked in `NAVIGATION` (e.g. `bottomNav: true`) rather than a second
  list; candidates: Topology, Faults, Disks, ZFS. Order follows `NAVIGATION`.
- Badges: the worst-status chip the collapsed sidebar already uses (`worstColour` over
  `useNavigationCounts`), not full counts; extract it to share.
- Active state as the sidebar (`exact` for `/`); icon plus short label, `aria-current`.
- Theme colour ([043](043-Installable-PWA.md)) only covers the top; bar background is
  `bg-elevated` with a top border, matching the sidebar.

## Constraints and gotchas

- **iPhone home indicator:** a fixed bar at the bottom sits under the home indicator in
  standalone mode unless padded with `env(safe-area-inset-bottom)`, which is only
  non-zero with `viewport-fit=cover`. 043 ruled out `viewport-fit=cover`; check on a
  device whether the default letterboxing is enough, otherwise add `viewport-fit=cover`
  and pad the bar (and only the bar: top stays default so nothing sits under the notch).
- Content must not be hidden behind the bar: pad the scroll container by the bar height.
- Fault, demo and simulation banners stay at the top.
- Command palette and the hamburger stay; the bar is an addition, not a replacement.
- Not in desktop or tablet widths, even when installed.

## Done when

- At phone width every page is reachable from the bar or More, and the bar marks the
  active section.
- Badge chips match the sidebar's.
- Nothing hidden under the bar or the home indicator on an installed iPhone.
- `pnpm lint:ci`, `pnpm typecheck`, `pnpm test` green; component test for active state,
  chips and More opening the drawer.

## Questions

- Which four sections? Topology, Faults, Disks, ZFS proposed; Hosts and Diary are the
  other candidates.
- Labels under icons, or icons only?
- Hide the top hamburger on phones once More exists?
