// bootdev-progress worker
// env vars to set in CF dashboard:
//   GITHUB_TOKEN   - fine-grained PAT (contents: read+write)
//   GITHUB_OWNER   - your github username
//   GITHUB_REPO    - repo name, e.g. "bootdev-progress"
//   BOOTDEV_TOKEN  - your boot.dev Bearer token
//   ALLOWED_USER   - your boot.dev userUUID (guards against random POSTs)

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

    const { userUUID, lessonUUID, courseUUID, code } = body;

    if (userUUID !== env.ALLOWED_USER) {
      return cors(new Response("unauthorized", { status: 403 }));
    }

    // fetch lesson metadata from boot.dev
    const meta = await fetchMeta(lessonUUID, env.BOOTDEV_TOKEN);
    if (!meta) {
      return cors(new Response("failed to fetch lesson metadata", { status: 502 }));
    }

    const { courseTitle, chapterTitle, lessonTitle } = meta;

    // sanitize for use in paths
    const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const filePath = `${slug(courseTitle)}/${slug(chapterTitle)}/${slug(lessonTitle)}.go`;
    const commitMsg = `feat(${slug(courseTitle)}): ${lessonTitle}`;

    // commit to github
    const result = await commitToGitHub(filePath, code, commitMsg, env);
    if (!result.ok) {
      return cors(new Response(`github error: ${result.error}`, { status: 502 }));
    }

    return cors(new Response(JSON.stringify({ ok: true, path: filePath, commit: commitMsg }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  },
};

async function fetchMeta(lessonUUID, token) {
  const res = await fetch(`https://api.boot.dev/v1/static/lessons/${lessonUUID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    courseTitle: data.CourseTitle ?? "unknown-course",
    chapterTitle: data.ChapterTitle ?? "unknown-chapter",
    lessonTitle: data.Title ?? lessonUUID,
  };
}

async function commitToGitHub(path, content, message, env) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = env;
  const apiURL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;

  // check if file exists (need SHA to update)
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
