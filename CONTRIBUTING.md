# Contributing to AuraSDK

Thanks for your interest in contributing! Aura is a solo-developer project built in Kyiv, and every contribution matters.

## Quick Start

### Prerequisites

- **Rust** 1.70+ (via [rustup](https://rustup.rs))
- **Python** 3.9+
- **Maturin** (`pip install maturin`)

### Setup

```bash
git clone https://github.com/teolex2020/aura-memory.git
cd aura-memory

# Rust tests
cargo test --no-default-features --features "encryption,audit,capsule"

# Python setup
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install maturin fastapi httpx
maturin develop --features "pyo3/extension-module,encryption,capsule"
python scripts/python_release_smoke.py
for f in tests/python_*_smoke.py; do python "$f"; done
```

### Build Notes

- If `maturin build` fails with "File overwrote existing tracked file", delete `.pyd` files from `python/aura/` first (leftover from `maturin develop`)
- The `full` feature flag enables everything: `cargo test --features full`
- For minimal builds: `cargo test --no-default-features --features encryption`
- On Windows, if `cargo test` intermittently fails with `LNK1104` on `target\\debug\\deps\\aura-...exe`, run `powershell -ExecutionPolicy Bypass -File .\\scripts\\cleanup_windows_test_lock.ps1` and rerun the test

## How to Contribute

### Bug Reports

Use the [Bug Report template](https://github.com/teolex2020/aura-memory/issues/new?template=bug_report.md). Include:
- Python/Rust version
- OS
- Minimal reproduction code
- Expected vs actual behavior

### Feature Requests

Use the [Feature Request template](https://github.com/teolex2020/aura-memory/issues/new?template=feature_request.md). Describe the use case, not just the solution.

### Code Contributions

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature` or `fix/your-fix`
3. Make changes
4. Add tests (Rust in `src/`, Python in `tests/`)
5. Run the full test suite:
   ```bash
   cargo fmt --check
   cargo test --no-default-features --features "encryption,audit,capsule"
   cargo clippy --all-targets --no-default-features --features "encryption,audit,capsule,server,mcp" -- -A clippy::all -D clippy::correctness -D clippy::suspicious
   for f in tests/python_*_smoke.py; do python "$f"; done
   ```
6. Commit with a clear message
7. Open a PR against `main`

### Examples & Integrations

New examples are always welcome. Place them in `examples/` and follow the existing pattern:
- Clear docstring at the top
- Minimal dependencies
- Works with `pip install aura-memory` only

Do not include internal architecture commentary, unpublished benchmark methodology, strategic notes, or private commercialization material in examples, docs, comments, or PR descriptions.

## Code Style

### Rust
- Follow standard `rustfmt` formatting
- No `clippy` warnings (`-D warnings`)
- Public functions need doc comments
- Tests go in `#[cfg(test)] mod tests` at the bottom of each module

### Python
- Python checks are standalone smoke scripts: `tests/python_<area>_smoke.py`
- Each script focuses on one feature area and exits non-zero on failure
- Use `tempfile.TemporaryDirectory()` for brain directories and `close()` the brain before reopening it (a brain directory is exclusively locked while open)

## Project Structure

```
src/           Rust core (50 modules, ~22,800 lines)
python/aura/   Python bindings (PyO3) + MCP server
tests/         Python test suite (238 tests)
examples/      Runnable examples (16 scripts)
benchmarks/    Performance benchmarks
```

Public documentation is intentionally kept lightweight. Internal design notes, roadmap material, launch plans, and architecture research should not be added to the public repository unless explicitly requested.

## What We Value

- **Correctness over cleverness** — simple, tested code wins
- **No unnecessary dependencies** — the ~3 MB binary is a feature
- **Backward compatibility** — don't break existing API without discussion
- **Tests are mandatory** — no PR merges without passing CI

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Contributions are licensed under MIT, like the rest of the project.
