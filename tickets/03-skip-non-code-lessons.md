# Ticket 03 — skip non-code lessons (multiple choice, reading, quiz)

## context
some boot.dev lessons have no code: multiple-choice questions, reading lessons, quizzes.
for these lessons, `/v1/lessonRun` never fires, so the tampermonkey `codeCache[lessonUUID]`
stays undefined. when the submit hook fires on success, the current code falls back to the
string `"// no code captured"` and commits that placeholder to github.

this pollutes the repo with garbage commits. either skip these lessons entirely, or mark
them as completed in a lightweight way.

the user's stated goal is "github graph activity" — so a no-code lesson *could* reasonably
produce a commit too, as long as it's not noise.

## decision required (the local AI should pick ONE and note the choice in the PR/commit)
**option A (skip):** if `codeCache[lessonUUID]` is undefined, do not POST to the worker at all.
  simplest. no repo pollution. but no github activity credit for non-code lessons.

**option B (progress marker):** if no code cached, POST with a special `kind: "progress"` flag.
  worker writes a short markdown file like `<course>/<chapter>/<lesson>.md` containing
  `# <lesson title>\n\ncompleted <ISO date>`. user still gets commit activity, repo stays tidy.

default recommendation: **option B**. it matches the user's "github graph" goal without
committing meaningless code.

## acceptance criteria (option B shown; adjust if A is chosen)
- tampermonkey: on submit success with no cached code, POST `{ userUUID, lessonUUID, courseUUID, kind: "progress" }`
  (no `code` field).
- worker: if `body.kind === "progress"`, build a markdown file at
  `<course>/<chapter>/<lesson>.md` with body:
  ```
  # <lesson title>

  completed <ISO8601 UTC timestamp>
  ```
  commit message: `progress(<course>): <lesson title>`.
- worker: if both `code` and `kind` are absent/empty, return 400 rather than committing noise.
- the `"// no code captured"` fallback string is removed from bootdev.user.js.

## files to touch
- bootdev.user.js
- bootdev-worker.js

## depends on
- ticket 02 (language detection) — this ticket adds a parallel path for non-code, so the
  two should be landed together or in order (02 first, then 03) to avoid collisions in
  the worker handler.

## out of scope
- detecting lesson *type* from the API (reading vs quiz vs multiple choice). the presence
  or absence of cached code is a good enough proxy.
