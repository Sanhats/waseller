import type { ReactNode } from "react";

/**
 * El layout raíz fija `overflow-hidden` en `body`; este contenedor permite scroll
 * en la vitrina pública sin afectar el resto del dashboard.
 */
export default function TiendaLayout({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto overflow-x-hidden bg-canvas font-sans text-[var(--color-text)] antialiased">
      {children}
    </div>
  );
}
