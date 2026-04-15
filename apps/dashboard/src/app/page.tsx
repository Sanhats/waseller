"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "../components/app-sidebar";
import { HomeDashboard } from "@/components/home-dashboard";
import { cn } from "@/lib/cn";

const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

const authContext = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token || !tenantId) return null;
  return { token, tenantId };
};

export default function HomePage() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!authContext()) {
      window.location.href = "/login";
    }
  }, []);

  return (
    <main
      className={cn(
        "flex min-h-0 bg-canvas text-[var(--color-text)]",
        "h-[100dvh] max-h-[100dvh] flex-col",
        "lg:flex-row",
      )}
    >
      <AppSidebar active="home" compact={isMobile} />
      <section
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-canvas",
          "px-3 py-5 sm:px-4 md:py-6 lg:px-5 lg:py-8 xl:px-6",
          "pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]",
        )}
      >
        <HomeDashboard />
      </section>
    </main>
  );
}
