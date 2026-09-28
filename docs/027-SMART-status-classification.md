---
type: task
status: todo
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

## Out of scope

- Rules based on an attribute increasing between readings (e.g. 199 grew since the last
  reading). Revisit once the classes settle.

## Unanswered questions

1. What should the disk badge include? Discovery should end with a recommendation.
2. Should the classification be editable in settings, or fixed in code?
