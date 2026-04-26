// ==UserScript==
// @name         bootdev → github commits
// @namespace    http://tampermonkey.net/
// @version      2.2
// @match        https://www.boot.dev/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      localhost
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  console.log("[bootdev→gh] script v2.2 loaded");

  // With @grant directives, 'window' is Tampermonkey's sandbox — NOT the page's window.
  // We must use unsafeWindow to patch the page's actual XHR and fetch.
  // Fall back to window if unsafeWindow is not available.
  const pageWindow = (typeof unsafeWindow !== "undefined") ? unsafeWindow : window;
  console.log("[bootdev→gh] pageWindow source:", (typeof unsafeWindow !== "undefined") ? "unsafeWindow" : "window (fallback)");

  // ← local Go daemon URL
  const WORKER_URL = "http://localhost:8080/";

  // cache code from lessonRun keyed by lessonUUID
  const codeCache = {};

  // save original page fetch BEFORE wrapping
  const origFetch = pageWindow.fetch.bind(pageWindow);

  // dedupe guard: prevent double-commits if both XHR and fetch fire
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

  // ─── fetch() intercept ───
  pageWindow.fetch = function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    const method = (args[1]?.method || "GET").toUpperCase();

    // intercept lessonRun → cache code
    if (method === "POST" && url.includes("/v1/lessonRun")) {
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

    return origFetch.apply(pageWindow, args).then((response) => {
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

  // ─── XHR intercept ───
  const origOpen = pageWindow.XMLHttpRequest.prototype.open;
  const origSend = pageWindow.XMLHttpRequest.prototype.send;

  pageWindow.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._method = method;
    this._url = url;
    return origOpen.call(this, method, url, ...rest);
  };

  pageWindow.XMLHttpRequest.prototype.send = function (body) {
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

  // ─── shared submit success handler ───
  async function handleSubmitSuccess(res) {
    const lessonUUID = res.LessonUUID;
    const courseUUID = res.CourseUUID;
    const userUUID = res.UserUUID;

    if (isDeduped(lessonUUID)) return;

    console.log(`[bootdev→gh] success intercepted for ${lessonUUID}`);

    const cachedCode = codeCache[lessonUUID];

    const postBody = {
      userUUID,
      lessonUUID,
      courseUUID,
    };

    if (cachedCode && cachedCode !== "// no code captured") {
      postBody.code = cachedCode;
    } else {
      postBody.kind = "progress";
    }

    // Fetch metadata via same-origin authenticated fetch
    const meta = await getLessonMetadata(lessonUUID);
    if (!meta) {
      console.log(`[bootdev→gh] skipped: metadata fetch failed for ${lessonUUID}`);
      return;
    }
    postBody.courseTitle = meta.courseTitle;
    postBody.chapterTitle = meta.chapterTitle;
    postBody.lessonTitle = meta.lessonTitle;
    postBody.courseLanguage = meta.courseLanguage;

    console.log(`[bootdev→gh] posting to daemon: ${meta.courseTitle} / ${meta.lessonTitle}`);

    // GM_xmlhttpRequest bypasses browser Local Network Access blocking
    GM_xmlhttpRequest({
      method: "POST",
      url: WORKER_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(postBody),
      onload: (r) => {
        try {
          const d = JSON.parse(r.responseText);
          console.log("[bootdev→gh]", d.commit || d);
        } catch {
          console.error("[bootdev→gh] bad response", r.responseText);
        }
      },
      onerror: (e) => console.error("[bootdev→gh] request failed", e),
    });
  }

  // ─── fetch lesson metadata from boot.dev API ───
  async function getLessonMetadata(lessonUUID) {
    try {
      const url = `https://api.boot.dev/v1/static/lessons/${lessonUUID}`;
      const response = await origFetch(url);

      if (!response.ok) {
        console.warn(`[bootdev→gh] metadata fetch non-2xx: ${response.status}`);
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
      console.warn(`[bootdev→gh] metadata fetch failed:`, e.message);
      return null;
    }
  }
})();