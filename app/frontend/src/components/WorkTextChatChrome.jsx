import React, { useEffect, useState } from "react";
import { Bot, Code2, FolderTree, PanelRight, Sparkles } from "lucide-react";

// Visual coordinator for the Work workspace. It deliberately does not own model,
// project, or agent state; those remain in the existing Work components. Its job
// is to make Work read like the Text Chat workspace and to keep Work-only chrome
// scoped to the Work host.
export default function WorkTextChatChrome() {
  const [host, setHost] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let timer = null;
    const attach = () => {
      const next = document.getElementById("local-work-main-host");
      if (!next) return false;
      setHost(next);
      setOpen(next.dataset.workOpen === "true");
      return true;
    };
    if (!attach()) timer = setInterval(() => { if (attach()) { clearInterval(timer); timer = null; } }, 150);

    const onOpen = (event) => setOpen(Boolean(event.detail?.open));
    window.addEventListener("uls-work-open-changed", onOpen);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("uls-work-open-changed", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!host) return undefined;

    const sync = () => {
      if (!open) return;
      host.classList.add("work-text-chat-layout");

      // The legacy Whole Project Agent is retained for its proven tool loop,
      // but is visually promoted into the Work conversation surface.
      const agentTitle = [...host.querySelectorAll("strong")].find((node) => node.textContent?.trim() === "Whole Project Agent");
      const agentCard = agentTitle?.closest("div[style*='border-radius']") || agentTitle?.parentElement?.parentElement?.parentElement;
      if (agentCard) agentCard.classList.add("work-agent-chat-card");

      // Make Work-only floating tool buttons feel like the Text Chat toolbar.
      for (const button of host.querySelectorAll("button")) {
        const text = button.textContent?.trim() || "";
        if (text.includes("ChatGPT Handoff") || text.includes("Work Model Manager") || text.includes("Qwen")) {
          button.classList.add("work-chat-toolbar-button");
        }
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(host, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      host.classList.remove("work-text-chat-layout");
    };
  }, [host, open]);

  if (!host || !open) return null;

  return (
    <style>{`
      #local-work-main-host.work-text-chat-layout {
        --work-left: 280px;
        --work-right: 250px;
      }

      #local-work-main-host.work-text-chat-layout .work-agent-chat-card {
        border-radius: 16px !important;
        border: 1px solid var(--md-sys-color-outline-variant, #343640) !important;
        background: var(--md-sys-color-surface-container-low, #15161c) !important;
        box-shadow: none !important;
      }

      #local-work-main-host.work-text-chat-layout .work-chat-toolbar-button {
        border-radius: 10px !important;
      }

      #local-work-main-host.work-text-chat-layout textarea::placeholder,
      #local-work-main-host.work-text-chat-layout input::placeholder {
        color: var(--md-sys-color-outline, #8a8b95);
      }
    `}</style>
  );
}
