# bootdev-to-github

Auto-commits boot.dev lesson solutions to GitHub on every passing submission.

```
boot.dev (browser)
  → tampermonkey intercepts XHR + fetch
    → POST to cloudflare worker (HTTPS, free)
      → commits solution to IlyaasK/bootdev via github API
```

## repo structure

```
bootdev/
  learn-go/
    variables-and-types/
      creating-variables.go
    functions/
      multiple-return-values.go
  learn-git/
    ...
  learn-python/
    ...
  VERIFICATION.md
```

---

## setup

### 1. github repo

Create the target GitHub repo:
- Go to [github.com/new](https://github.com/new)
- Repository name: `bootdev`
- Keep it **public** (for portfolio signal)
- Do NOT initialize with README, .gitignore, or license
- Click **Create repository**

### 2. github personal access token

Create a fine-grained personal access token:
- github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token
- Resource owner: your account
- Repository access: only `bootdev`
- Permissions → Repository permissions → **contents: read and write**
- Generate and copy the token — save it, you won't see it again

### 3. cloudflare worker

Go to [workers.cloudflare.com](https://workers.cloudflare.com) → sign up (free) → dashboard.

**Create worker:**
- Workers & Pages → Create → Create Worker
- Name it anything (e.g. `bootdev-to-github`)
- Click "Edit code" → paste the contents of `bootdev-worker.js`
- Click **Deploy**

**Set environment variables:**
- Go to the worker → Settings → Variables & Secrets → add the following:

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | your fine-grained PAT from above |
| `GITHUB_OWNER` | your github username (e.g. `IlyaasK`) |
| `GITHUB_REPO` | `bootdev` |
| `ALLOWED_USER` | your boot.dev userUUID (see below) |

Click **Save and deploy**.

**Getting `ALLOWED_USER`:**
1. Open boot.dev in Firefox/Chrome
2. Open devtools → Network tab → filter by fetch/XHR
3. Click any lesson
4. Find any request to `api.boot.dev`
5. Click it → Headers tab
6. In the same request, check the request payload for `userUUID` — that's `ALLOWED_USER`

**Copy your worker URL:**
- It looks like `https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev`
- Save it for step 4

### 4. tampermonkey

Install the Tampermonkey browser extension:
- [Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)

**Install the script:**
- Tampermonkey icon → Dashboard → + (new script)
- Delete the default template
- Paste the contents of `bootdev.user.js`
- Find this line near the top:
  ```js
  const WORKER_URL = "https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/";
  ```
- Replace with your actual worker URL from step 3
- File → Save (or Ctrl+S)

---

## testing

### Test the worker directly

Open terminal and run:

```bash
curl -X POST https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/ \
  -H "Content-Type: application/json" \
  -d '{
    "userUUID": "YOUR_USER_UUID",
    "lessonUUID": "7af7c74b-99bb-4420-9fa4-275fb8ec7a5a",
    "courseUUID": "3b39d0f6-f944-4f1b-832d-a1daba32eda4",
    "courseTitle": "learn-go",
    "chapterTitle": "variables-and-types",
    "lessonTitle": "creating-variables",
    "courseLanguage": "go",
    "code": "package main\n\nfunc main() {}\n"
  }'
```

Expected response:
```json
{ "ok": true, "path": "learn-go/variables-and-types/creating-variables.go", "commit": "feat(learn-go): creating-variables" }
```

Check the repo — a new file should appear within seconds.

If you get an error, check:
- CF dashboard → Worker → Logs (real-time logs available under "Observability")
- The env vars are set correctly

### Test the full flow

1. Open boot.dev in the browser with Tampermonkey enabled
2. Open devtools → Console tab
3. Solve and **submit** (not just run) a lesson until it passes
4. Watch the console for:
   ```
   [bootdev→gh] feat(learn-go): your-lesson-title
   ```
5. Check the repo for the new commit

### If nothing happens

- Make sure you hit **submit** not just **run** — the hook fires on the submit endpoint, not lessonRun
- Check Tampermonkey dashboard → the script should show as "enabled" on boot.dev
- Check console for `[bootdev→gh] error` messages
- Check CF worker logs for incoming requests

---

## CLI submissions (optional)

The `bootdev` CLI can also auto-commit via a shell wrapper. See the [CLI install script](cli/install.sh) in this repo.

**Prerequisites:** `jq` is required (install via `brew install jq`).

**Setup:**
```zsh
# Export these before installing the wrapper
export WORKER_URL="https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/"
export USER_UUID="your-boot-dot-uuid-here"

# Install the wrapper
zsh cli/install.sh

# Reload your shell
source ~/.config/zsh/bootdev-wrap.zsh
```

The wrapper resolves lesson metadata (course/chapter/lesson title, language) automatically from the boot.dev API using your CLI's stored auth token.

---

## files

| File | Purpose |
|---|---|
| `bootdev-worker.js` | Cloudflare Worker source — deploy this |
| `bootdev.user.js` | Tampermonkey script — install in browser |
| `cli/install.sh` | CLI wrapper installer (optional) |
| `README.md` | This file |