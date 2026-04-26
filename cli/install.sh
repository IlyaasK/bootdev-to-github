#!/usr/bin/env zsh
# == install.sh — bootdev CLI wrapper installer (ticket 05)
# Usage: curl -sSL https://raw.githubusercontent.com/IlyaasK/bootdev-to-github/main/cli/install.sh | zsh
# OR:   zsh cli/install.sh

set -e

WRAPPER_DIR="$HOME/.config/zsh"
WRAPPER_FILE="$WRAPPER_DIR/bootdev-wrap.zsh"

# ─── read env vars from user or default ───
WORKER_URL="${WORKER_URL:-http://localhost:8080/}"
: "${USER_UUID:?Set USER_UUID to your boot.dev userUUID}"

# ─── create wrapper script ───
mkdir -p "$WRAPPER_DIR"

cat > "$WRAPPER_FILE" << 'WRAPPER_EOF'
# bootdev CLI wrapper — auto-commits `bootdev submit` results to github
# sourced from ~/.zshrc or ~/.config/zsh/zshrc

bootdev() {
  # Precheck: jq is required for metadata resolution and safe JSON encoding
  if ! command -v jq &>/dev/null; then
    echo "[bootdev→gh] error: jq is required. install with: brew install jq" >&2
    return 127
  fi

  # Use whence -p to skip shell functions/aliases, get external binary path only
  local real_bootdev
  real_bootdev="$(whence -p bootdev)" || {
    echo "[bootdev→gh] error: bootdev binary not found in PATH" >&2
    return 127
  }

  # Real-time output passthrough via tee process substitution
  local tmpout
  tmpout=$(mktemp)
  local tmperr
  tmperr=$(mktemp)

  "$real_bootdev" "$@" > >(tee "$tmpout") 2> >(tee "$tmperr" >&2)
  local exit_code=$?

  local stdout_content
  stdout_content=$(<"$tmpout")
  local stderr_content
  stderr_content=$(<"$tmperr")

  rm -f "$tmpout" "$tmperr"

  # Only trigger auto-commit on `submit` with exit code 0
  if [[ "$1" == "submit" && $exit_code -eq 0 ]]; then
    # Check for success marker in stdout
    if echo "$stdout_content" | grep -qiE "(success|completed|passed|✓)"; then
      echo "[bootdev→gh] submit succeeded, auto-committing..."

      # Collect code files from current directory
      local files_json="[]"
      local file_list=()
      while IFS= read -r -d '' f; do
        # Only include source code files
        case "$f" in
          *.go|*.py|*.js|*.ts|*.sql|*.sh|*.rb|*.rs|*.java)
            file_list+=("$f")
            ;;
        esac
      done < <(find . -maxdepth 3 -type f \( -name "*.go" -o -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.sql" -o -name "*.sh" -o -name "*.rb" -o -name "*.rs" -o -name "*.java" \) -print0 2>/dev/null)

      # Build files JSON array (raw UTF-8 content, worker handles encoding)
      if [[ ${#file_list[@]} -gt 0 ]]; then
        files_json="["
        local first=true
        for f in "${file_list[@]}"; do
          local rel_path="${f#./}"
          # Use jq -Rs to safely JSON-encode raw file content (handles quotes, backslashes, newlines)
          local encoded_content
          encoded_content=$(jq -Rs . < "$f")
          if [[ "$first" == true ]]; then
            first=false
          else
            files_json+=","
          fi
          # Escape the path for JSON safety (use jq)
          local encoded_path
          encoded_path=$(echo -n "$rel_path" | jq -Rs .)
          files_json+="{\"path\":${encoded_path},\"content\":${encoded_content}}"
        done
        files_json+="]"
      fi

      # Resolve metadata from boot.dev API using CLI's own auth (viper config)
      local lesson_uuid=""
      local course_title=""
      local chapter_title=""
      local lesson_title=""
      local course_language=""

      # Step 1: find lesson UUID from .bootdev.yaml / bootdev.yaml
      for cfg in .bootdev.yaml bootdev.yaml ~/.config/bootdev/viper-config.yaml ~/.bootdev/viper-config.yaml; do
        if [[ -f "$cfg" ]]; then
          lesson_uuid=$(grep -iE '(lesson_uuid|uuid):' "$cfg" 2>/dev/null | head -1 | sed 's/.*: *//' | tr -d ' "')
          if [[ -n "$lesson_uuid" ]]; then
            break
          fi
        fi
      done

      # Step 2: read access token from viper config (YAML)
      local token=""
      for cfg in ~/.config/bootdev/viper-config.yaml ~/.bootdev/viper-config.yaml; do
        if [[ -f "$cfg" ]]; then
          token=$(grep -E '(access_token|token|bearer)' "$cfg" 2>/dev/null | head -1 | sed 's/.*: *//' | tr -d ' "')
          if [[ -n "$token" ]]; then
            break
          fi
        fi
      done

      # Step 3: if we have a lesson UUID and token, resolve metadata from boot.dev API
      if [[ -z "$lesson_uuid" ]]; then
        echo "[bootdev→gh] warn: could not find lesson UUID, skipping auto-commit" >&2
      elif [[ -z "$token" ]]; then
        echo "[bootdev→gh] warn: could not find boot.dev auth token, skipping auto-commit" >&2
      else
        local api_response
        api_response=$(curl -sS -H "Authorization: Bearer $token" \
          "https://api.boot.dev/v1/static/lessons/${lesson_uuid}" 2>/dev/null)

        if [[ -n "$api_response" ]]; then
          course_title=$(echo "$api_response" | jq -r '.CourseTitle // .courseTitle // empty' 2>/dev/null)
          chapter_title=$(echo "$api_response" | jq -r '.ChapterTitle // .chapterTitle // empty' 2>/dev/null)
          lesson_title=$(echo "$api_response" | jq -r '.Title // .title // empty' 2>/dev/null)
          course_language=$(echo "$api_response" | jq -r '.CourseLanguage // .courseLanguage // empty' 2>/dev/null)
        fi
      fi

      # Validate required metadata fields — never send empty metadata
      local missing_fields=""
      [[ -z "$course_title" ]] && missing_fields+=" courseTitle"
      [[ -z "$chapter_title" ]] && missing_fields+=" chapterTitle"
      [[ -z "$lesson_title" ]] && missing_fields+=" lessonTitle"
      [[ -z "$course_language" ]] && missing_fields+=" courseLanguage"

      if [[ -n "$missing_fields" ]]; then
        echo "[bootdev→gh] warn: missing metadata fields:${missing_fields} — skipping auto-commit" >&2
      else
        # Get user UUID from env or bootdev config
        local user_uuid="${USER_UUID:-}"

        # POST to worker (multi-file + cliLog)
        local cli_log="${stdout_content}"$'\n'"${stderr_content}"

        if command -v curl &>/dev/null; then
          local post_body
          post_body=$(jq -n \
            --arg userUUID "$user_uuid" \
            --arg lessonUUID "$lesson_uuid" \
            --arg courseTitle "$course_title" \
            --arg chapterTitle "$chapter_title" \
            --arg lessonTitle "$lesson_title" \
            --arg courseLanguage "$course_language" \
            --arg source "cli" \
            --arg cliLog "$cli_log" \
            --argjson files "$files_json" \
            '{userUUID:$userUUID, lessonUUID:$lessonUUID, courseTitle:$courseTitle, chapterTitle:$chapterTitle, lessonTitle:$lessonTitle, courseLanguage:$courseLanguage, source:$source, cliLog:$cliLog, files:$files}')

          curl -sS -XPOST "$WORKER_URL" \
            -H "Content-Type: application/json" \
            -d "$post_body" 2>/dev/null | while read -r line; do
              echo "[bootdev→gh] $line"
            done
        fi
      fi
    fi
  fi

  # preserve CLI exit code (output already streamed live via tee)
  return $exit_code
}
WRAPPER_EOF

# ─── add source line to zshrc if missing ───
ZSHRC="$HOME/.zshrc"
SOURCE_LINE="source '$WRAPPER_FILE'"

if [[ -f "$ZSHRC" ]] && grep -qF "$SOURCE_LINE" "$ZSHRC"; then
  echo "[bootdev→gh] wrapper already sourced in $ZSHRC"
elif [[ -f "$ZSHRC" ]]; then
  echo "" >> "$ZSHRC"
  echo "# bootdev CLI auto-commit wrapper" >> "$ZSHRC"
  echo "$SOURCE_LINE" >> "$ZSHRC"
  echo "[bootdev→gh] added wrapper source to $ZSHRC"
else
  echo "$SOURCE_LINE" > "$ZSHRC"
  echo "[bootdev→gh] created $ZSHRC with wrapper source"
fi

echo "[bootdev→gh] installed wrapper to $WRAPPER_FILE"
echo "[bootdev→gh] run 'source $WRAPPER_FILE' or restart your shell to activate."