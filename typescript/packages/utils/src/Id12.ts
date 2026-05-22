function base36(n: number): string {
  return Math.floor(n).toString(36)
}

export function id12(): string {
  const t = base36(Date.now())
  const r = base36(Math.random() * 36 ** 6)
  const s = (t + r).slice(-12)
  return s.padStart(12, "0")
}

