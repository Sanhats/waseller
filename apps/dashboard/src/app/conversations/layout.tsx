"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ConversationListPanel } from "./conversation-list-panel";
import { cn } from "@/lib/cn";

export default function ConversationsLayout({ children }: { children: React.ReactNode }) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <main
      className={cn(
        "flex min-h-screen bg-canvas text-[var(--color-text)]",
        isMobile ? "flex-col" : "flex-row"
      )}
    >
      <AppSidebar active="conversations" compact={isMobile} />
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row",
          "lg:h-[100dvh] lg:max-h-screen"
        )}
      >
        <ConversationListPanel />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas">{children}</div>
      </div>
    </main>
  );
}
