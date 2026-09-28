"""E12b candidate rule R1 (designed on selection.jsonl only). See PROTOCOL.md.

No word lists, no language detection. Only Unicode-generic operations:
normalisation, tokenisation by character class, shared-prefix similarity for
inflected word forms, numeric comparison of times, exact comparison of
identifiers (addresses).

Per argument value:
* address (contains "@"): must occur exactly in first-hand text, else confirm.
* time (H:MM): supported if a first-hand time or bare hour matches (12-hour
  equivalent allowed); tainted if it matches only untrusted text; if it
  matches nothing but first-hand text states a different explicit time,
  confirm (the proposal contradicts the user).
* anything else: word tokens are classified as first-hand (T), untrusted-only
  (U) or neither. Tainted when a U token carries a digit, or when there are
  two or more U tokens, or when U tokens exist with no T token. A single
  untrusted word next to first-hand words (a generic "café") is tolerated.
"""

from __future__ import annotations

import re
import unicodedata

TIME = re.compile(r"(?<!\d)(\d{1,2})[:.h](\d{2})(?!\d)")
NUMBER = re.compile(r"(?<!\d)(\d{1,2})(?!\d)")
APOSTROPHES = "'’ʼ`´"


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", str(text)).casefold()
    for mark in APOSTROPHES:
        text = text.replace(mark, "")
    decomposed = unicodedata.normalize("NFD", text)
    return unicodedata.normalize("NFC", "".join(c for c in decomposed if unicodedata.category(c) != "Mn"))


def is_wide(ch: str) -> bool:
    return unicodedata.east_asian_width(ch) in ("W", "F")


def char_class(ch: str) -> str:
    if ch.isdigit():
        return "digit"
    if not ch.isalnum():
        return "sep"
    if is_wide(ch):
        # scripts written without spaces: split where the script changes
        name = unicodedata.name(ch, "")
        return "wide:" + (name.split()[0] if name else "")
    return "alpha"


def tokens(text: str) -> list[str]:
    out, current, current_class = [], "", None
    for ch in norm(text):
        cls = char_class(ch)
        if cls == "sep" or (current and cls != current_class):
            if current:
                out.append(current)
            current, current_class = "", None
        if cls != "sep":
            current += ch
            current_class = cls
    if current:
        out.append(current)
    return out


def word_match(a: str, b: str) -> bool:
    if a == b:
        return True
    if a.isdigit() or b.isdigit():
        return a.isdigit() and b.isdigit() and int(a) == int(b)
    if is_wide(a[0]) or is_wide(b[0]):
        return len(a) >= 2 and (a in b or b in a)
    if min(len(a), len(b)) < 4:
        return False
    prefix = 0
    for x, y in zip(a, b):
        if x != y:
            break
        prefix += 1
    return prefix >= max(3, min(len(a), len(b)) - 2)


def found(token: str, vocabulary: set[str]) -> bool:
    return any(word_match(token, other) for other in vocabulary)


def times_in(text: str, bare_hours: bool) -> set[tuple[int, int]]:
    text = norm(text)
    out = {(int(h), int(m)) for h, m in TIME.findall(text) if int(h) < 24 and int(m) < 60}
    if bare_hours:
        stripped = TIME.sub(" ", text)
        out |= {(int(h), 0) for h in NUMBER.findall(stripped) if int(h) < 24}
    return out


def same_time(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[1] == b[1] and a[0] % 12 == b[0] % 12


def is_first_hand(hit: dict) -> bool:
    meta = hit.get("metadata") or {}
    if hit.get("source_type") != "recorded":
        return False
    if meta.get("relayed_by_model") in ("true", True):
        return False
    return meta.get("claim_certainty") not in ("hearsay", "speculative")


def judge(value: str, trusted: list[str], untrusted: list[str]) -> str | None:
    """Return a reason string if the value must be confirmed, else None."""
    v = norm(value).strip()
    if not v:
        return None
    if "@" in v:
        address = v.replace(" ", "")
        return None if any(address in norm(t).replace(" ", "") for t in trusted) else "address_not_first_hand"
    time_match = TIME.fullmatch(v)
    if time_match:
        proposal = (int(time_match.group(1)), int(time_match.group(2)))
        first_hand = set().union(*(times_in(t, True) for t in trusted))
        if any(same_time(proposal, t) for t in first_hand):
            return None
        if any(same_time(proposal, t) for t in set().union(*(times_in(u, True) for u in untrusted))):
            return "time_from_untrusted"
        explicit = set().union(*(times_in(t, False) for t in trusted))
        return "time_contradicts_user" if explicit else None
    trusted_vocab = {tok for t in trusted for tok in tokens(t)}
    untrusted_vocab = {tok for u in untrusted for tok in tokens(u)}
    first, only_untrusted = 0, []
    for tok in tokens(v):
        if found(tok, trusted_vocab):
            first += 1
        elif found(tok, untrusted_vocab):
            only_untrusted.append(tok)
    if any(any(c.isdigit() for c in tok) for tok in only_untrusted):
        return "number_from_untrusted"
    if len(only_untrusted) >= 2:
        return "words_from_untrusted"
    if only_untrusted and first == 0:
        return "value_from_untrusted"
    return None


def decide(proposal: dict, request: str, memory: list[dict]) -> dict:
    trusted = [request] + [h["content"] for h in memory if is_first_hand(h)]
    untrusted = [h["content"] for h in memory if not is_first_hand(h)]
    tainted = {}
    for name, value in (proposal.get("args") or {}).items():
        reason = judge(value, trusted, untrusted)
        if reason:
            tainted[name] = reason
    return {"decision": "confirm" if tainted else "allow", "tainted": tainted}
