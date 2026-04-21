# Ticket 07 — end-to-end verification plan (not code, a runbook)

## context
per AGENTS.md the system is designed but **never tested end-to-end**. before layering new
features, confirm the core happy path works: solve a boot.dev lesson → commit appears in
`IlyaasK/bootdev`. this ticket produces a reproducible runbook, not source changes.

## deliverable
create `VERIFICATION.md` in the repo root, with a section per surface (browser, CLI),
each containing:

1. **preconditions checklist** — what must be true before the test can run.
2. **steps** — exact actions to take.
3. **expected observable outcomes** — what appears in the console, the repo, the CF logs.
4. **failure-mode triage table** — symptom → most likely cause → fix.

## content requirements

### browser surface
- precondition: tampermonkey installed, script enabled, worker URL baked in, CF env vars
  set, PAT valid, `IlyaasK/bootdev` repo exists on github.
- step: open a known Go lesson → write the solution → click **submit** (not run).
- expected:
  - devtools console logs `[bootdev→gh] feat(learn-go): <lesson title>`.
  - CF dashboard → worker → logs shows a POST, 200 response.
  - github repo shows a new commit at `learn-go/<chapter>/<lesson>.go` within ~10s.
- triage table rows (minimum):
  - "no console log" → script disabled / URL wrong / XHR path changed → open tampermonkey
    dashboard, verify script is enabled on `boot.dev`; check network tab for the POST.
  - "console log but no commit" → worker error → open CF logs; likely GITHUB_TOKEN scope
    or repo name mismatch.
  - "commit but wrong path" → metadata miss → check `/v1/static/lessons/{uuid}` response
    fields; language detection map may need extending.
  - "403 unauthorized from worker" → `ALLOWED_USER` doesn't match `userUUID` in POST body.

### CLI surface (only once ticket 05 is landed)
- precondition: `bootdev` CLI installed and logged in, zsh wrapper sourced, env vars set.
- step: `cd` into a lesson dir, run `bootdev submit`.
- expected:
  - CLI shows its usual success output.
  - shell prints `[bootdev→gh] feat(<course>/cli): <lesson title>` after the CLI exits.
  - github repo shows a new commit with the lesson files + a `.cli-logs/` entry.
- triage table rows (minimum):
  - "CLI works, no commit" → wrapper not sourced in current shell → `type bootdev` should
    say `bootdev is a shell function`.
  - "commit missing cliLog" → stdout not captured correctly → check `tee` / subshell
    semantics in the wrapper.
  - "commit appears but files missing" → file collection logic walked the wrong dir;
    confirm `pwd` at the moment the wrapper fires.

### regression pass
- after any code ticket lands, run both surfaces once and check the triage table for new
  symptoms. if a new failure mode is found, append it to the table — this doc is meant to
  grow with the project.

## acceptance criteria
- `VERIFICATION.md` exists at repo root and contains all sections above.
- the runbook is written so a future-you (or another local AI) can execute it without
  reading the source of `bootdev-worker.js` or `bootdev.user.js`.
- no source code files are modified by this ticket.

## files to create
- VERIFICATION.md

## out of scope
- automating any of this (CI, playwright, etc.). runbook only — the system is small and
  not worth automating yet.
