# plans/

This directory is for **short-lived, active work only** — a bug
investigation in progress, or a feature being actively built right now
(see `bug_food_visibilty.md` for the shape: observed behavior, expected
behavior, possible causes, constraints).

It is **not** a permanent spec store. Once a plan's work is finished:

1. Fold anything worth keeping into `docs/PRODUCT.md` (behavior/rules) or
   `docs/ARCHITECTURE.md` (structure).
2. If it was a gameplay-number change, add a line to `docs/DECISIONS.md`.
3. Delete the plan file, or move it to `plans/archive/` if it has useful
   historical context.

`plans/archive/` holds the original per-feature build plans from the
prototype phase — superseded, history only.
