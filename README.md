# bootdev-to-github

Auto-commits boot.dev lesson solutions to a local GitHub repository on every passing submission.

```
boot.dev (browser)
  → tampermonkey intercepts XHR + fetch
    → POST to local Go daemon (http://localhost:8080)
      → commits solution to local bootdev repo via git CLI
```

## repo structure

```
bootdev-to-github/      ← this repo (daemon + scripts)
  local-server/         ← Go daemon
  bootdev.user.js       ← tampermonkey script
  cli/install.sh        ← CLI wrapper installer

../bootdev/             ← your local target repo (auto-committed to)
  learn-go/
    variables-and-types/
      creating-variables.go
  ...
```

---

## setup

### 1. target repo

Ensure you have your target repository cloned locally. By default, the daemon looks for a directory named `bootdev` at the same level as this repository (`../bootdev`).

If your repository is located elsewhere, you can set the `TARGET_DIR` environment variable when running the daemon.

### 2. local go daemon

The daemon listens for submissions and commits them to your local repository.

```bash
cd local-server
go run main.go
```

The server will start on `http://127.0.0.1:8080`. Leave this running in the background while you work on boot.dev.

### 3. tampermonkey

Install the Tampermonkey browser extension:
- [Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)

**Install the script:**
- Tampermonkey icon → Dashboard → + (new script)
- Delete the default template
- Paste the contents of `bootdev.user.js`
- File → Save (or Ctrl+S)

---

## testing

### Test the daemon directly

Open a terminal and run:

```bash
curl -X POST http://localhost:8080/ \
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
{ "ok": true, "commit": "feat(learn-go): creating-variables" }
```

Check your local `bootdev` repo — a new file should appear and a commit should be created.

### Test the full flow

1. Make sure your local Go daemon is running.
2. Open boot.dev in the browser with Tampermonkey enabled.
3. Open devtools → Console tab.
4. Solve and **submit** (not just run) a lesson until it passes.
5. Watch the console for:
   ```
   [bootdev→gh] feat(learn-go): your-lesson-title
   ```
6. Check your local repo for the new commit.

---

## CLI submissions (optional)

The `bootdev` CLI can also auto-commit via a shell wrapper. See the [CLI install script](cli/install.sh) in this repo.

**Prerequisites:** `jq` is required (install via `brew install jq`).

**Setup:**
```zsh
# Install the wrapper (defaults to http://localhost:8080/)
zsh cli/install.sh

# Reload your shell
source ~/.config/zsh/bootdev-wrap.zsh
```

The wrapper resolves lesson metadata automatically from the boot.dev API using your CLI's stored auth token, and sends it to your local daemon.