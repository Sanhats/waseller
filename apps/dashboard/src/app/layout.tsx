import React from "react";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap"
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="h-screen overflow-hidden bg-canvas font-sans text-[var(--color-text)] antialiased">{children}</body>
    </html>
  );
}
