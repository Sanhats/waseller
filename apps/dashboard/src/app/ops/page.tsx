"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { BusinessOnboarding } from "@/components/business-onboarding";
import { cn } from "@/lib/cn";

export default function OpsPage() {
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
        "flex min-h-0 bg-canvas text-[var(--color-text)]",
        "h-[100dvh] max-h-[100dvh] flex-col",
        "lg:flex-row"
      )}
    >
      <AppSidebar active="ops" compact={isMobile} />
      <section
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain",
          "px-4 py-5 md:px-6 md:py-6 lg:py-8",
          "pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]"
        )}
      >
        <BusinessOnboarding />
      </section>
    </main>
  );
}
