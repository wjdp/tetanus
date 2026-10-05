---
type: task
status: planned
---

# Silence faults

Undecided (2026-10-05): we haven't settled whether to build this, or whether a re-alert threshold on Accept would do instead.

## Problem

A fault can be acknowledged ("Keep watching") or accepted ("Accept as normal"). Both are tied to a level, and both reopen and alert when the fault gets worse. If a value keeps climbing slowly and you've decided it doesn't matter (a creeping counter on a disk due for replacement, say, or a known noisy attribute), each rise reopens the fault and sends another alert. You then accept it again at the new value, and repeat.

A third option, Silence, would accept the fault and stop alerting on further rises.

## Context

- SMART attribute acceptances live in `FaultAcceptance` (`server/database/schema.ts`) with an `acceptedValue`. `supersedeIfRisen` (`server/services/acceptance.ts`) marks one superseded when the value goes above that level and writes an `acceptance-superseded` or `acknowledgement-superseded` diary entry. Both alert (`server/services/alerts/rules.ts`).
- `overlayStatus` and `isCovered` (`shared/smart/status.ts`) decide whether an acceptance covers the current value. `deviceContribution` turns accepted into no contribution and acknowledged into a warning.
- Other faults store their state on `Fault.state`. `nextState` (`server/services/faults.ts`) reopens a quiet fault when its severity rises or its kind's `reopen()` returns true (pool degraded, leaf errors, FARM and others).
- `FaultAcceptance.kind` and `Fault.state` are untyped text columns, so a new value needs no migration.
- `allowedActions` (`shared/faults.ts`) controls which actions each fault kind offers. Faults with `until-acknowledged` lifetime and the identity-conflict fault can't be accepted today.
- Alertmanager silences are always time-limited. An open-ended silence on a disk fault is the standard way to miss a dying disk.

## Options

1. **Silence as a third kind.** Add `silence` to `ACCEPTANCE_KINDS` and `silenced` to `FAULT_STATES`. A silenced fault stays covered whatever the value, contributes nothing to disk status, and never reopens on a rise.
2. **Silence with expiry.** As 1, but you choose a duration (30 d, 90 d, maybe forever). Needs an `expiresAt` column (a migration) and an expiry check during the fault scan.
3. **Re-alert threshold on Accept.** Keep two options. Accept takes an optional "alert again above N", which defaults to the current value. This reuses `acceptedValue`, so you raise the level instead of turning alerts off. It only fits faults that have a numeric value.

## Work for option 1 or 2

- Types: `ACCEPTANCE_KINDS`, `FAULT_STATES`, and `COVERED_STATUS` / `AttributeDisplayStatus`.
- SMART: `isCovered` / `overlayStatus` always cover a silence; `deviceContribution` returns nothing for it; `supersedeIfRisen` skips it; add a silence entry to the acceptance diary vocabulary.
- Other faults: `isQuiet` and `nextState` don't reopen silenced faults. Add the state to the `faultsBackfill.ts` state mapping.
- Alerts: check every rule in `alerts/rules.ts` that keys on acceptance or fault state, including resolve and recovery alerts.
- `allowedActions`: decide which kinds can be silenced.
- UI: a third radio option and icon in both acceptance modals (`app/components/disk/attributeRows.ts`, `app/components/fault/FaultAcknowledgeModal.vue`); badge labels; the counters weight in `shared/smart/counters.ts`; a filter tab on the faults page; `FaultList` labels; diary rendering; demo stories.
- Tests for each of the above.

Roughly 15 to 20 files.

## Questions

- Build it at all, or go with option 3?
- Should a silenced warning stay quiet if its severity rises to failed or error? If it still escalates, silence only ignores growth within a severity, and it ends up close to option 3.
- Must silences expire? If so, what durations, and does the fault reopen or just alert when one expires?
- Which fault kinds can be silenced?
- Do resolve and recovery alerts still fire for a silenced fault?
