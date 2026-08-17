import { useEffect } from "react";

function isWorkItem(node) {
  return Boolean(node?.closest?.("#local-work-nav-host")) || node?.textContent?.trim() === "Work";
}

export default function WorkVisibilityGuard() {
  useEffect(() => {
    let timer = null;
    const sync = () => {
      const host = document.getElementById("local-work-main-host");
      if (!host) return;
      const workItem = host.ownerDocument.querySelector("#local-work-nav-host .nav-item");
      const open = Boolean(workItem?.classList.contains("active"));
      host.style.display = open ? "block" : "none";
      host.dataset.workOpen = open ? "true" : "false";
      window.dispatchEvent(new CustomEvent("uls-work-open-changed", { detail: { open } }));
    };

    const nav = document.querySelector(".nav-list");
    const onClick = (event) => {
      const item = event.target.closest(".nav-item");
      if (!item) return;
      setTimeout(sync, isWorkItem(item) ? 0 : 25);
    };
    nav?.addEventListener("click", onClick);

    const observer = new MutationObserver(sync);
    if (nav) observer.observe(nav, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });
    timer = setInterval(sync, 500);
    sync();

    return () => {
      nav?.removeEventListener("click", onClick);
      observer.disconnect();
      if (timer) clearInterval(timer);
      const host = document.getElementById("local-work-main-host");
      if (host) host.style.display = "";
    };
  }, []);
  return null;
}
