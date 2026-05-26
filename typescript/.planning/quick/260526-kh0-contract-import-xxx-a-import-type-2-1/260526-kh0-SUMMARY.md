---
phase: kh0-contract-import-xxx-a-import-type-2-1
plan: 01
subsystem: contract
tags: [refactor, import-type, typescript]
provides:
  - "6 contract source files converted from inline `import(...)` type expressions to top-level `import type` statements"
affects: []
tech-stack:
  added: []
  patterns: ["Top-level `import type` instead of inline `import(...)` type expressions"]
key-files:
  modified:
    - packages/contract/src/Belief.ts
    - packages/contract/src/Causal.ts
    - packages/contract/src/Concept.ts
    - packages/contract/src/EpistemicRuntime.ts
    - packages/contract/src/Policy.ts
    - packages/contract/src/Recall.ts
key-decisions:
  - "Followed alphabetical ordering for new import type lines by module path"
  - "Added blank line between existing imports and new import type lines for visual grouping"
requirements-completed: []
duration: 5min
completed: 2026-05-26
---

# Phase kh0-contract-import-xxx-a-import-type-2-1: Inline Import Type Refactor Summary

**46 inline `import("...").X` expressions converted to 10 new top-level `import type` statements across 6 contract source files**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-26T14:48:00Z
- **Completed:** 2026-05-26T14:53:00Z
- **Tasks:** 3
- **Files modified:** 6
- **Lines changed:** 62 insertions, 41 deletions

## Accomplishments

- All 46 inline `import("xxx").Type` expressions eliminated across 6 files
- 10 new `import type` statements added (Effect x6, EpistemicTrace x1, FileRead x4, FileWrite x4)
- Concept.ts: EpistemicTrace already had a proper import type -- no duplicate added
- TypeScript compilation (`tsc --noEmit`) passes with zero errors
- `grep -rn 'import('` across all 6 files returns zero matches

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor Belief.ts and Causal.ts (Effect + EpistemicTrace + FileRead + FileWrite)** - `ea9215c` (refactor)
2. **Task 2: Refactor Concept.ts and Policy.ts (Effect + FileRead + FileWrite)** - `26ccd5d` (refactor)
3. **Task 3: Refactor EpistemicRuntime.ts and Recall.ts (Effect only)** - `58d1367` (refactor)

## Files Modified

| File | Inline Imports Removed | Import Types Added |
|------|-----------------------|-------------------|
| `packages/contract/src/Belief.ts` | 15 (Effect x11, EpistemicTrace x2, FileRead x1, FileWrite x1) | Effect, EpistemicTrace, FileRead, FileWrite |
| `packages/contract/src/Causal.ts` | 7 (Effect x5, FileRead x1, FileWrite x1) | Effect, FileRead, FileWrite |
| `packages/contract/src/Concept.ts` | 9 (Effect x7, FileRead x1, FileWrite x1) | Effect, FileRead, FileWrite |
| `packages/contract/src/Policy.ts` | 6 (Effect x4, FileRead x1, FileWrite x1) | Effect, FileRead, FileWrite |
| `packages/contract/src/EpistemicRuntime.ts` | 6 (Effect x6) | Effect |
| `packages/contract/src/Recall.ts` | 3 (Effect x3) | Effect |
| **Total** | **46** | **10 new import type lines** |

## Decisions Made

- Inserted new `import type` lines after the last existing import, separated by a blank line for visual grouping
- Ordered new imports alphabetically by module path (`./EpistemicTrace`, `./FileRead`, `./FileWrite`, then `"effect"`)
- Concept.ts already had `import type { EpistemicTrace }` -- did not add a duplicate

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Git index was locked during Task 3 commit (stale `index.lock` from prior operation) -- resolved by removing the lock file
- TypeScript compilation could not use `npx tsc` (wrong package) -- used local `./node_modules/.bin/tsc` instead

## Verification

- **Inline import check:** `grep -rn 'import('` across all 6 files -- zero matches (PASS)
- **TypeScript compilation:** `./node_modules/.bin/tsc --noEmit` -- zero errors (PASS)
