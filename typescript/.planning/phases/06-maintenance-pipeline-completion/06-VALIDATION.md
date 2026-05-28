---
phase: 06-maintenance-pipeline-completion
phase_number: "06"
slug: maintenance-pipeline-completion
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-28
verified: 2026-05-28
audit_date: 2026-05-28
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (root) |
| **Quick run command** | `bun run test -- packages/causal/ packages/policy/` |
| **Full suite command** | `bun run test -- packages/causal/ packages/policy/ packages/epistemic-runtime/ packages/recall/` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test -- packages/<affected-pkg>/`
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 0 | REQ-012 | T-06-01 | N/A (type layer) | compile | `bun run typecheck` | ✅ | ✅ green |
| 06-01-02 | 01 | 0 | REQ-012 | T-06-01 | N/A (type layer) | compile | `bun run typecheck` | ✅ | ✅ green |
| 06-01-03 | 01 | 0 | REQ-012 | T-06-01 | N/A (type layer) | compile | `bun run typecheck` | ✅ | ✅ green |
| 06-02-01 | 02 | 1 | REQ-012 | — | N/A | unit | `bun run test -- packages/causal/` | ✅ | ✅ green |
| 06-03-01 | 03 | 1 | REQ-012 | — | N/A | unit | `bun run test -- packages/policy/` | ✅ | ✅ green |
| 06-04-01 | 04 | 1 | REQ-012 | T-06-04 | N/A | unit | `bun run test -- packages/recall/src/BoundedReranker.test.ts` | ✅ | ✅ green |
| 06-04-02 | 04 | 1 | REQ-012 | T-06-04 | N/A | unit | `bun run test -- packages/recall/src/RecallFinalizer.test.ts` | ✅ | ✅ green |
| 06-04-03 | 04 | 1 | REQ-012 | T-06-04 | N/A | compile | `grep -c "BoundedReranker\|RecallFinalizer" packages/recall/src/index.ts` | ✅ | ✅ green |
| 06-05-01 | 05 | 2 | REQ-012 | T-06-05 | N/A | integration | `bun run test -- packages/epistemic-runtime/` | ✅ | ✅ green |
| 06-05-02 | 05 | 2 | REQ-012 | T-06-05 | N/A | compile | `grep -c "BoundedRerankerLive\|RecallFinalizerLive" packages/core/src/DefaultLayer.ts` | ✅ | ✅ green |
| 06-05-03 | 05 | 2 | REQ-012 | T-06-05 | N/A | integration | `bun run test -- packages/epistemic-runtime/` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new framework install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| RecallFinalizer activation count via public API | REQ-012 | `getActivationCount()` method is not exposed on the public interface — internal `Map` access only | Verify via code review that `activationCounts` Map is incremented correctly on each `finalize()` call; test currently uses `(finalizer as any)` to access private state |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-28

---

## Validation Audit 2026-05-28

| Metric | Count |
|--------|-------|
| Gaps found | 4 |
| Resolved | 4 |
| Escalated | 0 |

### Gap Resolution Details

| # | Task ID | Gap | Resolution | Status |
|---|---------|-----|------------|--------|
| 1 | 06-02-01 | CausalEngine trace event test missing | Added "discover emits trace events" test with spy capture | ✅ FILLED |
| 2 | 06-03-01 | PolicyEngine trace event test missing | Added "discover emits trace events" test with spy capture | ✅ FILLED |
| 3 | 06-04-01 | BoundedReranker empty input test missing | Added "empty input returns empty" test | ✅ FILLED |
| 4 | 06-04-02 | RecallFinalizer activation count increment test missing | Added "finalize increments activation counts" test | ✅ FILLED (WARNING: uses internal access) |

### Test Suite After Audit

| Test File | Before | After | Status |
|-----------|--------|-------|--------|
| CausalEngine.test.ts | 6 tests | 7 tests | ✅ all pass |
| PolicyEngine.test.ts | 6 tests | 7 tests | ✅ all pass |
| BoundedReranker.test.ts | 3 tests | 4 tests | ✅ all pass |
| RecallFinalizer.test.ts | 3 tests | 4 tests | ✅ all pass |
| EpistemicRuntime.test.ts | 5 tests | 5 tests | ✅ all pass |
| CausalStoreFile.test.ts | — | — | ✅ all pass |
| PolicyStoreFile.test.ts | — | — | ✅ all pass |
| **Total** | **23 tests** | **27 tests** | **✅ 7/7 files green** |

---

_Validated: 2026-05-28_
_Validator: Claude (gsd-nyquist-auditor)_
