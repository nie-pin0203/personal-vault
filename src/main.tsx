import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Check on foreground return without locking, signing out or refreshing the page.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.ready.then((registration) => {
    const check = () => {
      if (!document.hidden) void registration.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", check);
    check();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (
          worker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          const note = document.createElement("div");
          note.className = "banner";
          note.setAttribute("role", "status");
          note.textContent =
            "密屿新版本已下载。请保存编辑、确认同步后关闭所有密屿窗口，再重新打开完成更新。";
          document.body.prepend(note);
        }
      });
    });
  });
}
