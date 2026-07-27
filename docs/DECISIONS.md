# DECISIONS.md

Append-only log of gameplay-number or rule changes: what changed, from what
to what, and why. One entry per change, newest at the top. This exists so
"why is this number what it is" never again requires reverse-engineering
months later — every deliberate retune or drift-resolution gets written
down when it happens.

Not for structural/architecture changes (those go in `docs/ARCHITECTURE.md`
directly, since there's only ever one current structure worth documenting).

---

## 2026-07-27 — Fireball cost & shield drain reconciled to PRODUCT.md

- **Fireball mass cost:** code had `FIREBALL_MASS_FRACTION = 0.25` (25%),
  PRODUCT.md specified 10%. Resolved: code updated to `0.10` — spec wins.
- **Shield drain:** code had `SHIELD_DRAIN_PER_SEC = 0.05` (5%/s), PRODUCT.md
  specified 1%/s. Resolved: code updated to `0.01` — spec wins.
- **Why it drifted:** earlier gameplay changes were made directly in code
  (via a different coding agent, based on real playtest feel) without a
  matching update to the spec docs. It went unnoticed until this harness
  cleanup cross-checked constants against PRODUCT.md.
- **Follow-up:** if 10% fireball / 1% shield feels wrong in play, that's a
  new decision to log here — don't just change the code again silently.
