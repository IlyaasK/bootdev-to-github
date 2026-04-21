# Ticket 06 — add `fetch()` intercept alongside the XHR override

## context
`bootdev.user.js` currently intercepts boot.dev's network traffic by overriding
`XMLHttpRequest.prototype.open` and `.send`. this works today (confirmed via network tab:
`Sec-Fetch-Mode: cors`, initiator `BGMQXSrd.js`, XHR-based).

if boot.dev ever migrates their frontend to native `fetch()` (common for modern SPAs),
auto-commits silently stop working and the user has no signal until they notice their
github graph isn't updating.

add a parallel `window.fetch` wrapper that mirrors the XHR interception logic, so either
surface is caught.

## acceptance criteria
- `window.fetch` is wrapped in bootdev.user.js at `document-start`, preserving original
  signature and return value.
- the wrapper detects the same two request patterns as the XHR path:
  - POST to a URL containing `/v1/lessonRun` → parse body, cache code by `lessonUUID`.
  - POST to a URL matching `/v1/lessons/[uuid]/$` → read the response JSON; if
    `ResultSlug === "success"`, fire the worker POST.
- the XHR interception remains in place — don't replace it, add alongside it, with a
  dedupe guard so a single submit (if somehow observed by both) only produces ONE worker POST.
- dedupe strategy: keep an in-memory `Set` of `lessonUUID + timestamp` keys; skip if seen
  in the last N seconds (e.g. 10s window).
- if the response body has already been read by the app, use `response.clone()` before
  reading it in the interceptor (fetch Response bodies are one-shot).
- no noisy console output in the happy path; keep `[bootdev→gh]` logging consistent.

## files to touch
- bootdev.user.js

## out of scope
- rewriting the XHR path as fetch. keep both.
- any server/worker changes.

## verification
- works on today's boot.dev (XHR) — no regression.
- simulate a fetch-based submit by manually calling `fetch("/v1/lessons/<uuid>/", { method: "POST", body: ... })`
  in devtools console after submitting a lesson; verify the interceptor fires.
- dedupe works: rapid double-firing produces exactly one github commit.
