# Ticket 04 — move lesson metadata extraction to tampermonkey (eliminate BOOTDEV_TOKEN)

## context
the worker currently fetches lesson metadata (`courseTitle`, `chapterTitle`, `lessonTitle`,
`courseLanguage`) by calling `https://api.boot.dev/v1/static/lessons/{lessonUUID}` with a
`BOOTDEV_TOKEN` env var. this token is a user bearer token that expires — when it does,
auto-commits silently break until the user manually refreshes it from devtools.

since the tampermonkey script is already running in an authenticated boot.dev browser
session, it can make the metadata call (or read from the page's JS state) directly, using
the user's live session. the worker then receives pre-resolved metadata in the POST body
and never needs a boot.dev token.

this is listed as priority #1 in AGENTS.md.

## approach options (pick whichever works — both are acceptable)

**option A (reuse session, simplest):** tampermonkey fires a `fetch()` to
`/v1/static/lessons/{lessonUUID}` from the boot.dev origin. the browser auto-attaches the
user's auth cookie / Authorization header from the existing session, so no token needed.

**option B (scrape from page state):** boot.dev's SPA keeps lesson metadata in memory
(redux / pinia / context). investigate `window` for exposed state; if present, read it
directly — fastest, no extra network call.

**option C (intercept the metadata response):** watch XHR for `/v1/static/lessons/{uuid}` or
similar responses that already fire on page load and cache them, keyed by lessonUUID.

default recommendation: **option A** — cleanest, doesn't depend on internal app structure.

## acceptance criteria
- tampermonkey POST body to worker includes `courseTitle`, `chapterTitle`, `lessonTitle`,
  and `courseLanguage` as top-level string fields.
- worker no longer reads `env.BOOTDEV_TOKEN` and no longer calls boot.dev's API.
- `fetchMeta()` function is removed from bootdev-worker.js.
- if any of the four metadata fields are missing/empty in the POST body, worker returns 400
  with a clear error message (don't silently fall back to "unknown-course").
- README.md and AGENTS.md are updated:
  - remove `BOOTDEV_TOKEN` from the env var table and setup steps in README.
  - remove the "token refresh" section from README.md.
  - update AGENTS.md to reflect the new architecture (metadata sourced client-side).

## files to touch
- bootdev.user.js
- bootdev-worker.js
- README.md
- AGENTS.md

## depends on
- ticket 02 (language detection) must land first or be merged into this one — the language
  field needs to flow through the same new POST body shape.

## out of scope
- handling CLI submissions (that's ticket 05 — CLI has its own auth path).

## verification
- trigger a submit in-browser; console should log the resolved commit msg.
- `curl` the worker with all four metadata fields present → 200 + file written.
- `curl` the worker with one field missing → 400.
- deploy the worker with `BOOTDEV_TOKEN` env var removed; auto-commits still work.
