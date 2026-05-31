/**
 * StartupValidationEvent: Rust `crate::startup_validation::StartupValidationEvent`.
 * StartupValidationEvent：对齐 Rust `crate::startup_validation::StartupValidationEvent`。
 */
export type StartupValidationEvent = {
  readonly surface: string
  readonly path: string
  readonly status: string
  readonly detail: string | null
  readonly recovered: boolean
}

/**
 * StartupValidationReport: Rust `crate::startup_validation::StartupValidationReport`.
 * StartupValidationReport：对齐 Rust `crate::startup_validation::StartupValidationReport`。
 */
export type StartupValidationReport = {
  readonly loaded_surfaces: number
  readonly missing_fallbacks: number
  readonly recovered_fallbacks: number
  readonly derived_skips: number
  readonly has_recovery_warnings: boolean
  readonly events: ReadonlyArray<StartupValidationEvent>
}

/**
 * Build a Rust-shaped startup validation event.
 * 构建 Rust 形状的 startup validation event。
 *
 * Rust reference: `startup_event` (`../src/aura.rs`).
 */
export function startupValidationEvent(
  surface: string,
  path: string,
  status: string,
  detail: string | null,
  recovered: boolean,
): StartupValidationEvent {
  return { surface, path, status, detail, recovered }
}

/**
 * Summarize startup validation events with Rust's status buckets.
 * 使用 Rust 的 status bucket 汇总 startup validation events。
 *
 * Rust reference: `finalize_startup_validation_report` (`../src/aura.rs`).
 */
export function finalizeStartupValidationReport(
  events: ReadonlyArray<StartupValidationEvent>,
): StartupValidationReport {
  let loadedSurfaces = 0
  let missingFallbacks = 0
  let recoveredFallbacks = 0
  let derivedSkips = 0
  let hasRecoveryWarnings = false

  for (const event of events) {
    switch (event.status) {
      case "loaded":
        loadedSurfaces++
        break
      case "missing_fallback":
      case "empty_fallback":
        missingFallbacks++
        break
      case "load_error_fallback":
        recoveredFallbacks++
        break
      case "derived_skipped":
        derivedSkips++
        break
    }
    if (event.recovered) hasRecoveryWarnings = true
  }

  return {
    loaded_surfaces: loadedSurfaces,
    missing_fallbacks: missingFallbacks,
    recovered_fallbacks: recoveredFallbacks,
    derived_skips: derivedSkips,
    has_recovery_warnings: hasRecoveryWarnings,
    events,
  }
}
