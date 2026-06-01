export enum Level {
  Working = "Working",
  Decisions = "Decisions",
  Domain = "Domain",
  Identity = "Identity"
}

export namespace Level {
  /**
   * Daily decay rate for this level.
   *
   * @zh 当前 level 的每日衰减率；对齐 Rust `Level::decay_rate`。
   *
   * Rust reference: `Level::decay_rate` (`../src/levels.rs`).
   */
  export function decayRate(level: Level): number {
    switch (level) {
      case Level.Working:
        return 0.80
      case Level.Decisions:
        return 0.90
      case Level.Domain:
        return 0.95
      case Level.Identity:
        return 0.99
    }
  }

  /**
   * Map to aura-memory DNA classification.
   *
   * @zh 映射到 aura-memory DNA 分类；对齐 Rust `Level::to_dna`。
   *
   * Rust reference: `Level::to_dna` (`../src/levels.rs`).
   */
  export function toDna(level: Level): "general" | "user_core" {
    switch (level) {
      case Level.Working:
      case Level.Decisions:
        return "general"
      case Level.Domain:
      case Level.Identity:
        return "user_core"
    }
  }

  /**
   * Whether this level maps to SDR identity (protected bit range).
   *
   * @zh 判断该 level 是否映射到 SDR identity 保护区间；对齐 Rust `Level::is_identity_sdr`。
   *
   * Rust reference: `Level::is_identity_sdr` (`../src/levels.rs`).
   */
  export function isIdentitySdr(level: Level): boolean {
    return level === Level.Domain || level === Level.Identity
  }

  /**
   * Get the next higher level, if any.
   *
   * @zh 获取下一层级；对齐 Rust `Level::promote`。
   *
   * Rust reference: `Level::promote` (`../src/levels.rs`).
   */
  export function promote(level: Level): Level | null {
    switch (level) {
      case Level.Working:
        return Level.Decisions
      case Level.Decisions:
        return Level.Domain
      case Level.Domain:
        return Level.Identity
      case Level.Identity:
        return null
    }
  }

  /**
   * Numeric value (1-4).
   *
   * @zh 数值层级；对齐 Rust `Level::value`。
   *
   * Rust reference: `Level::value` (`../src/levels.rs`).
   */
  export function value(level: Level): 1 | 2 | 3 | 4 {
    switch (level) {
      case Level.Working:
        return 1
      case Level.Decisions:
        return 2
      case Level.Domain:
        return 3
      case Level.Identity:
        return 4
    }
  }

  /**
   * Create from numeric value.
   *
   * @zh 从数值层级创建 Level；对齐 Rust `Level::from_value`。
   *
   * Rust reference: `Level::from_value` (`../src/levels.rs`).
   */
  export function fromValue(value: number): Level | null {
    switch (value) {
      case 1:
        return Level.Working
      case 2:
        return Level.Decisions
      case 3:
        return Level.Domain
      case 4:
        return Level.Identity
      default:
        return null
    }
  }

  /**
   * Display name for the level.
   *
   * @zh 展示名；TS 侧命名为 `displayName`，对应 Rust `Level::name`。
   *
   * Rust reference: `Level::name` (`../src/levels.rs`).
   */
  export function displayName(level: Level): "WORKING" | "DECISIONS" | "DOMAIN" | "IDENTITY" {
    switch (level) {
      case Level.Working:
        return "WORKING"
      case Level.Decisions:
        return "DECISIONS"
      case Level.Domain:
        return "DOMAIN"
      case Level.Identity:
        return "IDENTITY"
    }
  }

  /**
   * Memory tier: cognitive (Working/Decisions) or core (Domain/Identity).
   *
   * @zh 记忆层级分组；对齐 Rust `Level::tier`。
   *
   * Rust reference: `Level::tier` (`../src/levels.rs`).
   */
  export function tier(level: Level): "cognitive" | "core" {
    switch (level) {
      case Level.Working:
      case Level.Decisions:
        return "cognitive"
      case Level.Domain:
      case Level.Identity:
        return "core"
    }
  }

  /**
   * Check if this level belongs to the cognitive tier.
   *
   * @zh 判断是否属于 cognitive tier；对齐 Rust `Level::is_cognitive`。
   *
   * Rust reference: `Level::is_cognitive` (`../src/levels.rs`).
   */
  export function isCognitive(level: Level): boolean {
    return tier(level) === "cognitive"
  }

  /**
   * Check if this level belongs to the core tier.
   *
   * @zh 判断是否属于 core tier；对齐 Rust `Level::is_core`。
   *
   * Rust reference: `Level::is_core` (`../src/levels.rs`).
   */
  export function isCore(level: Level): boolean {
    return tier(level) === "core"
  }
}
