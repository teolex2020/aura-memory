/**
 * SalienceBands mirrors Rust `crate::aura::SalienceBands`.
 * Salience 分桶统计；字段名与 Rust/PyO3 导出保持一致。
 */
export type SalienceBands = {
  readonly low: number
  readonly medium: number
  readonly high: number
}

/**
 * SalienceSummary mirrors Rust `crate::aura::SalienceSummary`.
 * 当前 record salience 分布摘要；字段名与 Rust/PyO3 导出保持一致。
 */
export type SalienceSummary = {
  readonly total_records: number
  readonly high_salience_count: number
  readonly avg_salience: number
  readonly max_salience: number
  readonly bands: SalienceBands
}
