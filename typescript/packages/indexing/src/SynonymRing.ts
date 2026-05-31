/**
 * Bidirectional synonym ring for query expansion.
 *
 * 用于 query expansion 的双向同义词环。
 *
 * Rust reference: `SynonymRing` (`../src/synonym.rs`).
 */
export class SynonymRing {
  private readonly ring = new Map<string, Set<string>>()

  /**
   * Add a pair of synonyms (bidirectional).
   * 添加一对双向同义词。
   * Rust reference: `SynonymRing::add_pair` (`../src/synonym.rs`).
   */
  addPair(a: string, b: string): void {
    const aLower = a.toLowerCase()
    const bLower = b.toLowerCase()
    const aSet = this.ring.get(aLower) ?? new Set<string>()
    aSet.add(bLower)
    this.ring.set(aLower, aSet)
    const bSet = this.ring.get(bLower) ?? new Set<string>()
    bSet.add(aLower)
    this.ring.set(bLower, bSet)
  }

  /**
   * Add a group of synonyms (all linked to each other).
   * 添加一组同义词（组内两两互联）。
   * Rust reference: `SynonymRing::add_group` (`../src/synonym.rs`).
   */
  addGroup(words: ReadonlyArray<string>): void {
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        this.addPair(words[i]!, words[j]!)
      }
    }
  }

  /**
   * Get synonyms for a word.
   * 获取某个 word 的同义词集合。
   * Rust reference: `SynonymRing::get` (`../src/synonym.rs`).
   */
  get(word: string): ReadonlySet<string> | undefined {
    return this.ring.get(word.toLowerCase())
  }

  /**
   * Expand a text by appending synonyms of each word.
   * 通过追加每个 word 的同义词扩展文本。
   * Rust reference: `SynonymRing::expand` (`../src/synonym.rs`).
   */
  expand(text: string): string {
    const trimmed = text.trim()
    const words = trimmed.length === 0 ? [] : trimmed.split(/\s+/)
    const expanded = words.map((word) => word)

    for (const word of words) {
      const synonyms = this.ring.get(word.toLowerCase())
      if (synonyms === undefined) continue
      for (const synonym of synonyms) {
        if (!expanded.some((item) => item.toLowerCase() === synonym)) {
          expanded.push(synonym)
        }
      }
    }

    return expanded.join(" ")
  }

  /**
   * Number of unique words in the ring.
   * ring 中唯一 word 数量。
   * Rust reference: `SynonymRing::len` (`../src/synonym.rs`).
   */
  len(): number {
    return this.ring.size
  }

  /**
   * Check whether the ring is empty.
   * 检查 ring 是否为空。
   * Rust reference: `SynonymRing::is_empty` (`../src/synonym.rs`).
   */
  isEmpty(): boolean {
    return this.ring.size === 0
  }

  /**
   * Check if a word has synonyms.
   * 检查某个 word 是否存在同义词。
   * Rust reference: `SynonymRing::contains` (`../src/synonym.rs`).
   */
  contains(word: string): boolean {
    return this.ring.has(word.toLowerCase())
  }
}
