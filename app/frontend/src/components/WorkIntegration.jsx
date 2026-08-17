import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Code2 } from "lucide-react";
import WorkNativeWorkspace from "./WorkNativeWorkspace";

function setOtherNavActive(nav, workHost, workOpen) {
  if (!nav) return;
  for (const item of nav.querySelectorAll(".nav-item")) {
    if (workHost?.contains(item)) continue;
    if (workOpen) {
      if (item.classList.contains("active")) item.dataset.workWasActive = "true";
      item.classList.remove("active");
      item.setAttribute("aria-selected", "false");
    } else if (item.dataset.workWasActive === "true") {
      item.classList.add("active");
      item.setAttribute("aria-selected", "true");
      delete item.dataset.workWasActive;
    }
  }
}

export default function WorkIntegration() {
  const [navMount, setNavMount] = useState(null);
  const [mainMount, setMainMount] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const attach = () => {
      const nav = document.querySelector(".nav-list");
      const main = document.querySelector(".main-content");
      if (!nav || !main) return false;

      let navHost = document.getElementById("local-work-nav-host");
      if (!navHost) {
        navHost = document.createElement("div");
        navHost.id = "local-work-nav-host";
        const modelsItem = [...nav.children].find((child) => child.textContent?.includes("Model Manager"));
        if (modelsItem) nav.insertBefore(navHost, modelsItem);
        else nav.appendChild(navHost);
      }

      let mainHost = document.getElementById("local-work-main-host");
      if (!mainHost) {
        mainHost = document.createElement("div");
        mainHost.id = "local-work-main-host";
        main.appendChild(mainHost);
      }

      if (getComputedStyle(main).position === "static") main.style.position = "relative";
      Object.assign(mainHost.style, {
        position: "absolute",
        inset: "68px 0 0 0",
        zIndex: "60",
        overflow: "hidden",
        background: "var(--md-sys-color-surface, #101116)",
        display: "none",
      });

      if (!cancelled) {
        setNavMount(navHost);
        setMainMount(mainHost);
      }
      return true;
    };

    if (!attach()) timer = setInterval(() => { if (attach()) { clearInterval(timer); timer = null; } }, 100);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!mainMount) return;
    const nav = document.querySelector(".nav-list");
    const workHost = document.getElementById("local-work-nav-host");

    mainMount.style.display = open ? "block" : "none";
    mainMount.dataset.workOpen = open ? "true" : "false";
    document.body.dataset.workOpen = open ? "true" : "false";
    setOtherNavActive(nav, workHost, open);
    window.dispatchEvent(new CustomEvent("uls-work-open-changed", { detail: { open } }));

    return () => {
      mainMount.style.display = "none";
      mainMount.dataset.workOpen = "false";
      document.body.dataset.workOpen = "false";
      setOtherNavActive(nav, workHost, false);
      window.dispatchEvent(new CustomEvent("uls-work-open-changed", { detail: { open: false } }));
    };
  }, [open, mainMount]);

  useEffect(() => {
    const nav = document.querySelector(".nav-list");
    if (!nav) return undefined;
    const handler = (event) => {
      if (!event.target.closest("#local-work-nav-host")) setOpen(false);
    };
    nav.addEventListener("click", handler);
    return () => nav.removeEventListener("click", handler);
  }, []);

  const navItem = navMount ? createPortal(
    <div
      className={`nav-item ${open ? "active" : ""}`}
      aria-selected={open ? "true" : "false"}
      onClick={() => setOpen(true)}
      title="Local coding workspace"
    >
      <Code2 size={20} />
      <span>Work</span>
    </div>,
    navMount,
  ) : null;

  const workspace = mainMount ? createPortal(<WorkNativeWorkspace active={open} />, mainMount) : null;
  return <>{navItem}{workspace}</>;
}
