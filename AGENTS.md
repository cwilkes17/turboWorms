# AGENTS.md

Entry point for any coding agent (Cursor, Codex, Claude, or otherwise)
working in this repo. Read this first, in full, before making changes.

## What this project is

**turboWorms** — a multiplayer snake/worm arena. Authoritative Node server,
WebSocket networking, Canvas client, no game engine. Solo-developed, currently
being built with a mix of coding agents (Cursor, Codex, Claude) — which means
nothing enforces consistency between sessions except these docs. Treat them
as binding.

## Read in this order

1. **This file** — rules and workflow.
2. **`docs/PRODUCT.md`** — what the game does: rules, numbers, feel. Source of
   truth for gameplay behavior.
3. **`docs/ARCHITECTURE.md`** — how the code is organized: modules, data flow,
   tick order, current constants. Source of truth for structure. Has a
   "Known gaps vs PRODUCT.md" section (§9) — check it before assuming
   something is or isn't built.
4. **`docs/DECISIONS.md`** — chronological log of gameplay-number/rule
   changes and why. Skim recent entries for context; add one when you make
   this kind of change.
5. `docs/DEVELOPER_GUIDE.md` — optional deeper human-facing walkthrough with
   a worked example. Not required to complete most tasks.

`docs/archive/` and `plans/archive/` are history only — superseded prototype
docs that contradict the above. Don't treat them as current.

## Commands

```bash
npm install
npm start                 # runs prestart (build:client) then the server → http://localhost:8765
npm run build:client      # rebuild public/client.bundle.js after touching renderer.ts / client-entry.ts
node --experimental-strip-types --test tests/*.test.ts   # run tests
```

## The rule that matters most here

This repo already went through one cycle where gameplay behavior was changed
directly in code (based on real playtesting) without updating the spec, and
it went unnoticed for months until a reconciliation pass caught it.

**If a task could be read as either "fix code to match the spec" or "the
spec is stale, update it to match intended new behavior" — stop and ask.**
Don't pick silently. Whichever way it resolves, update both PRODUCT.md (if a
number/rule changed) and `docs/DECISIONS.md` (one line: what changed, from
what, to what, why) in the same task.

## Workflow contract (full version: `docs/ARCHITECTURE.md` §10)

Short version — the full list lives in ARCHITECTURE.md so it isn't
duplicated (and can't drift) in two places:

- Gameplay numbers/rules → keep PRODUCT.md in sync, same task.
- Structure (new module, tick order, World shape, wire format) → keep
  ARCHITECTURE.md in sync, same task.
- Add/extend a test near the module you touched.
- Rebuild the client bundle if `renderer.ts` / `client-entry.ts` changed.
- Client is never trusted for mass, hits, or spawns — server is authoritative.

## Task template (for Cameron, when filing a task with an agent)

A task is much more likely to land correctly in one shot if it states:

1. **What should change**, in gameplay terms ("fireball should cost less
   mass so it's spammable") — not just a symptom ("fireball feels bad").
2. **Bug fix or intentional retune?** If you know which, say so — it removes
   the single biggest source of drift on this project.
3. **Any constraint** — e.g. "don't touch collision.ts," "must stay
   deterministic," "keep it server-authoritative."

## Definition of done

Before calling a task finished:

- [ ] Tests pass (`node --experimental-strip-types --test tests/*.test.ts`)
- [ ] PRODUCT.md updated if behavior/numbers changed
- [ ] ARCHITECTURE.md updated if structure changed (including §9 Known gaps
      and the constants table in §7, if relevant)
- [ ] `docs/DECISIONS.md` has a new line if a gameplay number/rule changed
- [ ] Client rebuilt if renderer/client-entry changed
