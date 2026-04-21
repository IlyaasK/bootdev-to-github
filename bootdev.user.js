// ==UserScript==
// @name         bootdev → github commits
// @namespace    http://tampermonkey.net/
// @version      2.0
// @match        https://www.boot.dev/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  // ← paste your CF worker URL here
  const WORKER_URL = "https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/";

  // cache code from lessonRun keyed by lessonUUID
  const codeCache = {};

  // save original fetch BEFORE wrapping — used for worker POSTs so we don't
  // recursively call the wrapped version
  const origFetchRef = window.fetch.bind(window);

  // dedupe guard: track lessonUUIDs that already fired a worker POST (ticket 06a)
  const lastFired = new Map();
  const DEDUPE_WINDOW_MS = 10_000;

  function isDeduped(lessonUUID) {
    if (!lessonUUID) return false;
    const now = Date.now();
    const last = lastFired.get(lessonUUID);
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) {
      return true;
    }
    lastFired.set(lessonUUID, now);
    return false;
  }

  // ─── fetch() intercept (ticket 06) ───
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    const method = (args[1]?.method || "GET").toUpperCase();

    // intercept lessonRun → cache code
    if (method === "POST" && url.includes("/v1/lessonRun")) {
      const clone = args[0];
      if (args[1]?.body) {
        try {
          const data = JSON.parse(args[1].body);
          const lessonUUID = data?.lessonRun?.lessonUUID;
          const files = data?.files;
          if (lessonUUID && files) {
            const mainFile = files.find(f => f.Name === "main.go") || files[0];
            if (mainFile) {
              codeCache[lessonUUID] = mainFile.Content;
            }
          }
        } catch {}
      }
    }

    return origFetch.apply(window, args).then((response) => {
      // For fetch-based submit endpoints, check the response
      if (method === "POST" && /\/v1\/lessons\/[^/]+\/$/.test(url)) {
        const clone = response.clone();
        clone.json().then((res) => {
          if (res.ResultSlug === "success") {
            handleSubmitSuccess(res);
          }
        }).catch(() => {});
      }
      return response;
    });
  };

  // ─── XHR intercept (original path) ───
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._method = method;
    this._url = url;
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const url = this._url || "";
    const method = this._method || "";

    // intercept lessonRun → cache code
    if (method === "POST" && url.includes("/v1/lessonRun")) {
      try {
        const data = JSON.parse(body);
        const lessonUUID = data?.lessonRun?.lessonUUID;
        const files = data?.files;
        if (lessonUUID && files) {
          const mainFile = files.find(f => f.Name === "main.go") || files[0];
          if (mainFile) {
            codeCache[lessonUUID] = mainFile.Content;
          }
        }
      } catch {}
    }

    // intercept lesson submit → fire on success
    if (method === "POST" && /\/v1\/lessons\/[^/]+\/$/.test(url)) {
      this.addEventListener("load", function () {
        try {
          const res = JSON.parse(this.responseText);
          if (res.ResultSlug === "success") {
            handleSubmitSuccess(res);
          }
        } catch {}
      });
    }

    return origSend.call(this, body);
  };

  // ─── shared submit success handler (async — awaits metadata from boot.dev API) ───
  async function handleSubmitSuccess(res) {
    const lessonUUID = res.LessonUUID;
    const courseUUID = res.CourseUUID;
    const userUUID = res.UserUUID;

    if (isDeduped(lessonUUID)) return;

    const cachedCode = codeCache[lessonUUID];

    // Build POST body with metadata (ticket 04: metadata from client via same-origin fetch)
    const postBody = {
      userUUID,
      lessonUUID,
      courseUUID,
    };

    if (cachedCode && cachedCode !== "// no code captured") {
      // Code lesson: send the cached code
      postBody.code = cachedCode;
    } else {
      // Non-code lesson: send progress marker request (ticket 03)
      postBody.kind = "progress";
    }

    // Fetch metadata from boot.dev's authenticated API (ticket 04, option A)
    const meta = await getLessonMetadata(lessonUUID);
    if (!meta) {
      console.log(`[bootdev→gh] skipped: metadata fetch failed for ${lessonUUID}`);
      return;
    }
    postBody.courseTitle = meta.courseTitle;
    postBody.chapterTitle = meta.chapterTitle;
    postBody.lessonTitle = meta.lessonTitle;
    postBody.courseLanguage = meta.courseLanguage;

    origFetchRef(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postBody),
    })
      .then(r => r.json())
      .then(d => console.log("[bootdev→gh]", d.commit || d))
      .catch(e => console.error("[bootdev→gh] error", e));
  }

  // ─── fetch lesson metadata from boot.dev same-origin API (ticket 04, option A) ───
  async function getLessonMetadata(lessonUUID) {
    try {
      const url = `https://api.boot.dev/v1/static/lessons/${lessonUUID}`;
      const response = await origFetchRef(url);

      if (!response.ok) {
        console.warn(`[bootdev→gh] metadata fetch non-2xx: ${response.status} for ${lessonUUID}`);
        return null;
      }

      const data = await response.json();
      return {
        courseTitle: data.CourseTitle,
        chapterTitle: data.ChapterTitle,
        lessonTitle: data.Title,
        courseLanguage: data.CourseLanguage,
      };
    } catch (e) {
      console.warn(`[bootdev→gh] metadata fetch failed for ${lessonUUID}:`, e.message);
      return null;
    }
  }
})();