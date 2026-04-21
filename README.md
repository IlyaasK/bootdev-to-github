# bootdev-progress

auto-commits boot.dev lesson solutions to github on every passing submission.

```
boot.dev (browser)
  → tampermonkey intercepts XHR
    → POST to cloudflare worker (HTTPS, free)
      → fetches lesson metadata from boot.dev API
        → commits solution to this repo via github API
```

---

## repo structure

```
bootdev-progress/
  learn-go/
    variables-and-types/
      creating-variables.go
    functions/
      multiple-return-values.go
  learn-git/
    ...
  README.md
```

---

## setup

### 1. github repo

create this repo (already done if you're reading this).

create a fine-grained personal access token:
- github.com → settings → developer settings → personal access tokens → fine-grained tokens → generate new token
- resource owner: your account
- repository access: only `bootdev-progress`
- permissions → repository permissions → **contents: read and write**
- generate and copy the token — save it, you won't see it again

---

### 2. cloudflare worker

go to [workers.cloudflare.com](https://workers.cloudflare.com) → sign up (free) → dashboard.

**create worker:**
- workers & pages → create → create worker
- name it `bootdev-progress` or anything
- click "edit code" → paste the contents of `bootdev-worker.js`
- click deploy

**set environment variables:**
- go to the worker → settings → variables → add the following:

| variable | value |
|---|---|
| `GITHUB_TOKEN` | your fine-grained PAT from step 1 |
| `GITHUB_OWNER` | your github username |
| `GITHUB_REPO` | `bootdev-progress` |
| `BOOTDEV_TOKEN` | your boot.dev bearer token (see below) |
| `ALLOWED_USER` | your boot.dev userUUID (see below) |

- click **encrypt** on each value before saving
- click save and deploy

**getting `BOOTDEV_TOKEN` and `ALLOWED_USER`:**
1. open boot.dev in firefox/chrome
2. open devtools → network tab → filter by fetch/XHR
3. click any lesson
4. find any request to `api.boot.dev`
5. click it → headers tab
6. look for `Authorization: Bearer <token>` — copy everything after `Bearer `
7. in the same request, check the request payload for `userUUID` — that's `ALLOWED_USER`

> ⚠️ the boot.dev token expires periodically. if commits stop working, repeat this step and update `BOOTDEV_TOKEN` in CF dashboard.

**copy your worker URL:**
- it looks like `https://bootdev-progress.YOUR-SUBDOMAIN.workers.dev`
- save it for step 4

---

### 3. tampermonkey

install the tampermonkey browser extension:
- [chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)

**install the script:**
- tampermonkey icon → dashboard → + (new script)
- delete the default template
- paste the contents of `bootdev.user.js`
- find this line near the top:
  ```js
  const WORKER_URL = "https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/";
  ```
- replace with your actual worker URL from step 2
- file → save (or ctrl+s)

---

## testing

### test the worker directly

open terminal and run:

```bash
curl -X POST https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/ \
  -H "Content-Type: application/json" \
  -d '{
    "userUUID": "YOUR_USER_UUID",
    "lessonUUID": "7af7c74b-99bb-4420-9fa4-275fb8ec7a5a",
    "courseUUID": "3b39d0f6-f944-4f1b-832d-a1daba32eda4",
    "code": "package main\n\nfunc main() {}\n"
  }'
```

expected response:
```json
{ "ok": true, "path": "learn-go/interfaces/...", "commit": "feat(learn-go): ..." }
```

check the repo — a new file should appear within seconds.

if you get an error, check:
- CF dashboard → worker → logs (real-time logs available under "observability")
- the env vars are set correctly and encrypted values were saved

### test the full flow

1. open boot.dev in the browser with tampermonkey enabled
2. open devtools → console tab
3. solve and **submit** (not just run) a lesson until it passes
4. watch the console for:
   ```
   [bootdev→gh] feat(learn-go): your-lesson-title
   ```
5. check this repo for the new commit

### if nothing happens

- make sure you hit **submit** not just **run** — the hook fires on the submit endpoint, not lessonRun
- check tampermonkey dashboard → the script should show as "enabled" on boot.dev
- check console for `[bootdev→gh] error` messages
- check CF worker logs for incoming requests

---

## token refresh

boot.dev tokens expire. when commits stop:

1. open boot.dev → devtools → network tab
2. find any `api.boot.dev` request → headers → copy the new `Authorization: Bearer ...` value
3. CF dashboard → bootdev-progress worker → settings → variables → update `BOOTDEV_TOKEN`
4. save and deploy

---

## files

| file | purpose |
|---|---|
| `bootdev-worker.js` | cloudflare worker source — deploy this |
| `bootdev.user.js` | tampermonkey script — install this in browser |
| `README.md` | this file |
