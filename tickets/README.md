# tickets

work queue for the local AI. follow-up round after the first batch (01–07) landed.

## status of the first batch

| # | title | outcome |
|---|---|---|
| 01 | rename repo to `bootdev` | ✅ merged |
| 02 | language detection | ✅ merged |
| 03 | skip non-code lessons | ✅ merged |
| 04 | move metadata to tampermonkey | ❌ shipped broken — see 04a |
| 05 | bootdev CLI wrapper | ❌ shipped broken — see 05a |
| 06 | fetch fallback + dedupe | ❌ dedupe broken — see 06a |
| 07 | verification runbook | ✅ merged |

until 04a and 05a land, the end-to-end system is non-functional (browser 400s on every
submit, CLI double-encodes files). 06a is lower severity (produces duplicate commits
under races) but quick to fix.

## this batch

| # | title | scope | risk |
|---|---|---|---|
| 04a | replace SPA state scrape with same-origin metadata fetch | tampermonkey + AGENTS.md | low |
| 05a | fix CLI wrapper: encoding, recursion, metadata, output passthrough | `cli/install.sh` + README + AGENTS.md | med |
| 06a | fix dedupe logic in submit-success handler | tampermonkey | low |
| 05b | remove duplicate stdout replay left over from 05a | `cli/install.sh` | trivial |

### recommended order

```
04a  ← unblocks browser path, smallest change
 │
 └─ 06a  ← independent but touches the same file; land right after 04a to minimize rebases
 │
05a   ← largest, independent of 04a/06a; can run in parallel
```

lean path to "system works end-to-end": **04a → 06a → 05a**.

## orchestration protocol

same as last round:

1. I hand off one ticket at a time.
2. local AI implements per acceptance criteria, runs sanity checks.
3. local AI returns diff + one-paragraph summary + any deviations + any new issues spotted.
4. I review: accept, or reject with specific deltas, or spawn follow-up tickets.
5. ticket is checked off here on acceptance.

## status

- [x] 04a — same-origin metadata fetch
- [x] 05a — CLI wrapper fixes (completed via 05b)
- [x] 06a — dedupe fix
- [x] 05b — remove duplicate stdout replay
