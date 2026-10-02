---
type: reference
---

# Status and icon vocabulary

Every status the app shows, with its colour, dot shape, icon and label, and every entity
type with its glyph. One table per enum so a page never invents its own mapping. Palette
and the rules on red are in [008](008-Branding-and-colour.md); this doc is what sits on
top of the palette. Decided 2026-09-29 against the topology screenshot; built by
[038](038-Home-page-redesign-and-status-vocabulary-rollout.md).

## Grammar

Three independent channels, never doubled up:

| Channel | Carries | Rule |
| --- | --- | --- |
| **Colour** | severity | `error` failing now, `warning` needs a look, `info` something running, `success` a positive assertion, `neutral` nothing to say. |
| **Shape** | certainty | Filled dot = a definite reading. Hollow ring = qualified: not measured, or measured and deliberately accepted. |
| **Icon** | kind | What a thing *is* (magnetic, mirror, host) or which *lifecycle bucket* it sits in. An icon never changes colour to carry status; the dot or badge next to it does. |

Green, restated for this doc: it appears in exactly two places. The filled `success`
dot for SMART `passed` (the one green per disk, 008 rule 2), and the word `ONLINE`
wherever ZFS state is rendered, because it is ZFS's own vocabulary and the conventional
colour for it. No green surfaces, no green icons, no green text elsewhere except
`improving` trends and recovery notices.

Red and amber on the home page always mean a problem that exists now. A disk that is
dead, sold or retired is history, not a problem: neutral.

## Dots

`TopologyStatusDot` grows a `shape` prop: `filled` (today) and `hollow` (2 px ring in the
same colour, transparent centre). 8 px in tiles and rails, 6 px inline in tables.

## SMART device status (`DeviceStatus`)

Worst of health, un-accepted attribute statuses (acknowledged ones count as `warning`). Shown as the disk's dot everywhere.

| status | colour | shape | badge label | where |
| --- | --- | --- | --- | --- |
| `passed` | success | filled | `SMART passed` | tile dot, rail dot, Disks status column, nameplate badge |
| `warning` | warning | filled | `SMART warning` | as above; one `smart-attribute` fault per attribute ([036](036-Faults-page.md)) |
| `failed` | error | filled | `SMART failed` | as above; `smart-attribute` faults, `smart-health-failed` when the drive says so |
| `unknown` | neutral | hollow | `SMART unknown` | never read, or `smartctl -n standby` skipped it |

## SMART attribute display status (`AttributeDisplayStatus`)

Per row in the attribute table and the accept dialog.

| status | colour | shape / icon | note |
| --- | --- | --- | --- |
| `passed` | neutral | no dot | row text default |
| `warning` | warning | filled dot | |
| `failed` | error | filled dot | |
| `acknowledged` | warning | filled dot; `i-lucide-eye` beside the acknowledged value | labelled `ack`, "ack at 16" in the value cell (full word in the tooltip); still a fault, the disk is amber ([042](042-Acknowledge-faults.md)) |
| `accepted` | warning | hollow dot; `i-lucide-shield-check` beside the accepted value | "accepted at 16" in the value cell; still amber so the reader knows it is a fault being watched |

Trend chip next to a non-passed attribute: `new` info, `worsening` warning, `stable`
neutral, `improving` success. Text only, no dot (`attributeTrendColour`).

## Lifecycle state (`EffectiveDiskState`)

Icon per state. The icon is the state's identity in rail group headers, the Disks table
state column, the disk page badge, and diary `state-changed` entries. Override shown as
the same badge with an `outline` variant and title "set by hand".
State judged as of an old scan (host silent, `stateAsOf` set) shown as the same badge
at reduced opacity with title "as of last scan 9 d ago"
([045](045-Silent-host-does-not-make-its-disks-missing.md)). Override wins.

| state | colour | icon | label | rail group |
| --- | --- | --- | --- | --- |
| `in-use` | neutral | `i-lucide-activity` | In use | only when not in a pool ("In use, not in a pool") |
| `spare` | neutral | `i-lucide-life-buoy` | Spare | Spare |
| `missing` | error | `i-lucide-search` | Missing | Missing; fault `disk-missing` |
| `removed` | neutral | `i-lucide-unplug` | Removed | Removed |
| `unseen` | neutral | `i-lucide-eye-off` | Unseen | Unseen |
| `dead` | neutral | `i-lucide-skull` | Dead | History (collapsed) |
| `retired` | neutral | `i-lucide-archive` | Retired | History (collapsed) |
| `sold` | neutral | `i-lucide-banknote` | Sold | History (collapsed) |

Change from today: `dead` drops from `error` to `neutral` (`diskStateColour`). It is an
override the user set on purpose; the skull carries the meaning and the home page stays
red-only-for-problems.

## ZFS state (`zfsStateColour`)

