# agent handoff notes

## what this project is

Auto-commits boot.dev lesson solutions to GitHub on every passing submission.
**Dual surface**: browser (tampermonkey) + CLI (shell wrapper) → cloudflare worker → github API.

---

## architecture

```
boot.dev browser (tampermonkey) ─┐
                                 ├→ cloudflare worker → github API → IlyaasK/bootdev
boot.dev CLI (zsh wrapper)  ─────┘
```

### browser path (tampermonkey)
1. XHR intercept on `/v1/lessonRun` → caches code by `lessonUUID`
2. XHR intercept on `/v1/lessons/{uuid}/$` → on `ResultSlug: "success"`, fires worker POST
3. **Fetch fallback** (ticket 06): same intercept logic on `window.fetch` as backup
4. **Dedupe guard**: in-memory Set prevents double-commits if both XHR and fetch fire
5. **Metadata fetch** (ticket 04a): `getLessonMetadata(lessonUUID)` makes an async same-origin `fetch()` to `https://api.boot.dev/v1/static/lessons/{uuid}` using `origFetchRef` (unwrapped fetch). Returns `{ courseTitle, chapterTitle, lessonTitle, courseLanguage }` from `CourseTitle`, `ChapterTitle`, `Title`, `CourseLanguage` fields.
6. `handleSubmitSuccess` is now `async` — awaits metadata before POSTing to worker. If metadata is `null`, logs skip message and returns without POSTing.
7. **No `BOOTDEV_TOKEN` needed** — metadata resolved via authenticated boot.dev API call (ticket 04a)

### CLI path (shell wrapper)
1. User types `bootdev submit` as normal
2. Shell function shadows the binary, captures stdout/stderr
3. On `submit` + exit 0 + success marker → collects code files from lesson dir
4. POSTs to worker with `source: "cli"`, `files: []`, and `cliLog`
5. Worker writes each file + a `.cli-logs/` entry in one commit

### worker path
1. Receives POST with metadata + code/files
2. Validates `ALLOWED_USER`, required metadata fields
3. Routes to correct path: code commit, progress marker, or CLI multi-file
4. Uses github API PUT /contents (SHA-based upsert) to create/update files

---

## file structure

```
bootdev-to-github/          ← this repo (docs + deployable code)
  bootdev-worker.js         ← CF worker source — deploy to cloudflare workers
  bootdev.user.js           ← tampermonkey script — install in browser
  cli/install.sh            ← CLI wrapper installer
  README.md                 ← setup instructions
  AGENTS.md                 ← this file
  tickets/                  ← work queue (done)
  VERIFICATION.md           ← e2e runbook (ticket 07)

IlyaasK/bootdev/            ← target github repo (auto-committed to)
  learn-go/
    variables-and-types/
      creating-variables.go
    functions/
      multiple-return-values.go
  learn-git/
    ...
  learn-python/
    ...
  learn-go/
    interfaces/
      .cli-logs/
        type-assertions-2026-04-20T10-30-00Z.log
```

---

## current state

**All 7 tickets implemented.** Ready for end-to-end verification (ticket 07).

---

## what we know about boot.dev's API (verified via network tab)

| endpoint | method | purpose |
|---|---|---|
| `/v1/lessonRun` | POST | runs code in browser WASM sandbox. request body contains `files[].Content` (the actual code) and `lessonRun.lessonUUID` |
| `/v1/lessons/{uuid}/` | POST | submit endpoint. response contains `ResultSlug: "success"` on pass, plus `LessonUUID`, `CourseUUID`, `UserUUID` |
| `/v1/static/lessons/{uuid}` | GET | returns lesson metadata: `CourseTitle`, `ChapterTitle`, `Title`, `CourseLanguage`. **CALLED BY TAMPERMONKEY** via same-origin fetch from browser path — metadata resolved client-side before worker POST |
| `/v1/viewContent` | POST | page view ping. only has `path`, no useful metadata |

---

## env vars the worker needs (CF dashboard)

```
GITHUB_TOKEN   fine-grained PAT, contents: read+write on IlyaasK/bootdev repo
GITHUB_OWNER   github username (e.g. IlyaasK)
GITHUB_REPO    bootdev
ALLOWED_USER   boot.dev userUUID — a3aefe24-9252-45f1-8f67-696be634dc91
```

**No `BOOTDEV_TOKEN` needed anymore.** All metadata flows through the POST body from tampermonkey.

All values should be encrypted in CF dashboard.

---

## CLI wrapper env vars (shell)

```
WORKER_URL     your cloudflare worker URL
USER_UUID      your boot.dev userUUID
```

Set in `~/.zshrc` or source the wrapper with these exported.

---

## language detection map (worker)

```js
const LANGUAGE_EXT = {
  go: ".go",
  python: ".py",
  javascript: ".js",
  typescript: ".ts",
  sql: ".sql",
  bash: ".sh",
  shell: ".sh",
  git: ".sh",
};
// unknown → ".txt" with console.warn
```

---

## commit message formats

| source | format |
|---|---|
| browser (code) | `feat(learn-go): type-assertions` |
| browser (progress) | `progress(learn-go): quiz-chapter-3` |
| CLI | `feat(learn-go): type-assertions` (files + `.cli-logs/`) |

---

## known limitations

- **Metadata via authenticated API**: metadata from tampermonkey comes from `GET /v1/static/lessons/{uuid}` on `api.boot.dev`. The browser auto-attaches the user's auth cookies. If the API shape changes (field names), `getLessonMetadata()` will return wrong/missing fields and the worker will commit with bad paths. This is intentional — it surfaces the issue rather than silently committing with "unknown-course" paths.
- **CLI metadata**: the CLI wrapper now resolves course/chapter/lesson titles via `GET /v1/static/lessons/{uuid}` using the auth token from boot.dev's viper config (`~/.config/bootdev/viper-config.yaml` or `~/.bootdev/viper-config.yaml`). Depends on `jq` being installed. If the viper config path or token field name changes, resolution fails silently (wrapper prints a warning).
- **WASM lessons**: should work fine through the XHR path — `lessonRun` still fires with files in the body.
- **Test file inclusion**: browser path only commits `main.go` (first file). CLI path commits all source files found in the lesson directory.

---

## user context

- freshman CS @ UC, on F-1 visa
- backend engineering intern at Kernel (kernel.sh, YC S25) starting may 12 — Go shop
- this project is dual-purpose: learn Go via boot.dev + build portfolio signal on github
- runs asahi linux on M1 macbook pro, has 4070 super desktop
- prefers direct, terse communication. no filler. treat as senior-capable.