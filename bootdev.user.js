// ==UserScript==
// @name         bootdev → github commits
// @namespace    http://tampermonkey.net/
// @version      1.0
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
          // concatenate all files, prioritize main.go
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
            const lessonUUID = res.LessonUUID;
            const courseUUID = res.CourseUUID;
            const userUUID = res.UserUUID;
            const code = codeCache[lessonUUID] || "// no code captured";

            fetch(WORKER_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userUUID, lessonUUID, courseUUID, code }),
            })
              .then(r => r.json())
              .then(d => console.log("[bootdev→gh]", d.commit || d))
              .catch(e => console.error("[bootdev→gh] error", e));
          }
        } catch {}
      });
    }

    return origSend.call(this, body);
  };
})();
