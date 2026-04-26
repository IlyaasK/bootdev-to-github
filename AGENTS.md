# agent handoff notes

## what this project is

Auto-commits boot.dev lesson solutions to GitHub on every passing submission.
**Dual surface**: browser (tampermonkey) + CLI (shell wrapper) → local go daemon → git cli.

---

## architecture

```
boot.dev browser (tampermonkey) ─┐
                                 ├→ local go daemon → local git repo → git push
boot.dev CLI (zsh wrapper)  ─────┘
```

### browser path (tampermonkey)
1. XHR intercept on `/v1/lessonRun` → caches code by `lessonUUID`
2. XHR intercept on `/v1/lessons/{uuid}/$` → on `ResultSlug: "success"`, fires daemon POST
3. **Fetch fallback** (ticket 06): same intercept logic on `window.fetch` as backup
4. **Dedupe guard**: in-memory Set prevents double-commits if both XHR and fetch fire
5. **Metadata fetch** (ticket 04a): `getLessonMetadata(lessonUUID)` makes an async same-origin `fetch()` to `https://api.boot.dev/v1/static/lessons/{uuid}` using `origFetchRef` (unwrapped fetch). Returns `{ courseTitle, chapterTitle, lessonTitle, courseLanguage }` from `CourseTitle`, `ChapterTitle`, `Title`, `CourseLanguage` fields.
6. `handleSubmitSuccess` is now `async` — awaits metadata before POSTing to daemon. If metadata is `null`, logs skip message and returns without POSTing.

### CLI path (shell wrapper)
1. User types `bootdev submit` as normal
2. Shell function shadows the binary, captures stdout/stderr
3. On `submit` + exit 0 + success marker → collects code files from lesson dir
4. POSTs to daemon with `source: "cli"`, `files: []`, and `cliLog`
5. Daemon writes each file + a `.cli-logs/` entry in one commit

### daemon path
1. Receives POST with metadata + code/files
2. Validates required metadata fields
3. Routes to correct path: code commit, progress marker, or CLI multi-file
4. Uses local `git` cli to add, commit, and automatically push files to the target directory

---

## file structure

```
bootdev-to-github/          ← this repo (docs + deployable code)
  local-server/             ← Go daemon source
    main.go
  bootdev.user.js           ← tampermonkey script — install in browser
  cli/install.sh            ← CLI wrapper installer
  README.md                 ← setup instructions
  AGENTS.md                 ← this file
  tickets/                  ← work queue (done)
  VERIFICATION.md           ← e2e runbook (ticket 07)

../bootdev/                 ← target github repo (auto-committed to)
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

**All tickets implemented.** Transitioned from Cloudflare worker to local Go daemon.

---

## what we know about boot.dev's API (verified via network tab)

| endpoint | method | purpose |
|---|---|---|
| `/v1/lessonRun` | POST | runs code in browser WASM sandbox. request body contains `files[].Content` (the actual code) and `lessonRun.lessonUUID` |
| `/v1/lessons/{uuid}/` | POST | submit endpoint. response contains `ResultSlug: "success"` on pass, plus `LessonUUID`, `CourseUUID`, `UserUUID` |
| `/v1/static/lessons/{uuid}` | GET | returns lesson metadata: `CourseTitle`, `ChapterTitle`, `Title`, `CourseLanguage`. **CALLED BY TAMPERMONKEY** via same-origin fetch from browser path — metadata resolved client-side before POST |
| `/v1/viewContent` | POST | page view ping. only has `path`, no useful metadata |

---

## daemon env vars (local-server)

```
TARGET_DIR     (optional) path to target repo, defaults to ../bootdev
PORT           (optional) port to run on, defaults to 8080
```

---

## CLI wrapper env vars (shell)

```
WORKER_URL     (optional) daemon URL, defaults to http://localhost:8080/
USER_UUID      your boot.dev userUUID
```

Set in `~/.zshrc` or source the wrapper with these exported.

---

## language detection map (daemon)

```go
var languageExt = map[string]string{
	"go":         ".go",
	"python":     ".py",
	"javascript": ".js",
	"typescript": ".ts",
	"sql":        ".sql",
	"bash":       ".sh",
	"shell":      ".sh",
	"git":        ".sh",
}
// unknown → ".txt" with log.Printf warning
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

- **Metadata via authenticated API**: metadata from tampermonkey comes from `GET /v1/static/lessons/{uuid}` on `api.boot.dev`. The browser auto-attaches the user's auth cookies. If the API shape changes (field names), `getLessonMetadata()` will return wrong/missing fields and the daemon will commit with bad paths. This is intentional — it surfaces the issue rather than silently committing with "unknown-course" paths.
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