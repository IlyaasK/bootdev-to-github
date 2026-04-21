# Ticket 04a — replace SPA state scrape with same-origin metadata fetch

## background (read this, don't skim)

the previous attempt at ticket 04 moved lesson metadata resolution from the worker to
the tampermonkey script. good idea. the implementation picked the wrong approach: it
scrapes `window.__REDUX_STATE__` and `window.bootDevState` — **neither of which boot.dev
actually exposes**. those names were listed in the original ticket as *examples of what
to investigate*, not as confirmed globals. the result is `getLessonMetadata()` returns
`null` on every real submit, the POST to the worker omits metadata, and the worker's
new guard (`bootdev-worker.js:48-50`) 400s every single request.

the original ticket had a clearly-recommended option A that was skipped:

> **option A (reuse session):** tampermonkey fires a `fetch()` to
> `/v1/static/lessons/{lessonUUID}` from the boot.dev origin. the browser auto-attaches
> the user's auth cookie / Authorization header from the existing session, so no token
> needed.

this ticket is: do option A, remove option B, leave the rest of ticket 04 in place.

## acceptance criteria

- `getLessonMetadata(lessonUUID)` in `bootdev.user.js` is now `async` and makes a call
  to `https://api.boot.dev/v1/static/lessons/{lessonUUID}` using `fetch()`.
- the fetch uses the original unwrapped `fetch` reference (`origFetchRef`) — not the
  wrapped `window.fetch` — so we don't re-enter our own interceptor and we don't
  double-count or deadlock.
- on a successful response, returns:
  ```
  { courseTitle, chapterTitle, lessonTitle, courseLanguage }
  ```
  populated from the API response fields `CourseTitle`, `ChapterTitle`, `Title`,
  `CourseLanguage` (confirm the exact casing via devtools before shipping).
- on any failure (network error, non-2xx status, missing fields) returns `null` and
  logs a concise `console.warn` so the user can see what went wrong. does NOT throw.
- `handleSubmitSuccess` becomes `async` and awaits `getLessonMetadata(lessonUUID)`
  before building the POST body.
- if metadata is `null`, do not POST to the worker at all — log
  `[bootdev→gh] skipped: metadata fetch failed for <lessonUUID>` and return. the
  worker's 400 guard stays as a defense in depth but we shouldn't be triggering it
  in the happy path.
- the old `__REDUX_STATE__` / `bootDevState` branches in `getLessonMetadata` are
  deleted — not commented out, deleted.
- AGENTS.md's "known limitations" section is updated to remove the SPA-state-shape
  entry (no longer applicable) and replace it with a note that metadata comes from
  the authenticated boot.dev API call.

## files to touch

- bootdev.user.js
- AGENTS.md

## out of scope

- the CLI metadata path — that's ticket 05a.
- adding any retry/backoff to the metadata fetch. one try, fail cleanly, move on.
- caching the metadata across submits. `/v1/static/lessons/{uuid}` is cheap; don't
  pre-optimize.

## verification

1. open a boot.dev lesson, submit a known-good solution.
2. devtools console: should see `[bootdev→gh]` with a real commit message, not a
   worker 400 error.
3. github repo: new file at the correct `<course>/<chapter>/<lesson>.<ext>` path.
4. manually break the fetch (e.g. toggle offline in devtools) → confirm the script
   logs the skip message and does NOT POST to the worker.

## why this is safe

- the user is already authenticated at `boot.dev`. the same-origin `fetch` to
  `api.boot.dev` will attach the browser's existing cookies / auth header. no
  token plumbing, no expiry headache — the moment the user's boot.dev session
  expires the whole page breaks anyway, which is a visible failure mode.
- we keep the worker's validation. if metadata ever arrives empty for any reason,
  the worker 400s instead of committing garbage paths.
