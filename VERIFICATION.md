# End-to-End Verification Runbook

This runbook confirms the core happy path: solve a boot.dev lesson → commit appears in `IlyaasK/bootdev`.

---

## Prerequisites (both surfaces)

- [ ] Cloudflare worker deployed (`bootdev-worker.js`) with env vars set:
  - `GITHUB_TOKEN` — fine-grained PAT, contents: read+write on `IlyaasK/bootdev`
  - `GITHUB_OWNER` — `IlyaasK`
  - `GITHUB_REPO` — `bootdev`
  - `ALLOWED_USER` — your boot.dev userUUID (e.g. `a3aefe24-9252-45f1-8f67-696be634dc91`)
- [ ] GitHub repo `IlyaasK/bootdev` exists and is reachable
- [ ] Cloudflare worker URL is known (e.g. `https://your-worker.your-subdomain.workers.dev/`)

---

## Browser Surface (Tampermonkey)

### Preconditions

- [ ] Tampermonkey extension installed in browser
- [ ] bootdev→github script enabled (check Tampermonkey dashboard → script list)
- [ ] `WORKER_URL` in the script (`bootdev.user.js` line 14) points to your deployed worker
- [ ] Script `@match` is `https://www.boot.dev/*` (default)
- [ ] You are logged into boot.dev in the same browser

### Steps

1. Open a known Go lesson in boot.dev (e.g. `learn-go → interfaces → type-assertions`)
2. Write a valid solution in the editor
3. Click **Submit** (not Run)
4. Confirm the lesson passes on boot.dev

### Expected Observable Outcomes

| Signal | Where to check | What you should see |
|---|---|---|
| Console log | DevTools console | `[bootdev→gh] {ok:true, path:"learn-go/interfaces/type-assertions.go", commit:"feat(learn-go): type-assertions"}` |
| Worker POST | CF Dashboard → Workers → Logs | POST to worker, status 200 |
| GitHub commit | github.com/IlyaasK/bootdev → Commits | New commit at `learn-go/interfaces/type-assertions.go` within ~10s |

### Failure-Mode Triage

| Symptom | Most Likely Cause | Fix |
|---|---|---|
| No console log `[bootdev→gh]` | Script disabled / URL mismatch / XHR path changed | Open Tampermonkey dashboard, verify script is enabled on `boot.dev`; check Network tab for XHR to `/v1/lessons/{uuid}/` |
| Console log but no commit | Worker returned error | Open CF Workers logs; check `GITHUB_TOKEN` scope, repo name, and `ALLOWED_USER` |
| Commit but wrong path | Metadata miss (courseTitle/chapterTitle/lessonTitle empty) | boot.dev SPA state shape may have changed; check `__REDUX_STATE__` or `bootDevState` on `window` in DevTools |
| 403 unauthorized from worker | `ALLOWED_USER` doesn't match `userUUID` in POST body | Verify env var `ALLOWED_USER` matches your boot.dev userUUID from network tab (`/v1/lessons/{uuid}/` response) |
| No commit, 400 missing metadata | `getLessonMetadata()` returns null | boot.dev changed their state shape; inspect `window.__REDUX_STATE__` or `window.bootDevState` |
| Double commits on one submit | Dedupe guard not working | Check browser console for two `[bootdev→gh]` logs; if both appear, `isDeduped()` is failing — check `dedupeSet` in console |

---

## CLI Surface (Shell Wrapper)

### Preconditions

- [ ] `bootdev` CLI installed and logged in (`bootdev` binary in PATH)
- [ ] Shell wrapper sourced (run `type bootdev` — should say `bootdev is a shell function`)
- [ ] Env vars set in your shell:
  - `WORKER_URL` — your cloudflare worker URL
  - `USER_UUID` — your boot.dev userUUID
- [ ] `~/.config/zsh/bootdev-wrap.zsh` exists (installed by `cli/install.sh`)
- [ ] `~/.zshrc` contains `source '~/.config/zsh/bootdev-wrap.zsh'`

### Steps

1. `cd` into a boot.dev lesson directory (where `main.go` or source files live)
2. Run: `bootdev submit`
3. Confirm the CLI shows its usual success output

### Expected Observable Outcomes

| Signal | Where to check | What you should see |
|---|---|---|
| Wrapper echo | Terminal | `[bootdev→gh] submit succeeded, auto-committing...` |
| Worker response | Terminal (after bootdev exits) | `[bootdev→gh] {ok:true, path:"learn-go/interfaces/type-assertions.go", commit:"feat(learn-go): type-assertions"}` |
| GitHub commit | github.com/IlyaasK/bootdev → Commits | New commit with lesson files + `.cli-logs/type-assertions-YYYY-MM-DDTHH-MM-SSZ.log` |

### Failure-Mode Triage

| Symptom | Most Likely Cause | Fix |
|---|---|---|
| CLI works, no commit | Wrapper not sourced in current shell | Run `type bootdev` — if it says `command -f` not `shell function`, wrapper isn't active |
| Commit missing `.cli-logs/` entry | `cliLog` not captured correctly | Check that `jq -Rs` succeeds in the wrapper; verify `stdout_content` + `stderr_content` are non-empty |
| Commit appears but files missing | File collection walked wrong dir | Confirm `pwd` at the moment the wrapper fires matches your lesson directory |
| 403 unauthorized | `USER_UUID` env var wrong or missing | Export correct value: `export USER_UUID="your-uuid"` and source wrapper |
| 400 missing metadata | CLI wrapper sends empty course/chapter/lesson titles | Known gap: CLI wrapper doesn't resolve titles from boot.dev API yet. Fields arrive empty, worker 400s |

---

## Regression Pass

After any code ticket lands, run both surfaces once (browser + CLI) and verify:

1. Browser path: submit a Go lesson → commit appears in GitHub
2. CLI path: `bootdev submit` in a lesson dir → commit with files + `.cli-logs/` appears

If a new failure mode is discovered, append it to the relevant triage table above. This doc is meant to grow with the project.