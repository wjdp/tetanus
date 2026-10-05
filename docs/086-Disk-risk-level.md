---
type: task
status: todo
---

# Disk risk level

Deferred past v1 (2026-10-05). Gather more fleet data and ideas before building.

## Problem

Disk status answers "has a threshold tripped?" with passed, warning or failed. It
doesn't answer "how worried should I be about this drive?", which is the question
behind replacement and backup decisions. A drive can pass every threshold and still
deserve attention: it's old for its model, its pending sectors started rising last
week, its last long self-test barely passed, or FARM shows SMART was reset. Today
those signals are spread across the SMART, Statistics, FARM and Faults tabs, and
nothing ranks drives against each other.

A single risk measure of our own, computed from everything tetanus collects, would
give each drive one figure to sort, compare and alert on, with its reasons attached.

## Context

- Status is the worst attribute verdict (`shared/smart/evaluate.ts`). A defect
  attribute fails when its Backblaze bucket's annual failure rate (AFR) is 10 % or
  more. Rates are per attribute and per value range (`observedThresholds` in
  `shared/smart/metadata.json`), from scrutiny's bucketing of a 2016 Backblaze chart.
  They are observed failures per drive-year over small samples, not probabilities:
  some buckets exceed 100 % (150–332 % for 197, over 1,100 % for 5). Never show one as
  "x % chance".
- Context-class rates are confounded rather than predictive. Attribute 4 reads 11–19 %
  at 26–91 start/stops, which is normal for a home drive (healthy fleet drives sit at
  38–85). Risk, like status, uses rates for defect-class attributes only.
- SMART misses many failures. Backblaze reported roughly a quarter of failed drives
  had zero in all five of its predictive attributes; Google (Pinheiro, 2007) found 56 %
  of failures with no signal in its four strongest counters. The lowest level must
  read "no warning signs", not "safe".
- Coverage is uneven. WD/HGST and Toshiba drives in the fleet don't report 187 or 188,
  so rules keyed on Backblaze's five attributes apply fully only to Seagates.
- A per-model Backblaze AFR already exists for 25 of 298 models in the drive database
  (`afr_pct`, `shared/drive-spec.ts`).
- Per-attribute AFRs can't be combined honestly. They are marginal rates over a
  population, the attributes are strongly correlated (pending, reallocated and
  uncorrectable rise together), and `1 − ∏(1 − p)` over them would overstate risk and
  imply false precision. Taking the worst one is honest, but it's what status already
  does.
- Backblaze publishes daily SMART snapshots and failures for its whole fleet, plus
  quarterly AFR per model. Its own analysis found five attributes predictive: 5, 187,
  188, 197 and 198. Nearly all the data is hard drives; its SSDs are boot drives.
- Signals available today or planned:
  - defect attributes and their history, so trend (`attributeTrend`)
  - SMART health, NVMe critical warning, media errors, available spare, wear
    ([085](085-Disk-fault-coverage.md))
  - self-test results, stored but raising nothing yet (085)
  - age: power-on hours, inventory purchase date, FARM hours where SMART was reset
    ([083](083-Seagate-FARM-log.md))
  - temperature history and time over limit, interface CRC trend
    ([084](084-Statistics-tab.md))
  - model, model family, vendor
- [071](071-Verdict-reasons-in-lists-and-alerts.md) wants a one-line reason wherever
  a status shows. Risk needs the same thing, so reasons should be shared.

## Options

### A. Percentage: estimated annual failure probability

"4.2 % chance of failing in the next year."

- How: fit a model offline on Backblaze's public daily data. For example, logistic
  regression or a survival model on attributes 5/187/188/197/198 (log-scaled,
  plus 30-day deltas), age, and a per-model baseline AFR. A script in `bin/` produces
  versioned coefficients in `shared/`; the server only evaluates.
- For: the most meaningful number if it's calibrated. It compares across drives and
  over time, and an AFR is something users already understand.
- Against:
  - Real modelling work: data download (tens of GB), feature choice, calibration and
    validation, refitting when Backblaze's fleet changes. Extreme class imbalance
    (around 0.5 % of drive-days end in failure), left truncation (drives enter at any
    age), and Backblaze's failure definition (operational removal) all complicate it.
  - Attribute 188's raw value is packed differently by vendor.
  - Backblaze's population is datacentre drives under constant load, not home NAS
    drives that sleep. Power-on hours track calendar age there, not at home.
  - Hard drives only. SSDs and NVMe need a separate method or no percentage at all.
  - Low base rates (about 1–2 % AFR) make most drives read as "1.3 %", which hides
    the differences users care about. Precision invites misreading.

### B. Score: 1–10

"Risk 7 of 10."

- How: a rule-based points system. Each signal adds points by severity: rising
  pending sectors +3, any uncorrectable +2, failed self-test +4, past the model's
  typical lifespan +1, a reset FARM uses FARM age, and so on. Sum, then clamp to 1–10.
  Versioned weights in one shared module, with each reason carrying its points.
