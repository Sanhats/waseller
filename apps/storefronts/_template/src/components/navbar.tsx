import Link from "next/link";
import { CartButton } from "./cart-button.client";

/** Navbar server-rendered con el nombre del tenant. El botón del carrito es client. */
export function Navbar({ storeName, logoUrl }: { storeName: string; logoUrl?: string }) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "#ffffff",
        borderBottom: "1px solid #e5e5e5",
      }}
    >
      <div
        className="container"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" style={{ height: 32, width: "auto" }} />
          ) : null}
          <strong style={{ fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {storeName}
          </strong>
        </Link>
        <nav style={{ display: "flex", alignItems: "center", gap: 24, fontSize: 13 }}>
          <Link href="/catalogo">Catálogo</Link>
          <CartButton />
        </nav>
      </div>
    </header>
  );
}
