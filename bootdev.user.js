// ==UserScript==
// @name         bootdev → github commits
// @namespace    http://tampermonkey.net/
// @version      2.4
// @match        https://www.boot.dev/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  console.log("[bootdev→gh] script v2.4 loaded");

  // ← local Go daemon URL
  const WORKER_URL = "http://localhost:8080/";

  // cache code from lessonRun keyed by lessonUUID
  const codeCache = {};

  // save original fetch BEFORE wrapping
  const origFetch = window.fetch.bind(window);

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
  window.fetch = function (...args) {
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
              console.log(`[bootdev→gh] cached code for ${lessonUUID}`);
            }
          }
        } catch {}
      }
    }

    return origFetch.apply(window, args).then((response) => {
      if (method === "POST" && /\/v1\/lessons\/[^/]+\/$/.test(url)) {
        const clone = response.clone();
        clone.json().then((res) => {
          if (res.ResultSlug === "success") {
            console.log("[bootdev→gh] fetch submit success");
            handleSubmitSuccess(res);
          }
        }).catch(() => {});
      }
      return response;
    });
  };

  // ─── XHR intercept ───
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
            console.log(`[bootdev→gh] XHR cached code for ${lessonUUID}`);
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
            console.log("[bootdev→gh] XHR submit success");
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

    console.log(`[bootdev→gh] handling success for ${lessonUUID}`);

    const cachedCode = codeCache[lessonUUID];

    const postBody = { userUUID, lessonUUID, courseUUID };

    if (cachedCode && cachedCode !== "// no code captured") {
      postBody.code = cachedCode;
    } else {
      postBody.kind = "progress";
    }

    const meta = await getLessonMetadata(lessonUUID);
    if (!meta) {
      console.log(`[bootdev→gh] skipped: metadata fetch failed for ${lessonUUID}`);
      return;
    }
    postBody.courseTitle = meta.courseTitle;
    postBody.chapterTitle = meta.chapterTitle;
    postBody.lessonTitle = meta.lessonTitle;
    postBody.courseLanguage = meta.courseLanguage;

    console.log(`[bootdev→gh] posting: ${meta.courseTitle} / ${meta.lessonTitle}`);

    origFetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postBody),
    })
      .then(r => r.json())
      .then(d => console.log("[bootdev→gh]", d.commit || d))
      .catch(e => console.error("[bootdev→gh] daemon error", e));
  }

  // ─── fetch lesson metadata ───
  async function getLessonMetadata(lessonUUID) {
    try {
      const response = await origFetch(`https://api.boot.dev/v1/static/lessons/${lessonUUID}`);
      if (!response.ok) {
        console.warn(`[bootdev→gh] metadata ${response.status} for ${lessonUUID}`);
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
      console.warn(`[bootdev→gh] metadata failed:`, e.message);
      return null;
    }
  }
})();