// bootdev-to-github worker
// env vars to set in CF dashboard:
//   GITHUB_TOKEN   - fine-grained PAT (contents: read+write)
//   GITHUB_OWNER   - your github username
//   GITHUB_REPO    - repo name, e.g. "bootdev"
//   ALLOWED_USER   - your boot.dev userUUID (guards against random POSTs)

// Language → file extension mapping (ticket 02)
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

// Default extension when language is unknown/missing
const DEFAULT_EXT = ".txt";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    if (request.method !== "POST") {
      return cors(new Response("method not allowed", { status: 405 }));
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return cors(new Response("bad json", { status: 400 }));
    }

    const { userUUID, lessonUUID, courseUUID, code, kind, courseTitle, chapterTitle, lessonTitle, courseLanguage, source, cliLog, files } = body;

    // Auth guard
    if (userUUID !== env.ALLOWED_USER) {
      return cors(new Response("unauthorized", { status: 403 }));
    }

    // Validate required fields (ticket 04: metadata now comes from POST body)
    if (!courseTitle || !chapterTitle || !lessonTitle) {
      return cors(new Response("missing required metadata fields: courseTitle, chapterTitle, lessonTitle", { status: 400 }));
    }

    // Determine file path and content based on request type
    let filePath, commitMsg;

    if (kind === "progress") {
      // Non-code lesson: write a markdown progress marker (ticket 03)
      const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const mdContent = `# ${lessonTitle}\n\ncompleted ${new Date().toISOString()}\n`;
      const pathBase = `${slug(courseTitle)}/${slug(chapterTitle)}/${slug(lessonTitle)}.md`;
      filePath = pathBase;
      commitMsg = `progress(${slug(courseTitle)}): ${lessonTitle}`;

      const result = await commitToGitHub(filePath, mdContent, commitMsg, env);
      if (!result.ok) {
        return cors(new Response(`github error: ${result.error}`, { status: 502 }));
      }
      return cors(new Response(JSON.stringify({ ok: true, path: filePath, commit: commitMsg }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }

    // Code-based submission (normal or CLI)
    if (!code && (!files || files.length === 0)) {
      // No code and no files — skip commit (ticket 03)
      return cors(new Response("no code or files provided, skipping commit", { status: 400 }));
    }

    const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    // Determine language and extension (ticket 02)
    const lang = (courseLanguage || "").toLowerCase().trim();
    const ext = LANGUAGE_EXT[lang] || DEFAULT_EXT;
    if (ext === DEFAULT_EXT && lang !== "") {
      console.warn(`unmapped language: ${lang}, using .txt`);
    }

    if (source === "cli" && files && files.length > 0) {
      // CLI multi-file submission (ticket 05)
      const courseSlug = slug(courseTitle);
      const chapterSlug = slug(chapterTitle);
      const lessonSlug = slug(lessonTitle);

      // Commit each file
      for (const f of files) {
        const fPath = `${courseSlug}/${chapterSlug}/${lessonSlug}/${f.path}`;
        const result = await commitToGitHub(fPath, f.content, `feat(${courseSlug}): ${lessonTitle}`, env);
        if (!result.ok) {
          return cors(new Response(`github error on ${fPath}: ${result.error}`, { status: 502 }));
        }
      }

      // Commit CLI log if present
      if (cliLog) {
        const logPath = `${courseSlug}/${chapterSlug}/.cli-logs/${lessonSlug}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
        await commitToGitHub(logPath, cliLog, `feat(${courseSlug}): ${lessonTitle}`, env);
      }

      commitMsg = `feat(${courseSlug}): ${lessonTitle}`;
      filePath = `${courseSlug}/${chapterSlug}/${lessonSlug}/*`;
    } else {
      // Single file browser submission
      filePath = `${slug(courseTitle)}/${slug(chapterTitle)}/${slug(lessonTitle)}${ext}`;
      commitMsg = `feat(${slug(courseTitle)}): ${lessonTitle}`;
    }

    // Commit to GitHub
    const result = await commitToGitHub(filePath, code || "", commitMsg, env);
    if (!result.ok) {
      return cors(new Response(`github error: ${result.error}`, { status: 502 }));
    }

    return cors(new Response(JSON.stringify({ ok: true, path: filePath, commit: commitMsg }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  },
};

async function commitToGitHub(path, content, message, env) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = env;
  const apiURL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;

  // Check if file exists (need SHA to update)
  const existing = await fetch(apiURL, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "User-Agent": "bootdev-worker",
    },
  });

  let sha;
  if (existing.ok) {
    const data = await existing.json();
    sha = data.sha;
  }

  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(apiURL, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "bootdev-worker",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: err };
  }

  return { ok: true };
}

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "https://www.boot.dev");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, { status: response.status, headers });
}