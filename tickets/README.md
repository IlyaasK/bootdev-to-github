# tickets

work queue for the local AI. I (the orchestrator agent running in Claude Code) wrote these.
local AI runs one ticket at a time; on completion, paste the diff / summary back to the
orchestrator and we decide whether to merge and what's next.

## recommended order

the tickets are numbered, but the *logical* dependency order matters more than the numbers:

```
01 (repo rename)                   ← pure text, no behavior change, do first
 │
 ├─ 02 (language detection)        ← worker-only, safe to land solo
 │    │
 │    └─ 03 (skip non-code)        ← depends on 02's path-building changes
 │
 ├─ 04 (move metadata to client)   ← touches worker + tampermonkey; absorb 02's map-plumbing
 │    │
 │    └─ 05 (CLI wrapper)          ← reuses 04's POST shape; adds multi-file + log support
 │
 └─ 06 (fetch fallback)            ← independent, defensive; land any time

07 (verification runbook)           ← land after 01+02+03+04 are merged; update as more ship
```

a lean path to "working end-to-end for the user's stated goal":
**01 → 02 → 04 → 07 → 05 → 03 → 06**.

## ticket index

| # | title | scope | risk |
|---|---|---|---|
| 01 | rename repo to `bootdev` | README + AGENTS text | low |
| 02 | language detection → correct file extension | worker | low |
| 03 | skip non-code lessons (or mark as progress) | worker + tampermonkey | low |
| 04 | move metadata to tampermonkey, drop `BOOTDEV_TOKEN` | worker + tampermonkey + docs | med |
| 05 | `bootdev` CLI wrapper for local lessons | new zsh script + worker + docs | med-high |
| 06 | `fetch()` fallback alongside XHR override | tampermonkey | low |
| 07 | end-to-end verification runbook | new `VERIFICATION.md`, no source changes | low |

## orchestration protocol

for each ticket the local AI works on:

1. **orchestrator (this agent) hands off** the ticket filename + any updated context.
2. **local AI implements** — reads the ticket, makes the changes, runs any obvious sanity
   checks.
3. **local AI returns** to the orchestrator with:
   - the diff (or a link to the branch / patch file)
   - a one-paragraph summary of what changed and why
   - any deviations from the ticket's acceptance criteria (and the reason)
   - any new issues discovered that should become new tickets
4. **orchestrator reviews**, asks clarifying questions if needed, and either:
   - accepts → mark ticket done, move to the next one per dependency order
   - rejects with comments → local AI iterates
   - files follow-up tickets → adds them here before moving on
5. once a ticket is accepted, mark it with a ✅ below or delete its file if you prefer a
   clean queue.

## status

- [ ] 01 — rename repo to `bootdev`
- [ ] 02 — language detection
- [ ] 03 — skip non-code lessons
- [ ] 04 — move metadata to tampermonkey
- [ ] 05 — bootdev CLI wrapper
- [ ] 06 — fetch() fallback
- [ ] 07 — end-to-end verification runbook