Applies to pool, vdev and leaf state strings everywhere: pool badge, vdev group label,
`VdevTreeTable`, ZFS pages, disk page membership, diary `pool-state-changed` and
`vdev-state-changed`. Always the upper-case word ZFS uses, never translated.

| state | colour | shape | note |
| --- | --- | --- | --- |
| `ONLINE` | success | text / subtle badge | change from today (was neutral) |
| `AVAIL` / `INUSE` | success | | a spare's healthy aux states: free, or standing in for a failed leaf |
| `DEGRADED` | warning | | fault `pool-degraded` at pool level |
| `OFFLINE` | warning | | administrative, still lost redundancy |
| `REMOVED` | warning | | |
| `FAULTED` | error | | |
| `UNAVAIL` | error | | |
| `SUSPENDED` | error | | |
| anything else | warning | | unknown word from a newer ZFS |

A leaf tile's dot is the worst of its disk's SMART status and its vdev state
(`tileColour`), so an `ONLINE` leaf on a `passed` disk shows one green dot, not two
signals.

Error counters on a leaf: `R n W n C n` in `error` mono text, only the non-zero ones,
only when any is non-zero. `slowIos > 0`: `S n` in `warning`.

## Pool capacity and fragmentation

| condition | colour |
| --- | --- |
| `cap` < 80 % | neutral bar |
| 80 % ≤ `cap` < 90 % | warning bar |
| `cap` ≥ 90 % | error bar; fault `pool-filling` when [018](018-Capacity-forecast.md) lands |
| `frag` | never coloured; text only |

Same thresholds for the per-vdev mini bar. Change from today: 80 % becomes a warning
(was 90 %); 90 % becomes an error because ZFS write performance falls off there.

## Scan (scrub / resilver)

| condition | colour | icon |
| --- | --- | --- |
| running | info text and thin info bar under the pool bar; host chip `i-lucide-loader` | |
| finished, `errors` = 0 | muted text "Last scrub <date> · 0 errors" | |
| finished, `errors` > 0 | warning text; fault `scan-errors` | |
| none recorded | dimmed "No scrub recorded" | |

Resilver running is `info` too: it is progress, not a fault; the `DEGRADED` badge beside
it carries the severity.

## Temperature

Coloured text only when hot; otherwise dimmed. Defaults in `shared/temperature.ts`,
overridable per host (`Host.temperatureThresholds`, Hosts settings page) so a warm
cupboard does not nag. `resolveTemperatureThresholds(host, media)` is the one function
the Disks table, tile, nameplate and charts call.

| media | warning | error |
| --- | --- | --- |
| `hdd` | ≥ 45 °C | ≥ 55 °C |
| `ssd` | ≥ 60 °C | ≥ 70 °C |
| `unknown` | HDD thresholds | |

Per-host override is the same four numbers, each optional; unset falls back to the
default.

Rendered `34°` in tiles (degree sign, no C, tabular), `34 °C` in tables and the
nameplate.

## Collector freshness (`FreshnessStatus`)

Host header chips, Hosts settings page.

| status | colour | note |
| --- | --- | --- |
| `ok` | neutral chip | within cadence |
| `warning` | warning chip | more than twice the cadence |
| `error` | error chip | never seen, or the group has no run at all; fault `collector-silent` when every group is non-ok |
| `offline` | one neutral chip `offline · last seen 9 d` in place of the group chips | `intermittent` hosts only, when every group is non-ok; no fault ([039](039-Intermittent-hosts.md)) |

Collector version (`collectorStatus`): `current` nothing shown, `outdated` warning fault,
`incompatible` error fault. No icon; the fault row carries the copyable command.

## Faults (`Fault.state`, `Fault.severity`)

| state | severity | gutter | nav badge, banner |
| --- | --- | --- | --- |
| `open` | `error` | 3 px `error` left border | counted, badge `error`; banner |
| `open` | `warning` | 3 px `warning` | not counted |
| `acknowledged` | any | 3 px `warning` | not counted |
| `accepted` | any | none | not counted |
| `resolved` | any | none, row at 60 % opacity, "resolved 3 d ago" | not counted |

Nav entry `i-lucide-siren` ([036](036-Faults-page.md)).

## Usage (`UsageKind`) and purpose (`Purpose`)

| value | colour | rendering |
| --- | --- | --- |
| usage `zfs` | info badge | pool name |
| usage `filesystem` | neutral badge | `ext4 /boot` |
| usage `empty` | neutral badge at 60 % opacity | `empty` |
| usage `unknown` | neutral badge | `?`; change from today (was warning): not knowing is not a problem, and a warning here pollutes the Disks table |
| purpose `system` | `sys` neutral outline badge, `xs` | modifier beside the alias on tiles and rail rows; the media glyph still shows what the disk is |
| purpose `other` | `other` neutral outline badge | as today |

## Warranty

| days left | colour |
| --- | --- |
| none recorded | dimmed `—` |
| expired | dimmed `expired` |
| < `WARRANTY_WARNING_DAYS` | warning text |
| otherwise | default text |

