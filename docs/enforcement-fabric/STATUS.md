# Enforcement Fabric — build status

Companion to `PLAN.md`. Updated at the end of every commit.

| # | Surface | State | Commit |
|---|---|---|---|
| 1 | Workspace `fabric` (default, only visible one), seed `src/data/fabric.ts`, profiles, Fleet list + device detail, v2 nav and routes, v1 behind `?workspaces=all` | done | — |
| 2 | Fleet: kill switch, quarantine, "Simulate tamper" / "Simulate wrapboxd stopped", evidence columns (device, coverage), engine device pre-checks | next | |
| 3 | Rules in the tester: launch-mode input, YAML round-trip check, `broker` constrain kind | | |
| 4 | Gateway → Broker tab: vault refs, session tokens, revoke, strip-and-replace flow | | |
| 5 | Receipts: `ReceiptTicket`, Destinations tab, refusal paths through the real signer/verifier | | |
| 6 | v2 enrollment wizard (org → OS → install → enroll → discover → provision → bundle → Fleet) | | |
| 7 | Copy pass: landing, auth, About; employee view polish | | |
| 8 | Onboarding tour (offered, resumable, state-derived copy) | | |
| 9 | Design parity pass against the best v1 screens | | |

## Verification log

- Commit 1: `tsc` clean; grep gate (no catalog agent id in `src/lib/fabric.ts`, `src/pages/fleet.tsx`) clean; in-page invariants over the generated state (every event carries the v2 context keys; unknown-agent model calls all BLOCK; managed-agent model calls all ALLOW outside the tamper window; every approved request has a permit id and one executed record); sweep over 4 workspaces × 2 roles with v1 structural snapshots.
