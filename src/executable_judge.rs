//! Executable-judge world fact — turn a real command's output into a 3-state
//! world fact that can close an evidence debt.
//!
//! Ported from the Aura research line (`compiler_world_sensor.rs`, proven by
//! `prove_aura_grows_on_real_world.py`). The agent predicts an outcome, files it
//! as `EvidenceDebt` (open, not yet checked), then runs a real convergent-world
//! command (a test, a build, a validation, a tool). This module turns that
//! command's result into a 3-state fact and closes the debt accordingly:
//!
//! ```text
//!   succeeded (and something actually ran) -> Supports   -> Confirmed
//!   failed / contradicted                  -> Refutes    -> Refuted (scar)
//!   ran but no observable outcome          -> Inconclusive -> stays EvidenceDebt
//! ```
//!
//! Two proven discipline points are carried over:
//!   1. **The exit code is not trusted alone.** A process can exit 0 while
//!      writing a failure to stderr (cargo does this). The fact is read from
//!      what the process *says* (failure markers) as well as its exit status.
//!   2. **Inconclusive is a real third state.** "Compiled but no test ran" is
//!      NOT support — it leaves the debt open, so the agent does not learn a
//!      false positive from a vacuous run.
//!
//! This module does NOT execute anything itself — a published library must not
//! auto-run arbitrary agent commands. The agent runs the command in its own
//! sandbox/runner and passes the captured output here.

use serde::{Deserialize, Serialize};

use crate::belief::{Belief, WorldVerdict};

#[cfg(feature = "python")]
use pyo3::prelude::*;

/// A 3-state world fact derived from a real command's result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorldFact {
    /// The world confirmed the prediction (an observable success occurred).
    Supports,
    /// The world contradicted the prediction (failure / error observed).
    Refutes,
    /// The command ran but produced no observable outcome — debt stays open.
    Inconclusive,
}

impl WorldFact {
    pub fn as_str(self) -> &'static str {
        match self {
            WorldFact::Supports => "supports",
            WorldFact::Refutes => "refutes",
            WorldFact::Inconclusive => "inconclusive",
        }
    }
}

/// Derive a 3-state world fact from a real command's captured output.
///
/// * `exit_code` — the process exit status (used as a signal, not the sole
///   authority).
/// * `stdout` / `stderr` — captured output.
/// * `success_markers` — substrings whose presence means an observable success
///   actually happened (e.g. "test result: ok", "1 passed", "OK"). At least one
///   must be present for a `Supports` fact — this is what prevents a vacuous run
///   from being scored as support.
/// * `failure_markers` — substrings whose presence means the world contradicted
///   the prediction (e.g. "error[", "could not compile", "FAILED", "panic").
///
/// Decision (failure dominates, success requires positive evidence):
///   * any failure marker present, OR a non-zero exit with no success marker
///     ⇒ `Refutes`;
///   * a success marker present (and no failure marker) ⇒ `Supports`;
///   * otherwise (ran, but nothing observable) ⇒ `Inconclusive`.
pub fn world_fact_from_output(
    exit_code: i32,
    stdout: &str,
    stderr: &str,
    success_markers: &[&str],
    failure_markers: &[&str],
) -> WorldFact {
    let haystack_lower_out = stdout.to_ascii_lowercase();
    let haystack_lower_err = stderr.to_ascii_lowercase();
    let contains = |needle: &str| {
        let n = needle.to_ascii_lowercase();
        haystack_lower_out.contains(&n) || haystack_lower_err.contains(&n)
    };

    let failed = failure_markers.iter().any(|m| contains(m));
    let succeeded = success_markers.iter().any(|m| contains(m));

    // Failure dominates: a contradiction outweighs a co-present success marker,
    // mirroring the scar rule (a refutation is stronger evidence).
    if failed {
        return WorldFact::Refutes;
    }
    if succeeded {
        return WorldFact::Supports;
    }
    // No explicit marker either way. Trust a clean exit as "ran, nothing
    // observable" (Inconclusive); trust a dirty exit as a refutation.
    if exit_code != 0 {
        WorldFact::Refutes
    } else {
        WorldFact::Inconclusive
    }
}

