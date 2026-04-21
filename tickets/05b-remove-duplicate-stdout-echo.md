# Ticket 05b — remove duplicate stdout replay in the bootdev wrapper

## background

ticket 05a migrated the wrapper from a capture-then-replay model to live passthrough via
`tee` in process substitution. that change landed correctly at `cli/install.sh:42`:

```zsh
"$real_bootdev" "$@" > >(tee "$tmpout") 2> >(tee "$tmperr" >&2)
```

`tee` writes to the tempfile AND forwards to the terminal in real time, so the user
already sees every line of `bootdev submit` output as it happens.

**but the old replay line was not removed.** at `cli/install.sh:179`, right before the
function returns:

```zsh
echo -n "$stdout_content"
return $exit_code
```

this prints the entire captured stdout *a second time*. net effect: every line of
`bootdev submit` output appears twice in the user's terminal — once live, once dumped
at the end. this is strictly a leftover from the pre-tee implementation.

## fix

delete the `echo -n "$stdout_content"` line at `cli/install.sh:179`. keep the
`return $exit_code` on the next line — that's what preserves the CLI's exit code and is
still needed.

that's it. one line deletion.

## acceptance criteria

- `cli/install.sh` no longer contains `echo -n "$stdout_content"` anywhere.
- running `bootdev <anything>` in a wrapped shell produces output exactly once — no
  duplication.
- exit code propagation still works: `bootdev --help; echo $?` returns `0`; a failing
  command returns its non-zero code.
- the auto-commit path (POST to worker on `submit` success) is unaffected.

## files to touch

- cli/install.sh (one-line deletion)

## out of scope

- anything else in the wrapper. resist the urge to clean up the redundant
  `case` inside the `find` loop, the YAML-grep fragility, or the tee race. those are
  logged in AGENTS.md "known limitations" and are explicitly deferred.

## verification

```zsh
# reload wrapper
source ~/.config/zsh/bootdev-wrap.zsh

# any command that produces output
bootdev --help
# expect: help text printed ONCE, not twice

# success path still works
cd <lesson-dir>
bootdev submit
# expect:
#   1. bootdev's normal output streams to terminal (once)
#   2. after exit: [bootdev→gh] submit succeeded, auto-committing...
#   3. [bootdev→gh] {...worker response...}
# do NOT expect: bootdev's stdout replayed between steps 1 and 2
```
