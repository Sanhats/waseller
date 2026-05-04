"use client";

/**
 * Página pública imprimible para usar como 1-pager en visitas a tiendas.
 * - No requiere auth.
 * - Optimizada para imprimir o exportar a PDF (Cmd/Ctrl+P).
 * - Editá los textos marcados con {{ ... }} antes de imprimir.
 */

export default function PitchPage() {
  return (
    <main className="pitch-page">
      <style>{`
        :root {
          --pp-bg: #ffffff;
          --pp-text: #0F2A38;
          --pp-muted: #5A6B76;
          --pp-primary: #19485F;
          --pp-accent: #E8B4A0;
          --pp-border: #E2E8EC;
        }
        * { box-sizing: border-box; }
        body { margin: 0; }
        .pitch-page {
          background: var(--pp-bg);
          color: var(--pp-text);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          max-width: 794px; /* A4 width @96dpi */
          margin: 0 auto;
          padding: 32px 40px;
          line-height: 1.45;
        }
        .pp-print-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: #F5F7F9;
          border: 1px solid var(--pp-border);
          border-radius: 8px;
          margin-bottom: 24px;
          font-size: 12px;
          color: var(--pp-muted);
        }
        .pp-print-bar button {
          background: var(--pp-primary);
          color: #fff;
          border: 0;
          padding: 8px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
        }
        .pp-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24px;
          padding-bottom: 18px;
          border-bottom: 2px solid var(--pp-primary);
        }
        .pp-brand {
          font-size: 28px;
          font-weight: 900;
          letter-spacing: -0.5px;
          color: var(--pp-primary);
        }
        .pp-tagline {
          font-size: 13px;
          color: var(--pp-muted);
          margin-top: 4px;
        }
        .pp-headline {
          font-size: 36px;
          font-weight: 900;
          line-height: 1.05;
          letter-spacing: -1px;
          margin: 0 0 12px;
        }
        .pp-headline em {
          color: var(--pp-primary);
          font-style: normal;
        }
        .pp-sub {
          font-size: 16px;
          color: var(--pp-muted);
          max-width: 620px;
          margin-bottom: 28px;
        }
        .pp-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          margin-bottom: 28px;
        }
        .pp-card {
          border: 1px solid var(--pp-border);
          border-radius: 10px;
          padding: 14px 16px;
          background: #FAFBFC;
        }
        .pp-card-title {
          font-size: 13px;
          font-weight: 800;
          color: var(--pp-primary);
          margin-bottom: 4px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .pp-card-text {
          font-size: 13px;
          color: var(--pp-text);
        }
        .pp-section-title {
          font-size: 18px;
          font-weight: 800;
          margin: 0 0 10px;
          color: var(--pp-primary);
        }
        .pp-list {
          margin: 0 0 24px;
          padding-left: 20px;
          font-size: 13px;
        }
        .pp-list li { margin-bottom: 6px; }
        .pp-demo {
          background: var(--pp-primary);
          color: #fff;
          border-radius: 10px;
          padding: 18px 22px;
          margin-bottom: 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }
        .pp-demo-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 1px;
          opacity: 0.7;
        }
        .pp-demo-url {
          font-size: 18px;
          font-weight: 700;
          font-family: "SF Mono", Menlo, Consolas, monospace;
        }
        .pp-pricing {
          border: 2px solid var(--pp-primary);
          border-radius: 12px;
          padding: 18px 22px;
          background: #fff;
          margin-bottom: 24px;
        }
        .pp-price {
          font-size: 28px;
          font-weight: 900;
          color: var(--pp-primary);
        }
        .pp-price-note {
          font-size: 12px;
          color: var(--pp-muted);
        }
        .pp-footer {
          margin-top: 28px;
          padding-top: 16px;
          border-top: 1px solid var(--pp-border);
          font-size: 12px;
          color: var(--pp-muted);
          display: flex;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 8px;
        }
        @media print {
          .pp-print-bar { display: none; }
          .pitch-page { padding: 0 16px; max-width: 100%; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>

      <div className="pp-print-bar">
        <span>Material comercial — visitas a tiendas. Editá los textos marcados con &#123;&#123; ... &#125;&#125; antes de imprimir.</span>
        <button type="button" onClick={() => typeof window !== "undefined" && window.print()}>
          Imprimir / Guardar PDF
        </button>
      </div>

      <header className="pp-header">
        <div>
          <div className="pp-brand">Waseller</div>
          <div className="pp-tagline">CRM + Tienda online para WhatsApp</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12, color: "var(--pp-muted)" }}>
          {`{{tu nombre}}`}
          <br />
          {`{{tu teléfono}}`} · {`{{tu email}}`}
        </div>
      </header>

      <h1 className="pp-headline">
        Cada mensaje sin responder es <em>una venta perdida.</em>
      </h1>
      <p className="pp-sub">
        Waseller centraliza WhatsApp, catálogo y cobros en un solo panel. Tu equipo responde más rápido, no se pierden
        clientes y vendés online sin contratar a nadie técnico.
      </p>

      <h2 className="pp-section-title">Por qué tu tienda lo necesita</h2>
      <div className="pp-grid">
        <div className="pp-card">
          <div className="pp-card-title">📱 WhatsApp ordenado</div>
          <div className="pp-card-text">
            Todos los chats de clientes en un solo panel. Filtros por estado del lead (frío, interesado, listo para
            comprar). Nadie queda sin respuesta.
          </div>
        </div>
        <div className="pp-card">
          <div className="pp-card-title">🛍️ Tu tienda online lista</div>
          <div className="pp-card-text">
            Catálogo público con tu marca y dominio (o subdominio). Compartís el link y tu cliente compra solo, sin que
            tengas que hacer nada.
          </div>
        </div>
        <div className="pp-card">
          <div className="pp-card-title">💳 Mercado Pago integrado</div>
          <div className="pp-card-text">
            Generás link de pago en un click desde el chat. Cuando el cliente paga, el stock se descuenta solo.
          </div>
        </div>
        <div className="pp-card">
          <div className="pp-card-title">📦 Stock con talles y colores</div>
          <div className="pp-card-text">
            Pensado para ropa: variantes por talle / color / marca. Ves qué hay disponible y reservás stock al instante.
          </div>
        </div>
      </div>

      <h2 className="pp-section-title">Qué incluye el servicio</h2>
      <ul className="pp-list">
        <li>Setup completo: cargamos tu catálogo, conectamos tu WhatsApp y tu Mercado Pago.</li>
        <li>Tu tienda online con tu marca (logo, colores, dominio personalizable).</li>
        <li>Capacitación 1-a-1 para vos y tu equipo.</li>
        <li>Soporte por WhatsApp para dudas y ajustes.</li>
        <li>Mantenimiento mensual: backups, mejoras y nuevas funciones sin costo extra.</li>
      </ul>

      <div className="pp-demo">
        <div>
          <div className="pp-demo-label">Probá la demo en tu celular</div>
          <div className="pp-demo-url">{`{{tudominio}}/tienda/olivia-boutique`}</div>
        </div>
        <div style={{ fontSize: 13, opacity: 0.85, maxWidth: 220 }}>
          Tienda de ejemplo con productos, talles y carrito. Así se va a ver la tuya.
        </div>
      </div>

      <h2 className="pp-section-title">Inversión</h2>
      <div className="pp-pricing">
        <div className="pp-price">{`{{$XX.XXX/mes}}`}</div>
        <div className="pp-price-note">
          Incluye setup + tienda online + integraciones + soporte. Sin permanencia. Cancelás cuando quieras.
        </div>
      </div>

      <footer className="pp-footer">
        <div>
          ¿Lo probamos? Te dejo el panel de demo armado en 10 minutos. Empezás a vender hoy mismo.
        </div>
        <div>{`{{tudominio}}.com`}</div>
      </footer>
    </main>
  );
}
