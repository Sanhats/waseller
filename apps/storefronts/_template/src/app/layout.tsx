import type { Metadata } from "next";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { Navbar } from "@/components/navbar";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const store = await api.getStore();
    const name = store.config.brand.storeName || store.name;
    return {
      title: { default: name, template: `%s · ${name}` },
      description: store.config.brand.description || store.config.brand.tagline || `Catálogo de ${name}`,
    };
  } catch {
    return { title: "Tienda" };
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  /** Cargamos el store config en el layout para tener el nombre/logo en la navbar de toda la app. */
  const store = await api.getStore().catch(() => null);
  return (
    <html lang="es">
      <body>
        <Navbar storeName={store?.config.brand.storeName ?? store?.name ?? "Tienda"} logoUrl={store?.config.brand.logoUrl} />
        <main>{children}</main>
        <footer style={{ marginTop: 64, padding: "32px 16px", borderTop: "1px solid #e5e5e5", fontSize: 12, color: "#888" }}>
          <div className="container">© {new Date().getFullYear()} {store?.config.brand.storeName ?? store?.name ?? "Tienda"}</div>
        </footer>
      </body>
    </html>
  );
}
