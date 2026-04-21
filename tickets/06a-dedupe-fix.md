# Ticket 06a — fix dedupe logic in the submit-success handler

## background (read this, don't skim)

ticket 06 added a `fetch()` intercept alongside the existing XHR intercept in
`bootdev.user.js`. the two paths share a `handleSubmitSuccess()` handler, with a dedupe
guard intended to prevent a single successful submit from producing two commits if both
observers fire.

**the dedupe guard is broken two different ways**:

```js
const dedupeSet = new Set();
const DEDUPE_WINDOW_MS = 10_000;

function isDeduped(lessonUUID) {
  const now = Date.now();
  for (const key of dedupeSet.keys()) {
    if (now - parseInt(key, 36) > DEDUPE_WINDOW_MS) {
      dedupeSet.delete(key);
    }
  }
  const id = `${lessonUUID}-${now.toString(36)}`;
  if (dedupeSet.has(id)) return true;
  dedupeSet.add(id);
  return false;
}
```

1. the key format is `${lessonUUID}-${now.toString(36)}`. every call uses a fresh `now`,
   so every `id` is unique. `dedupeSet.has(id)` **never** returns true — dedupe never
   fires, duplicate commits sail through.
2. the pruning logic does `parseInt(key, 36)` on a string like
   `"a3aefe24-9252-...-1jk4p2"`. `parseInt` parses base36 until the first invalid char —
   the hyphen after `a3aefe24`. so it returns the numeric value of `"a3aefe24"` in base36
   (a huge random number), not the timestamp. pruning is effectively random.

net effect: if boot.dev's XHR and the fetch interceptor both observe a single submit
(which is precisely the scenario ticket 06 was meant to handle), you get two github
commits with identical content and slightly different timestamps — noisy commit history,
unnecessary API calls, and a race on the same file path.

## fix

use a `Map<lessonUUID, lastFiredTimestamp>`. check whether the last fire was within the
window. no composite keys, no string parsing.

sketch (don't copy verbatim — adapt to the file's style):

```js
const lastFired = new Map();
const DEDUPE_WINDOW_MS = 10_000;

function isDeduped(lessonUUID) {
  const now = Date.now();
  const last = lastFired.get(lessonUUID);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) {
    return true;
  }
  lastFired.set(lessonUUID, now);
  return false;
}
```

notes:
- don't bother pruning the map. even if the user submits thousands of lessons, it's a
  map of UUIDs → numbers; memory is negligible. skip the cleanup code entirely.
- `lessonUUID` can be `undefined` if we reach this from a weird code path (shouldn't
  happen, but defensively handle it): if it is, return `false` (i.e. don't dedupe;
  let the normal flow run and let the worker's 400 guard catch bad data).

## acceptance criteria

- `isDeduped()` keys by `lessonUUID` only and compares timestamps against
  `DEDUPE_WINDOW_MS`.
- the `dedupeSet` `Set` and its pruning loop are deleted — not commented out.
- simulated double-fire produces exactly ONE worker POST per submit. test by:
  1. solve a lesson, submit.
  2. in devtools console, manually trigger the handler a second time with the same
     response object — the second call should early-return without POSTing.
     (if `handleSubmitSuccess` isn't exposed on `window`, you can also just verify via
     the github repo that only one commit was made after a real submit.)
- no behavior change in the normal single-fire case.

## files to touch

- bootdev.user.js (only)

## out of scope

- adding a dedupe cache keyed by something other than `lessonUUID` (e.g. code hash).
  out of scope — UUID is the right identity.
- persisting the map across page reloads. in-memory is fine; a page reload is rare
  enough that a re-commit on the same lesson produces at most one duplicate.

## verification

- open the script, submit a lesson normally → one commit appears.
- open devtools → network tab → watch for POST to `WORKER_URL`. should see exactly
  one request, not two.
- open devtools → console → inspect `lastFired` (if accessible) after a submit; should
  show `{lessonUUID -> timestamp}`.