/// Close (or defer) a belief's evidence debt using a world fact.
///
/// Applies the fact through the existing scar-protected `WorldVerdict` machinery:
///   * `Supports`   ⇒ `confirm_by_world` (no-op if already a refuted scar — the
///     gaslight guard still holds);
///   * `Refutes`    ⇒ `refute_by_world` (a lived refutation, becomes a scar);
///   * `Inconclusive` ⇒ leaves the belief in `EvidenceDebt` (open).
///
/// Returns `true` if the belief's verdict changed.
pub fn close_evidence_debt_with_fact(belief: &mut Belief, fact: WorldFact) -> bool {
    match fact {
        WorldFact::Supports => belief.confirm_by_world(),
        WorldFact::Refutes => belief.refute_by_world(),
        WorldFact::Inconclusive => {
            // Debt stays open; nothing observable resolved it.
            debug_assert!(matches!(
                belief.world_verdict,
                WorldVerdict::EvidenceDebt | WorldVerdict::Confirmed | WorldVerdict::Refuted
            ));
            false
        }
    }
}

/// Python: derive a 3-state world fact ("supports" | "refutes" | "inconclusive")
/// from a real command's captured output. The agent runs the command itself and
/// passes the result here. A failure marker (or a dirty exit with no success
/// marker) ⇒ refutes; a success marker ⇒ supports; otherwise inconclusive (the
/// evidence debt stays open). Deterministic, no LLM, no execution here.
#[cfg(feature = "python")]
#[pyfunction]
#[pyo3(name = "world_fact_from_output", signature = (exit_code, stdout, stderr, success_markers, failure_markers))]
pub fn py_world_fact_from_output(
    exit_code: i32,
    stdout: &str,
    stderr: &str,
    success_markers: Vec<String>,
    failure_markers: Vec<String>,
) -> String {
    let ok: Vec<&str> = success_markers.iter().map(|s| s.as_str()).collect();
    let fail: Vec<&str> = failure_markers.iter().map(|s| s.as_str()).collect();
    world_fact_from_output(exit_code, stdout, stderr, &ok, &fail)
        .as_str()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAIL: &[&str] = &["error[", "could not compile", "FAILED", "panic"];
    const OK: &[&str] = &["test result: ok", "passed", "OK"];

    #[test]
    fn passing_run_is_supports() {
        let fact = world_fact_from_output(0, "test result: ok. 3 passed", "", OK, FAIL);
        assert_eq!(fact, WorldFact::Supports);
    }

    #[test]
    fn failure_marker_is_refutes_even_on_exit_zero() {
        // The proven discipline: exit code lies. cargo can exit 0 while writing
        // "error[" to stderr. The fact must be read from what it SAYS.
        let fact = world_fact_from_output(0, "", "error[E0433]: could not compile", OK, FAIL);
        assert_eq!(fact, WorldFact::Refutes);
    }

    #[test]
    fn failure_dominates_a_co_present_success_marker() {
        let fact = world_fact_from_output(0, "test result: ok", "panic occurred", OK, FAIL);
        assert_eq!(fact, WorldFact::Refutes);
    }

    #[test]
    fn ran_but_nothing_observable_is_inconclusive() {
        // Compiled, clean exit, but no test ran → NOT support, debt stays open.
        let fact = world_fact_from_output(0, "Finished dev profile", "", OK, FAIL);
        assert_eq!(fact, WorldFact::Inconclusive);
    }

    #[test]
    fn dirty_exit_without_markers_is_refutes() {
        let fact = world_fact_from_output(1, "", "", OK, FAIL);
        assert_eq!(fact, WorldFact::Refutes);
    }

    #[test]
    fn supports_fact_confirms_an_open_debt() {
        let mut b = Belief::new("k".to_string());
        assert_eq!(b.world_verdict, WorldVerdict::EvidenceDebt);
        assert!(close_evidence_debt_with_fact(&mut b, WorldFact::Supports));
        assert_eq!(b.world_verdict, WorldVerdict::Confirmed);
    }

    #[test]
    fn refutes_fact_makes_a_scar() {
        let mut b = Belief::new("k".to_string());
        assert!(close_evidence_debt_with_fact(&mut b, WorldFact::Refutes));
        assert_eq!(b.world_verdict, WorldVerdict::Refuted);
    }

    #[test]
    fn inconclusive_leaves_debt_open() {
        let mut b = Belief::new("k".to_string());
        assert!(!close_evidence_debt_with_fact(&mut b, WorldFact::Inconclusive));
        assert_eq!(b.world_verdict, WorldVerdict::EvidenceDebt);
    }

    #[test]
    fn supports_does_not_rehabilitate_a_scar() {
        // The gaslight guard survives the executable-judge path too: a Supports
        // fact must NOT clear a prior lived refutation.
        let mut b = Belief::new("k".to_string());
        close_evidence_debt_with_fact(&mut b, WorldFact::Refutes);
        assert_eq!(b.world_verdict, WorldVerdict::Refuted);
        assert!(!close_evidence_debt_with_fact(&mut b, WorldFact::Supports));
        assert_eq!(b.world_verdict, WorldVerdict::Refuted);
    }
}
