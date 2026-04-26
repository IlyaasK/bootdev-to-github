// ==UserScript==
// @name         bootdev → github commits
// @namespace    http://tampermonkey.net/
// @version      2.5
// @match        https://www.boot.dev/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  console.log("[bootdev→gh] script v2.5 loaded");

  const WORKER_URL = "http://localhost:8080/";

  // Save original fetch BEFORE any page code can touch it
  const origFetch = window.fetch.bind(window);

  // Dedupe guard
  const lastFired = new Map();
  const DEDUPE_WINDOW_MS = 10_000;

  function isDeduped(lessonUUID) {
    if (!lessonUUID) return false;
    const now = Date.now();
    const last = lastFired.get(lessonUUID);
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true;
    lastFired.set(lessonUUID, now);
    return false;
  }

  // ─── fetch() intercept ───
  // Note: code is in the SUBMIT request body (files[]), not in lessonRun
  window.fetch = function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    const method = (args[1]?.method || "GET").toUpperCase();

    if (method === "POST" && /\/v1\/lessons\/[^/]+\/$/.test(url)) {
      // Extract code directly from the submit request body
      let filesFromReq = null;
      try {
        const data = JSON.parse(args[1]?.body || "{}");
        if (Array.isArray(data.files) && data.files.length > 0) {
          filesFromReq = data.files;
        }
      } catch {}

      return origFetch.apply(window, args).then((response) => {
        const clone = response.clone();
        clone.json().then((res) => {
          if (res.ResultSlug === "success") {
            console.log("[bootdev→gh] fetch: success for", res.LessonUUID);
            handleSubmitSuccess(res, filesFromReq);
          }
        }).catch(() => {});
        return response;
      });
    }

    return origFetch.apply(window, args);
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

    if (method === "POST" && /\/v1\/lessons\/[^/]+\/$/.test(url)) {
      let filesFromReq = null;
      try {
        const data = JSON.parse(body);
        if (Array.isArray(data.files) && data.files.length > 0) {
          filesFromReq = data.files;
        }
      } catch {}

      this.addEventListener("load", function () {
        try {
          const res = JSON.parse(this.responseText);
          if (res.ResultSlug === "success") {
            console.log("[bootdev→gh] XHR: success for", res.LessonUUID);
            handleSubmitSuccess(res, filesFromReq);
          }
        } catch {}
      });
    }

    return origSend.call(this, body);
  };

  // ─── submit handler ───
  async function handleSubmitSuccess(res, filesFromReq) {
    const { LessonUUID: lessonUUID, CourseUUID: courseUUID, UserUUID: userUUID } = res;
    if (isDeduped(lessonUUID)) return;

    const postBody = { userUUID, lessonUUID, courseUUID };

    if (filesFromReq && filesFromReq.length > 0) {
      const mainFile =
        filesFromReq.find(f => f.Name === "main.go") ||
        filesFromReq.find(f => f.Name === "main.js") ||
        filesFromReq.find(f => f.Name === "main.py") ||
        filesFromReq[0];
      postBody.code = mainFile.Content;
    } else {
      postBody.kind = "progress";
    }

    const meta = await getLessonMetadata(lessonUUID);
    if (!meta) {
      console.log(`[bootdev→gh] skipped: metadata fetch failed for ${lessonUUID}`);
      return;
    }
    Object.assign(postBody, {
      courseTitle: meta.courseTitle,
      chapterTitle: meta.chapterTitle,
      lessonTitle: meta.lessonTitle,
      courseLanguage: meta.courseLanguage,
    });

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

  // ─── metadata fetch ───
  async function getLessonMetadata(lessonUUID) {
    try {
      const r = await origFetch(`https://api.boot.dev/v1/static/lessons/${lessonUUID}`);
      if (!r.ok) { console.warn(`[bootdev→gh] metadata ${r.status}`); return null; }
      const d = await r.json();
      return {
        courseTitle: d.CourseTitle,
        chapterTitle: d.ChapterTitle,
        lessonTitle: d.Title,
        courseLanguage: d.CourseLanguage,
      };
    } catch (e) {
      console.warn("[bootdev→gh] metadata failed:", e.message);
      return null;
    }
  }
})();