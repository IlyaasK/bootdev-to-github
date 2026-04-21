# Ticket 05 — capture `bootdev` CLI submissions and auto-commit them

## context
boot.dev has two surfaces:
1. the browser IDE (handled by tampermonkey today).
2. the `bootdev` CLI (https://github.com/bootdotdev/bootdev) — used for courses where
   lessons run locally against real files (learn-git, learn-linux, learn-http-servers, etc.).

the user wants CLI submissions auto-committed to `IlyaasK/bootdev` just like browser
submissions, AND wants CLI runs "logged" — i.e. the input command and output captured so
commits on the github graph reflect local work too.

the CLI is typically invoked as `bootdev run` (local test) and `bootdev submit` (remote
verification against boot.dev's servers). we care about `submit` success because that's
what indicates the lesson passed. `bootdev run` is local-only and isn't authoritative.

## design: shell wrapper around the `bootdev` binary

the cleanest, non-invasive approach is a shell function that shadows the `bootdev` command:
- user types `bootdev submit` as normal.
- the wrapper invokes the real binary, captures stdout/stderr and exit code.
- if the command was `submit` AND exit code is 0 AND stdout indicates success:
  - wrapper collects the code files from the current working directory (the lesson dir).
  - wrapper reads the lesson UUID (the CLI stores it — see "implementation notes" below).
  - wrapper POSTs to the same cloudflare worker as the browser path, with a new `source: "cli"`
    field so the worker can distinguish.

the user's shell is zsh (confirmed by the ZDOTDIR env in session). place the wrapper in
`~/.config/zsh/bootdev-wrap.zsh` and source it from their existing zsh init.

## acceptance criteria
- a zsh function `bootdev` is defined in `~/.config/zsh/bootdev-wrap.zsh` that:
  - forwards all args to the real `bootdev` binary (resolved via `command bootdev` to
    avoid infinite recursion).
  - preserves exit code, stdout, stderr — user sees no difference in normal use.
  - only triggers the auto-commit path when:
    - `$1 == "submit"`
    - real binary exit code is 0
    - stdout contains the CLI's success marker (check the real CLI's output format — likely
      a line like `Lesson completed successfully` or a green checkmark; verify by reading
      https://github.com/bootdotdev/bootdev source or running `bootdev submit` once)
- the wrapper POSTs to the worker with:
  ```json
  {
    "userUUID": "...",
    "lessonUUID": "...",
    "courseUUID": "...",
    "courseTitle": "...",
    "chapterTitle": "...",
    "lessonTitle": "...",
    "courseLanguage": "...",
    "code": "<concatenated or primary file contents>",
    "source": "cli",
    "cliLog": "<stdout+stderr from the bootdev submit run>"
  }
  ```
- the worker writes the code file as usual, AND writes the CLI log to
  `<course>/<chapter>/.cli-logs/<lesson>-<ISO timestamp>.log` so each submission has an
  audit trail. (single commit, both files in one PUT is ideal but two PUTs is acceptable.)
- commit message format: `feat(<course>/cli): <lesson title>` to distinguish from browser
  commits. the `/cli` suffix is optional — local AI can choose.
- installing the wrapper does not break existing shell behavior when the `bootdev` binary
  is not installed.
- config: the wrapper reads `WORKER_URL` and `USER_UUID` from env vars (document these in
  README) so the user doesn't have to edit the script to rotate.

## implementation notes & open questions
- **how does the CLI know which lesson you're on?** likely via a `.bootdev.yaml` file in the
  lesson dir, or a `bootdev.yaml` at repo root with a lesson UUID field. read the real CLI
  source/docs to confirm. this is the canonical source for `lessonUUID`.
- **how does the CLI know the userUUID?** from its config file, typically
  `~/.bootdev/viper-config.yaml` or similar (it's a viper-based CLI). parse that to get
  the user's identity once, cache in the wrapper.
- **metadata resolution (course/chapter/lesson titles, language):** the CLI's config or
  the boot.dev API (using the CLI's own bearer token from its config) can resolve these.
  don't reinvent — reuse the CLI's auth.
- **collecting code:** for CLI lessons, all files in the lesson directory are the solution
  (e.g. `main.go`, `go.mod`, `server/handler.go`). concatenate? or commit them as separate
  files under the lesson path? recommend committing each file under
  `<course>/<chapter>/<lesson>/<filename>` — preserves structure and matches how CLI
  lessons are actually laid out.
- **this changes the worker's data model:** single `code` string no longer sufficient.
  worker needs to accept either `code: string` (browser, one file) OR `files: [{path, content}]`
  (CLI, multi-file). update the worker to handle both shapes.
- **testing:** install the wrapper, run `bootdev submit` on a known passing lesson. verify:
  - CLI output is identical to unwrapped behavior.
  - commit appears in the github repo with files correctly structured.
  - `.cli-logs/` entry has the captured output.

## depends on
- ticket 04 (move metadata to client) — this ticket inherits the same POST body shape.
  if 04 isn't landed, this ticket can send metadata via the CLI's boot.dev token path;
  pick whichever is less work given the state at implementation time.

## files to create / touch
- new: `~/.config/zsh/bootdev-wrap.zsh` (wrapper function)
- new: `cli/install.sh` in this repo (one-command installer that writes the wrapper and
  adds the `source` line to the user's zshrc if missing)
- update: bootdev-worker.js (accept `files: []` shape, handle `cliLog`, write log file)
- update: README.md (document the CLI wrapper install + env vars)
- update: AGENTS.md (record the new dual-surface architecture)

## out of scope
- capturing `bootdev run` (local test) activity. we only care about `submit` success.
- fish/bash support — the user uses zsh. leave a TODO comment for future shells.
- a full bash-script-free daemon / file watcher approach. the shell wrapper is sufficient.