## Task state (`SseTask.state`)

Unchanged: `pending` neutral `i-lucide-clock`, `in_progress` info `i-lucide-loader`,
`done` success `i-lucide-check`, `failed` error `i-lucide-triangle-alert`.

## Media glyphs (`Media`)

The one place the brand leaks into the vocabulary.

| media | glyph | note |
| --- | --- | --- |
| `hdd` | `MediaGlyph` platter: `TetanusMark` geometry without the rust track, all `currentColor` | round; reads as spinning rust |
| `ssd` | `i-lucide-microchip` | square; contrasts with the platter at 16 px. NVMe vs SATA is an interface fact, shown in the tooltip and nameplate, not a glyph |
| `unknown` | none | |

Sizes: 16 px in tiles and rail rows, `text-muted`; 20 px in the nameplate. Never
coloured by status.

Replaces `mediaIcon` (`i-lucide-hard-drive` / `i-lucide-memory-stick`). The Disks nav
entry keeps `i-lucide-hard-drive`: it means "disks", not "magnetic".

## Vdev types (`Vdev.type`)

16 px `text-muted`, before the vdev label; also in `VdevTreeTable` and disk page
membership.

| type | icon | label |
| --- | --- | --- |
| `raidz1` / `raidz2` / `raidz3` | `i-lucide-layers` | `raidz1-0` as ZFS names it |
| `mirror` | `i-lucide-copy` | `mirror-1` |
| `disk` / `file` (top-level single) | `i-lucide-rows-2` | `stripe` |
| `special` | `i-lucide-sparkles` | `special · mirror-4` |
| `log` | `i-lucide-pen-line` | `log` |
| `cache` | `i-lucide-zap` | `cache` |
| `spare` | `i-lucide-life-buoy` | `spares` |
| `dedup` | `i-lucide-git-merge` | `dedup` |
| `indirect` | `i-lucide-corner-down-right` | `indirect` |

## Entity icons

Used in navigation, command palette groups, diary subject links, breadcrumbs.

| entity | icon |
| --- | --- |
| host | `i-lucide-server` |
| pool | `i-lucide-database` |
| vdev | per type above |
| disk | media glyph when known, else `i-lucide-hard-drive` |
| dataset | `i-lucide-folder-tree` |
| snapshot | `i-lucide-camera` |
| diary | `i-lucide-notebook-pen` |
| fault | `i-lucide-siren` |
| alert channel | `i-lucide-bell` |
| topology | `i-lucide-network` |

## Diary event icons

Each auto event borrows the icon of the thing it describes, so the timeline reads
without colour. Manual entries `i-lucide-pencil`.

| event | icon |
| --- | --- |
| `state-changed`, `override-set` | the new state's lifecycle icon |
| `smart-status-changed`, `attribute-status-changed` | the new status as a dot |
| `fault-accepted` | `i-lucide-shield-check` |
| `acceptance-superseded`, `acceptance-cleared` | `i-lucide-shield-off` |
| `fault-acknowledged` | `i-lucide-eye` |
| `acknowledgement-superseded`, `acknowledgement-cleared` | `i-lucide-eye-off` |
| `disk-appeared` | `i-lucide-plug-zap` |
| `moved-host`, `pool-moved` | `i-lucide-move-right` |
| `vdev-joined`, `vdev-left`, `vdev-state-changed` | the vdev type icon |
| `pool-state-changed` | `i-lucide-database` |
| `scrub-finished`, `resilver-finished`, `scan-finished`, `scrub-cancelled` | `i-lucide-scan-line` |
| `leaf-errors-changed` | `i-lucide-hard-drive` |
| `pool-data-errors-changed` | `i-lucide-file-warning` |
| `alias-set`, `alias-drift` | `i-lucide-tag` |
| `identity-conflict` | `i-lucide-octagon-alert` |
| `usage-changed` | `i-lucide-hard-drive` |
| `dataset-created`, `dataset-destroyed` | `i-lucide-folder-tree` |
| `collector-status-changed` | `i-lucide-server` |
| `events-gap`, `events-reset` | `i-lucide-history` |
| `imported-from-scrutiny` | `i-lucide-import` |
| `fault-opened`, `fault-state-changed`, `fault-resolved` | `i-lucide-siren` |

## Where the code lives

`app/utils/vocabulary/` holds one file per table above, each exporting an exhaustive
`Record<Enum, { colour, shape?, icon?, label }>` so adding an enum member fails
typecheck until it has an entry. `statusColour.ts` and `hardware.ts`'s `mediaIcon`
fold into it. Thresholds that the server or shared code also needs (temperature,
capacity) live in `shared/`. This doc mirrors those files; when they disagree, fix
whichever is wrong and say so in the commit.

## Related

[008](008-Branding-and-colour.md) palette, [036](036-Faults-page.md) faults,
[038](038-Home-page-redesign-and-status-vocabulary-rollout.md) the build.
