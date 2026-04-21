# agent handoff notes

## what this project is

auto-commits boot.dev lesson solutions to github on every passing submission.
tampermonkey → cloudflare worker → github API. no local server, no CLI, fully serverless.

---

## current state

architecture is designed but **not yet tested end-to-end**. the user has the three files
(README.md, bootdev-worker.js, bootdev.user.js) and setup instructions. next session
likely starts with debugging or feature work.

---

## what we know about boot.dev's API (verified via network tab)

| endpoint | method | purpose |
|---|---|---|
| `/v1/lessonRun` | POST | runs code in browser WASM sandbox. request body contains `files[].Content` (the actual code) and `lessonRun.lessonUUID` |
| `/v1/lessons/{uuid}/` | POST | submit endpoint. response contains `ResultSlug: "success"` on pass, plus `LessonUUID`, `CourseUUID`, `UserUUID` |
| `/v1/static/lessons/{uuid}` | GET | returns lesson metadata: `CourseTitle`, `ChapterTitle`, `Title` (lesson title). used by worker to build file path |
| `/v1/viewContent` | POST | page view ping. only has `path`, no useful metadata |

**key insight**: code is in `lessonRun` request, pass signal is in the submit response.
tampermonkey caches code from `lessonRun` keyed by `lessonUUID`, then fires on submit success.

the boot.dev frontend uses XHR (not fetch), so `XMLHttpRequest.prototype.open/send` override works.
confirmed via network tab — `Sec-Fetch-Mode: cors`, initiator is `BGMQXSrd.js`.

---

## known issues / not yet handled

- **boot.dev token expiry**: `BOOTDEV_TOKEN` in CF env is used to call `/v1/static/lessons/{uuid}`
  for metadata. this token expires — unknown TTL. user needs to manually refresh it from devtools.
  a better solution: store the metadata in the tampermonkey layer instead (boot.dev already sends
  lesson/course/chapter info somewhere in the page — worth checking `viewContent` response or
  the lesson page HTML/JS state). this would eliminate the need for `BOOTDEV_TOKEN` entirely.

- **non-Go lessons**: file path currently hardcodes `.go` extension. boot.dev teaches Python, JS,
  SQL etc. the `/v1/static/lessons/{uuid}` response likely includes a `CourseLanguage` field
  (seen in a search result snippet: `"CourseLanguage":"git"`). use that to pick the right extension.

- **non-code lessons**: multiple choice, reading, and quiz lessons have no code to commit.
  `lessonRun` won't fire for these — the submit hook will still fire but `codeCache[lessonUUID]`
  will be undefined, falling back to `"// no code captured"`. options:
  1. skip commit entirely if no code cached (check for falsy code before POSTing to worker)
  2. commit a markdown file with the lesson title as a progress marker

- **WASM lessons**: some lessons run Go in the browser via WASM (`go_worker.js` visible in network tab).
  these still go through `lessonRun` with files in the body — should work fine, but verify.

- **test file inclusion**: currently only commits `main.go`. the request body has all files
  (`main.go`, `main_test.go`, `main_js_test.go`). could commit all of them or just solution file.
  user's call.

- **tampermonkey on boot.dev load**: the XHR override is injected at `document-start` which is
  correct, but if boot.dev ever switches from XHR to native `fetch()`, the override breaks.
  worth adding a `fetch` intercept as a fallback.

---

## architecture decisions made (and why)

- **cloudflare worker over localhost server**: user is on F-1 visa, building portfolio signal.
  wants commits visible on github without running anything locally. CF free tier is plenty.

- **cloudflare worker over VPS**: no infra to manage, free, auto-TLS. VPS rejected bc overhead.

- **XHR intercept over browser extension**: tampermonkey is faster to ship. native messaging
  for a full extension adds manifest v3 complexity for no benefit here.

- **github API (PUT /contents) over git CLI**: worker is serverless, can't exec shell.
  PUT /contents handles create + update in one call (SHA-based upsert).

---

## env vars the worker needs

```
GITHUB_TOKEN   fine-grained PAT, contents: read+write on bootdev-progress repo
GITHUB_OWNER   github username
GITHUB_REPO    bootdev-progress (or whatever the repo is named)
BOOTDEV_TOKEN  Bearer token from Authorization header on any api.boot.dev request
ALLOWED_USER   boot.dev userUUID — a3aefe24-9252-45f1-8f67-696be634dc91
```

all should be encrypted in CF dashboard.

---

## suggested next features (in priority order)

1. **fix token dependency**: extract metadata from tampermonkey layer, not worker.
   send `courseTitle`, `chapterTitle`, `lessonTitle` in the POST body so worker
   doesn't need to call boot.dev API at all. eliminates `BOOTDEV_TOKEN` env var.

2. **language detection**: use `CourseLanguage` from lesson metadata to pick file extension.
   mapping: `go` → `.go`, `python` → `.py`, `javascript` → `.js`, `sql` → `.sql`, `bash` → `.sh`

3. **skip no-code lessons**: before POSTing to worker, check `if (!code || code === "// no code captured") return;`

4. **progress dashboard**: build a simple github pages site on this repo that reads the
   commit history and renders a heatmap / course progress tracker. purely frontend, no backend.

5. **commit message format**: current format is `feat(learn-go): lesson-title`.
   consider conventional commits with chapter: `feat(learn-go/interfaces): type-assertions`

---

## user context

- freshman CS @ UC, on F-1 visa
- backend engineering intern at Kernel (kernel.sh, YC S25) starting may 12 — Go shop
- this project is dual-purpose: learn Go via boot.dev + build portfolio signal on github
- runs asahi linux on M1 macbook pro, has 4070 super desktop
- prefers direct, terse communication. no filler. treat as senior-capable.
