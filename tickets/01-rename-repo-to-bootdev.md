# Ticket 01 — rename target repo from `bootdev-progress` to `bootdev`

## context
the project currently documents and targets a github repo called `bootdev-progress`.
the user wants the target repo to be `IlyaasK/bootdev` instead. the name appears in:
- README.md (setup instructions, env var values, examples)
- AGENTS.md (env var section, token scoping notes)
- bootdev-worker.js (only via `env.GITHUB_REPO`, no hardcoded string — verify)

this is a pure rename; no behavior changes.

## acceptance criteria
- every reference to the string `bootdev-progress` in README.md and AGENTS.md is replaced
  with `bootdev` (repo name) or `bootdev-to-github` (if it was referring to the *local* working
  dir). read the context of each occurrence before replacing — don't blindly sed.
- the example env var table in README.md shows `GITHUB_REPO = bootdev`.
- the PAT scoping instructions (README step 1) reference `bootdev` as the repo to scope to.
- bootdev-worker.js is not modified unless a hardcoded repo string is found (it shouldn't be —
  repo name comes from `env.GITHUB_REPO`).
- grep the repo for `bootdev-progress` after changes; zero hits expected.

## files to touch
- README.md
- AGENTS.md
- (verify) bootdev-worker.js

## out of scope
- creating the actual github repo on github.com — that's a user action, not a code change.
- updating the cloudflare worker's deployed env vars — that's a dashboard action.

## verification
```
grep -r "bootdev-progress" /Users/ilyaas/workspace/github.com/IlyaasK/bootdev-to-github/
```
should return no matches in code/docs (matches inside `tickets/` referring to the rename itself
are fine).
