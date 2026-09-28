---
type: task
status: done
---

# SMART status classification

Discovery first. Most of mars's ATA disks show `SMART warning` because of `4 Start/Stop
Count`: K5 has 63 cycles in 3.8 y, which falls in the 52–65 bucket at a 19.4 % annualised
failure rate. Scrutiny flags the same attribute `WARN` but still shows the drive as
`PASSED`. For a home NAS the warning is noise, and it hides real ones.

## Findings so far

- The source is `validateObservedThresholds` in `shared/smart/evaluate.ts`, ported from
  scrutiny ([002](002-Prior-art-and-problem-space.md) §Evaluation logic). The buckets are
  scrutiny's `observed_thresholds`, which it built from the Backblaze fleet data.
- Attribute level matches scrutiny. The difference is the disk rollup. Scrutiny's device
  status is `Passed | FailedSmart | FailedScrutiny` with no warning tier, and only a
  `FailedScrutiny` attribute changes it (`measurements/smart.go:177`). Ours takes
  `worstStatus` over every attribute, so one attribute warning makes the whole disk
  `warning`.
- The Backblaze buckets are unreliable for non-critical attributes:
  - Not monotonic. For attr 4: 52–65 → 19 %, 65–78 → 12 %, 91–104 → 0 %.
  - Confounded. In a hyperscaler fleet a drive is only power cycled when something is
    wrong (pulls, reseats, RMA triage), so the count tracks the trouble rather than
    causing it. At home, power cycles are routine: reboots, power cuts, spin-down.
  - Also suspect: 3 and 195 (vendor-specific normalised values), 192, 189, and 199 (CRC
    errors, which usually mean a cable fault, not a failing disk).

## Direction

A tetanus classification layer on top of the vendored scrutiny metadata, so
`bin/generate-smart-metadata.ts` can still regenerate `metadata.json` without losing
anything. Candidate classes:

1. **Defect.** Critical attributes (5, 10, 184, 187, 188, 196, 197, 198, 201). Keep the
   Backblaze rates; they are causal and match the literature.
2. **Usage and environment.** 4, 9, 12, 192, 193, 3 and similar. Show the failure rate as
   context but never change status because of it. An optional absolute limit could come
   from the manufacturer's rated cycles.
3. **Other non-critical.** 183, 189, 195, 199. To be decided during discovery.

Disk badge: decide what attribute statuses count towards it. Options:

- Scrutiny parity: only `failed` counts.
- A softer tier, e.g. `note`, that tints the attribute row but not the badge.
- Warnings count only for defect-class attributes.

Whatever is chosen must stay a single policy shared by the dashboard, alerts
([026](026-Phase-8-alerts.md)) and fault acceptance
([025](025-Phase-7-diary-and-fault-acceptance.md)), per
[003](003-Architecture-and-data-model.md) §SMART evaluation.

## Discovery

- Go through every attribute that has `observedThresholds`: look at the bucket shape,
  whether its failure rate is plausibly causal, and what it means on a home NAS.
- Survey mars's fixtures and live readings: which attributes are warning today, and on
  which disks.
- Look at prior art: scrutiny issues about attr 4 and other false warnings, and how
  smartd, TrueNAS and Unraid handle non-critical attributes.
- Check the published Backblaze SMART stats papers for which attributes they say
  predict failure (5, 187, 188, 197, 198).
- Decide where the layer lives: a JSON overlay next to `metadata.json`, or TS in
  `shared/smart/`.
- Decide whether stored statuses are recomputed when the classification changes (the
  same question as for acceptances in [025](025-Phase-7-diary-and-fault-acceptance.md)).

## Discovery results (2026-09-29)

Mars fixtures through the current evaluator: 9 of 19 ATA disks `warning`, every one from
attr 4 (11–19 %) or attr 3 (normalised 90–91 → 11 %). Two Intel SSDs `warning` on 201:
critical, no buckets at all → scrutiny's "could not determine" rule. Genuine faults: sdb
197=16 `failed`, sdj 187=1 `failed` (34 %). Bug: sdb 198=18 sits above the top bucket
(14–16) so falls to "no bucket → warning" instead of `failed`.

Prior art: Backblaze names only 5, 187, 188, 197, 198 as predictive and says attr 1 raw is
"often not meaningful as a decimal number". Unraid monitors 5, 187, 188, 197, 198, 199 by
default. Scrutiny #255 is the Seagate 1/7 complaint. No one publishes a semantic
directory beyond scrutiny's tables; smartmontools `drivedb.h` is the per-model *format*
directory and Thomas-Krenn `check_smartdb.json` (GPL-3) has per-model thresholds for ~50
families.

Vendor raw encodings: smartctl already applies drivedb formats and emits the decoded
rendering in `raw.string`, leaving `raw.value` as the packed 48-bit integer. We use
`raw.value` for everything except 188 and 194, so Seagate 1/7 display the operation count
(`0/137774677`), WD 3 shows 34 billion (`398 (Average 396)`), 240 shows a 16-digit number
(`22126h+24m+51.396s`).

## Decisions

1. **Classes.** `defect` = scrutiny's critical set (5, 10, 184, 187, 188, 196, 197, 198,
   201). Everything else, including 3, 4, 183, 189, 195, 199, is `context`: its Backblaze
   rate is computed and shown but never changes status. Fixed in code,
   `shared/smart/classification.ts`, not editable in settings; fault acceptance is the
   per-disk escape hatch.
2. **Badge and alerts.** Disk status = worst of `smartStatus.passed` and un-accepted
   attribute statuses, as before, but only defect-class attributes can be `warning` or
   `failed` from observed thresholds. Manufacturer `when_failed` (`FAILING_NOW` →
   `failed`, `IN_THE_PAST` → `warning`) still applies to every attribute.
3. **Bucket lookup.** Value above the top bucket uses the top bucket. Value in a gap or
   below the first bucket, or an attribute with no buckets, leaves status untouched and
   `failureRate` undefined. Scrutiny's "could not determine → warning" is dropped.
4. **Decoded raw values.** Default transform = leading integer of `raw.string`, falling
   back to `raw.value`. 188 keeps its three-word parser. 194's low-byte transform is
   subsumed. Bucket lookup for `raw` display type uses the transformed value.
5. **Row display.** Context-class attributes with a rate ≥ 10 % render the rate in info
   colour with a tooltip explaining it is fleet context and does not affect status.
6. **Recompute.** `SMART_POLICY_VERSION` constant; `Settings.config.smartPolicyVersion`
   records the last applied. On boot, if they differ, re-evaluate every disk's latest
   reading from its stored attribute rows, rewrite their `transformedValue`, `status`,
   `failureRate`, `reason`, recompute `deviceStatus` and `Disk.latestStatus`, diary
   `smart-status-changed` where it moved, then store the version. No
   `attribute-status-changed` entries, so no `attribute-failed` alerts. Historical rows
   are left alone; attribute history for 3/240 gets a step at the cut-over.
7. 187 raw=1 stays `failed` (defect class, causal rate).

## Tasks

1. `shared/`: classification, evaluate and transform changes, settings schema field,
   tests reworked (scrutiny parity kept for `failed` and values; warning parity dropped).
2. `server/`: `reapplySmartPolicy` + boot hook, `attributeClass` in the metadata
   summary, tests.
3. `app/`: info-tinted context rate with tooltip, tests.
4. Docs: 003 §SMART evaluation, this doc's close-out.

## Out of scope

- Rules based on an attribute increasing between readings (e.g. 199 grew since the last
  reading). Revisit once the classes settle.

## Unanswered questions

None. Badge = defect-class only; classification fixed in code.
