export default function ConversationsIndexPage() {
  return (
    <div className="flex min-h-[min(60vh,calc(100dvh-12rem))] flex-1 flex-col items-center justify-center px-4 py-10 lg:min-h-0">
      <div className="max-w-md rounded-lg border border-border bg-surface p-8 text-center shadow-sm ring-1 ring-black/[0.02]">
        <p className="text-section">Seleccioná una conversación</p>
        <p className="mt-2 text-body text-muted-ui">
          Elegí un contacto en la lista para ver el historial, el panel de pago y responder manualmente por WhatsApp
          (clientes interesados; sin respuestas automáticas).
        </p>
      </div>
    </div>
  );
}
