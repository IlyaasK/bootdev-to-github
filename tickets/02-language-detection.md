# Ticket 02 — detect language and pick correct file extension

## context
`bootdev-worker.js` currently hardcodes `.go` as the file extension:

```js
const filePath = `${slug(courseTitle)}/${slug(chapterTitle)}/${slug(lessonTitle)}.go`;
```

boot.dev teaches multiple languages (Go, Python, JavaScript/TypeScript, SQL, bash).
the user wants solutions committed with the correct extension so github shows accurate
language stats and syntax highlighting on file views.

per AGENTS.md, the `/v1/static/lessons/{uuid}` response includes a `CourseLanguage` field
(observed in a search snippet: `"CourseLanguage":"git"`). this should be used to pick the
extension.

## acceptance criteria
- `fetchMeta()` in bootdev-worker.js also returns `courseLanguage` (lowercase, trimmed).
- a mapping from language → extension is added:
  - `go` → `.go`
  - `python` → `.py`
  - `javascript` → `.js`
  - `typescript` → `.ts`
  - `sql` → `.sql`
  - `bash` / `shell` → `.sh`
  - `git` → `.sh` (git lessons are usually shell scripts) OR `.md` if non-code
  - unknown/missing → `.txt` (with a log line so we can spot new languages)
- file path generation uses the detected extension.
- if the language is not in the map, the worker still commits (don't drop the submission),
  but logs `console.warn` with the unmapped language value so the user can extend the map later.
- commit still succeeds; response JSON still returns `{ ok, path, commit }`.

## files to touch
- bootdev-worker.js (fetchMeta + path construction)

## out of scope
- the tampermonkey script (not affected — worker owns path construction).
- handling non-code lesson types (multiple choice, quiz) — that's ticket 04.

## implementation hints
- keep the language → extension map at module scope, not inside the handler, so it's
  easy to find and extend.
- use `courseLanguage?.toLowerCase().trim()` to normalize before lookup.
- if CourseLanguage is missing from the API response, fall back to `.txt` rather than
  guessing from course title.

## verification
- manually trigger a POST for a known Go lesson → file written with `.go`.
- manually trigger for a Python lesson → `.py`.
- (once ticket 04 lands, test non-code lessons separately.)
