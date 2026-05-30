import { Data } from "effect"

/**
 * Domain-level unsupported surface error for planned MCP tools.
 *
 * Rust reference is mandatory so unsupported branches remain auditable and do
 * not collapse into `Effect.die` defects.
 */
export class UnsupportedSurfaceError extends Data.TaggedError("UnsupportedSurfaceError")<{
  readonly surface: string
  readonly reason: string
  readonly rustReference: string
  readonly missingPrerequisites: ReadonlyArray<string>
}> {}

/**
 * Recoverable parity-contract failure for Rust-shaped MCP payloads.
 *
 * Use when a DTO/storage surface is present but cannot prove the advertised
 * Rust-facing shape.
 */
export class ParityContractError extends Data.TaggedError("ParityContractError")<{
  readonly surface: string
  readonly reason: string
  readonly rustReference: string
}> {}