- For: fine-grained enough to sort and spot drift (5 → 6), works for every media
  type, cheap to build and explain ("7: pending rising +3, failed self-test +4").
- Against: the numbers are ours and arbitrary, and 7 has no meaning outside tetanus.
  Weights invite endless tuning. Users read numbers as more precise than the rules
  behind them; 6 vs 7 looks significant when it isn't.

### C. Category: low / elevated / high / critical

"High risk: pending sectors rising · failed long self-test."

- How: an ordered rule table, taking the worst level any rule reaches. Examples:
  - critical: SMART health failed, NVMe critical warning, uncorrectable or pending
    rising in the last 7 days, failed self-test with read errors
  - high: any non-zero defect attribute at a Backblaze AFR of 10 % or more, wear
    95 % or more, available spare at threshold + 10, helium tripped
  - elevated: any non-zero defect attribute below that, wear 80 % or more, age past
    the model's typical lifespan, SMART counters reset, interface CRC rising, time
    over temperature
  - low: none of the above

  Each matched rule is a reason, and the level shows with its top reasons.
- For: matches how people act (ignore, watch, plan a replacement, replace now). Easy
  to explain and to alert on; levels map onto the existing colours (neutral, warning,
  error, error plus emphasis); works for every media type; no false precision.
- Against: coarse. Two "elevated" drives can differ a lot, and sorting within a level
  needs a tiebreak. Boundary rules (why 7 days?) still need judgement.

### D. Combined: category, scored inside

C's levels as the face, and B's points used only to sort within a level and to show
a "towards high" lean. Later, if A is built, its percentage replaces the points as
the within-level measure for hard drives.

## Recommendation

Revised after review (2026-10-05): **C only**, built as follows.

- **Derived, not a parallel rule table.** Risk is computed from 085's classification:
  live faults and notes, plus trend and age. Reasons are then the fault and note
  titles, which gives 071 its one-line reasons for free, and the two tables can't
  drift apart. Option C's example rules become the mapping from faults and notes to
  levels.
- **It replaces status where they would compete.** C's top rules (health failed,
  defect AFR of 10 % or more) are exactly `failed` today. Two four-step scales with
  different words side by side would disagree only in names. Risk is the verdict in
  lists, home tiles and Overview. Status survives as the attribute table's verdict and
  behind the `smart-attribute` fault.
- **Acceptance applies.** Risk reads the overlaid status, so an accepted 197 = 16
  doesn't hold a disk at high forever.
- **An unknown level** for standby-only or missing data.
- **Hysteresis.** Pending sectors often return to 0 after a scrub rewrites them, so
  "pending rising" would flap critical → low within a day. A rise holds its level for
  30 days. Reallocations grown per 90 days counts as well as the current level, since
  growth predicts better than level.
- **Noise floors.**
  - Single counts such as 188 = 1 or 196 = 1 need a minimum or a rise before they reach
    elevated.
  - Interface CRC is a reason tagged "cabling, not the drive" and doesn't raise the
    level.
- **Age** as "past warranty" (020) or, where FARM or device statistics publish them,
  rated hours. There's no lifespan data per model, so "past typical lifespan" is
  dropped.
- **Model AFR** from the drive database as a context reason ("Backblaze sees 3.1 % a
  year for this model"), never as the level.
- **No points.** Within a level, sort by worst defect failure rate, then age.
- **Persisted at ingest.** `Disk.latestRisk` with reasons, written as `latestStatus`
  is, and re-evaluated under `SMART_POLICY_VERSION` by `reapplySmartPolicy`. Computing
  in `summarise` would run attribute-history queries per disk per list request.
- **No alert in phase 1.** Every input already alerts as a fault, so a risk alert
  would double-notify. Risk is a ranking view. If one is added later, it's a transient
  notification, not a fault.

Options A and B are not built. A percentage would mislead a home fleet: a datacentre
population, Seagate-only attribute coverage, uncalibrated bucket rates, and a quarter
of failures invisible to SMART.

## Shape

- `shared/smart/risk.ts`: `RiskLevel` (unknown, low, elevated, high, critical),
  `RiskReason { id, text, level }`, and `assessRisk(inputs) → { level, reasons }`.
- Inputs: the disk's live faults and notes (085, 084), overlaid attribute statuses,
  defect growth over 90 days, age, warranty, and model AFR.
- Stored as `Disk.latestRisk`, written at ingest and on fault sync.
- Shown:
  - the headline figure on the disk page, with reasons
  - the verdict column in the disk list
  - Overview's Health group
  - a home page count of drives at high or critical
- Additional reasons to cover: self-test overdue (017), an SMR drive in a ZFS vdev
  (resilver risk), NVMe spare and media errors, SCSI grown defects.

## Out of scope

- Predicting failure dates.
- Pools: a pool-level risk such as "two high-risk drives in one raidz1 vdev" is a
  natural follow-up, but separate.

## Questions

1. Is replacing status in lists and on Overview acceptable, with status kept only in the
   attribute table and faults?
2. Hold period for a rise: 30 days?
3. Minimum counts for single-count attributes such as 188 and 196: what floor?
