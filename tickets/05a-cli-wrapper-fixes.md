# Ticket 05a — fix CLI wrapper: encoding, recursion, metadata, output passthrough

## background (read this, don't skim)

ticket 05 shipped a zsh wrapper at `cli/install.sh` that shadows the `bootdev` command
and POSTs CLI submissions to the worker. four real bugs make the CLI path unusable today.
this ticket fixes all four — they're all in the same file, so grouping them saves handoff
overhead.

**do not rewrite the wrapper from scratch.** fix the four issues below and leave the rest.

## bug 1 — double base64 encoding

**symptom:** every CLI-committed file is base64-of-base64 on github; github's UI shows a
file containing a base64 string rather than your source code.

**cause:** `cli/install.sh:70` runs `base64 -w 0` on file content. the worker at
`bootdev-worker.js:150` then runs `btoa(unescape(encodeURIComponent(content)))` on what
it receives, which is already base64 → wrapped again. github decodes once, gets base64.

**fix:** establish a clear contract. two acceptable options:

- **option A (preferred):** CLI sends raw UTF-8 file content, worker encodes exactly once.
  this means the shell side must produce valid JSON around the raw content. use `jq -Rs`
  (raw slurp) to read each file into a JSON string — it handles quotes, backslashes, and
  newlines correctly. zero changes to the worker.
- **option B:** CLI base64-encodes, and sends a flag the worker can read, e.g.
  `"encoding": "base64"`. worker checks the flag per-file and skips re-encoding.
  worker change is small.

go with **option A**. it keeps the worker simple and aligns CLI behavior with the browser
path (which already sends raw text).

**acceptance:** a CLI submit produces a committed file whose contents, when viewed on
github, are exactly the bytes of the local source file. confirm by diffing the local file
against `curl https://raw.githubusercontent.com/...` of the committed file.

## bug 2 — infinite recursion risk on `command -v bootdev`

**symptom:** inside the `bootdev()` function, `command -v bootdev` can return the string
`"bootdev"` (the function name), not the binary path. calling `"$real_bootdev" "$@"` then
invokes the wrapper again → stack overflow or undefined behavior.

**fix:** use zsh's `whence -p bootdev` which returns ONLY the path of the external binary,
skipping functions and aliases. example:

```zsh
real_bootdev="$(whence -p bootdev)" || {
  echo "[bootdev→gh] error: bootdev binary not found in PATH" >&2
  return 127
}
```

**acceptance:** `type bootdev` shows `bootdev is a shell function`, AND running
`bootdev --help` inside a wrapped shell returns the real CLI's help output (not a
recursion error). adding `set -x` to the wrapper briefly should show `whence -p` resolving
to `/usr/local/bin/bootdev` or wherever it lives.

## bug 3 — metadata fields ship empty → worker 400s every submit

**symptom:** every CLI submit gets `400 missing required metadata fields`.

**cause:** in `cli/install.sh` the variables `course_title`, `chapter_title`, `lesson_title`,
`course_language` are declared empty and never populated. the `for cfg in .bootdev.yaml ...`
loop only tries (poorly) to extract `lesson_uuid`.

**fix:** resolve metadata by calling the boot.dev API *using the CLI's own auth*, the same
way the real `bootdev` binary authenticates itself. the CLI stores its bearer token in
`~/.config/bootdev/viper-config.yaml` (verify the exact path by inspecting the user's
machine — the CLI is viper-based, so it could also be `~/.bootdev/viper-config.yaml` or
`$XDG_CONFIG_HOME/bootdev/`; pick the one that exists).

the flow:

1. read the access token out of the viper config (YAML → `access_token` field or similar;
   do a `grep -E` or use `yq` if available).
2. read the lesson UUID from the lesson's local `.bootdev.yaml` (the CLI writes one when
   you start a lesson — verify the field name; likely `lesson_uuid` or `uuid`).
3. `curl` `https://api.boot.dev/v1/static/lessons/{lesson_uuid}` with
   `Authorization: Bearer <token>`. parse `CourseTitle`, `ChapterTitle`, `Title`,
   `CourseLanguage` out of the response using `jq`.
4. if any of those four come back empty/missing, print a clear error and DO NOT POST to
   the worker. never send empty metadata.

this does mean the wrapper has a hard dependency on `jq` being installed. that's fine —
add a precheck at the top (`command -v jq >/dev/null || { echo "install jq"; return 1; }`)
and document it in the README.

**acceptance:** a CLI submit in a real lesson directory produces a commit with a sensible
path (`<slug(courseTitle)>/<slug(chapterTitle)>/<slug(lessonTitle)>/<filename>`). the
worker log shows no 400s. if the viper config is missing or the token is expired, the
wrapper prints a helpful error and doesn't post.

## bug 4 — real-time CLI output is swallowed

**symptom:** `bootdev submit` appears to hang (no output) while it runs; only at the end
is stdout dumped all at once, and stderr is silently discarded.

**cause:** `"$real_bootdev" "$@" 2>"$tmperr" 1>"$tmpout"` redirects both streams to
tempfiles, so nothing reaches the user's terminal until the command exits. the final
`echo -n "$stdout_content"` only replays stdout — stderr is thrown away.

**fix:** use `tee` to fork each stream to both the terminal AND a tempfile, so the user
sees output in real time AND we still have it to send as `cliLog`. sketch:

```zsh
tmpout=$(mktemp); tmperr=$(mktemp)
"$real_bootdev" "$@" > >(tee "$tmpout") 2> >(tee "$tmperr" >&2)
exit_code=$?
stdout_content=$(<"$tmpout"); stderr_content=$(<"$tmperr")
rm -f "$tmpout" "$tmperr"
```

this uses zsh/bash process substitution. if the user hits edge cases (interactive prompts
from the CLI), a PTY wrapper via `script` is the next step — but try the `tee` approach
first; for `bootdev submit` specifically it should be sufficient.

**acceptance:**
- running `bootdev submit` in a wrapped shell shows output streaming in real time, same
  as the unwrapped binary.
- exit code is preserved (`echo $?` after the wrapper returns matches the binary's
  actual exit code).
- colors are preserved if the real CLI emits them (tee doesn't strip ANSI codes).
- stderr is visible to the user AND included in `cliLog` that gets committed.

## scope notes

- don't touch the worker for this ticket — bug 1's fix is shell-side (option A).
- don't add tests/CI. shell scripts are manually verified.
- the success-marker regex (`(success|completed|passed|✓)`) and the `find -maxdepth 3`
  file collection can stay as-is for now; they're imperfect but not blocking. note them
  as future cleanup in AGENTS.md "known limitations" if you want.
- the README.md section on CLI usage needs a one-line update if you add `jq` as a
  dependency.

## files to touch

- cli/install.sh (all four bugs)
- README.md (mention `jq` dependency)
- AGENTS.md (update CLI path description if the auth/metadata source changes)

## verification

```zsh
# reload wrapper
source ~/.config/zsh/bootdev-wrap.zsh

# in a real lesson dir
bootdev submit
# expect: live output during submit, success marker, then:
# [bootdev→gh] {"ok":true,"path":"...","commit":"..."}

# verify the committed file actually contains source code, not base64
curl -s https://raw.githubusercontent.com/IlyaasK/bootdev/main/<course>/<chapter>/<lesson>/main.go | diff - main.go
# expect: no diff
```
