"use client";

import { useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, Sparkles } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  RadioGroup,
  RadioItem,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip
} from "@/components/ui";
import { cn } from "@/lib/cn";

function Section({
  title,
  description,
  children,
  className
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <div className="space-y-1">
        <h2 className="text-section">{title}</h2>
        {description ? <p className="text-body text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function DemoCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface p-6 shadow-sm ring-1 ring-black/[0.02]",
        className
      )}
    >
      {children}
    </div>
  );
}

export default function DesignSystemPage() {
  const [on, setOn] = useState(true);
  const [plan, setPlan] = useState("pro");
  const [agree, setAgree] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  return (
    <main className="min-h-screen overflow-y-auto bg-canvas px-4 py-10 pb-16 text-[var(--color-text)] sm:px-8">
      <div className="mx-auto max-w-4xl space-y-10">
        <header className="space-y-2 border-b border-border pb-8">
          <p className="text-label-ui text-muted">Waseller · UI kit</p>
          <h1 className="text-title">Sistema de diseño</h1>
          <p className="max-w-2xl text-body text-muted">
            Marca (azul), growth, estados y neutros vía <code className="rounded bg-disabled-bg px-1">globals.css</code>{" "}
            y Tailwind. Prioridad visual: ~80% neutros, ~15% azul estructura, ~5% growth/acentos.
          </p>
        </header>

        <Section title="Paleta (tokens)" description="Referencia rápida; valores en :root.">
          <DemoCard>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border border-border p-3">
                <div className="h-10 rounded bg-primary" />
                <p className="mt-2 text-label-ui font-medium">Primary</p>
                <p className="text-xs text-muted-ui">Marca / estructura</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="h-10 rounded bg-growth" />
                <p className="mt-2 text-label-ui font-medium">Growth</p>
                <p className="text-xs text-muted-ui">CTA alternativo / leads</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="h-10 rounded bg-info" />
                <p className="mt-2 text-label-ui font-medium">Info (marca)</p>
                <p className="text-xs text-muted-ui">Misma base que primary; sin verde integraciones</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="h-10 rounded bg-success" />
                <p className="mt-2 text-label-ui font-medium">Success</p>
                <p className="text-xs text-muted-ui">Pagos / venta (#8FA645)</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="h-10 rounded bg-chat-incoming" />
                <p className="mt-2 text-label-ui font-medium">Chat recibido</p>
                <p className="text-xs text-muted-ui">#F6F8E8</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="h-10 rounded bg-chat-outgoing" />
                <p className="mt-2 text-label-ui font-medium">Chat enviado</p>
                <p className="text-xs text-muted-ui">#E8F1F5</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="h-10 rounded bg-warning" />
                <p className="mt-2 text-label-ui font-medium">Warning</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="h-10 rounded bg-error" />
                <p className="mt-2 text-label-ui font-medium">Error</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="h-10 rounded border border-border bg-canvas" />
                <p className="mt-2 text-label-ui font-medium">Canvas</p>
                <p className="text-xs text-muted-ui">Fondo app</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="h-10 rounded border border-border bg-surface shadow-sm" />
                <p className="mt-2 text-label-ui font-medium">Surface</p>
                <p className="text-xs text-muted-ui">Cards</p>
              </div>
            </div>
          </DemoCard>
        </Section>

        <Section
          title="Tipografía"
          description="Clases de utilidad definidas en globals.css (title, section, body, label)."
        >
          <DemoCard className="space-y-4">
            <p className="text-title">Título de página</p>
            <p className="text-section">Sección o encabezado de bloque</p>
            <p className="text-body">Cuerpo de texto para párrafos y descripciones.</p>
            <p className="text-label-ui">Etiqueta de formulario o metadato</p>
            <p className="text-muted-ui">Texto secundario / muted</p>
          </DemoCard>
        </Section>

        <Section title="Botones" description="Variantes, estados disabled y loading.">
          <DemoCard>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="growth">Growth</Button>
              <Button variant="success">Success</Button>
              <Button variant="info">Info (outline marca)</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
              <Button
                variant="primary"
                loading={demoLoading}
                onClick={() => {
                  setDemoLoading(true);
                  window.setTimeout(() => setDemoLoading(false), 1600);
                }}
              >
                Probar loading
              </Button>
            </div>
          </DemoCard>
        </Section>

        <Section
          title="Campos de texto"
          description="Default, focus (anillo marca), error con mensaje y disabled."
        >
          <DemoCard>
            <div className="grid max-w-md gap-4">
              <Input label="Nombre" placeholder="Ej. María González" />
              <Input label="Email con error" placeholder="correo@..." error="Este campo es obligatorio." />
              <Input label="Campo deshabilitado" placeholder="No editable" disabled defaultValue="Solo lectura" />
            </div>
          </DemoCard>
        </Section>

        <Section title="Switch, checkbox y radio" description="Controles con estados claros y foco visible.">
          <DemoCard className="space-y-6">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2.5">
                <Switch checked={on} onCheckedChange={setOn} aria-label="Notificaciones" />
                <span className="text-sm text-[var(--color-text)]">Notificaciones</span>
              </div>
              <Checkbox
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                label="Acepto los términos"
              />
            </div>
            <RadioGroup value={plan} onValueChange={setPlan} className="gap-3">
              <RadioItem value="free" label="Plan Free" />
              <RadioItem value="pro" label="Plan Pro" />
              <RadioItem value="disabled" label="Opción deshabilitada" disabled />
            </RadioGroup>
          </DemoCard>
        </Section>

        <Section title="Tabs (pills)" description="Activo con fondo primary; transición suave.">
          <Tabs defaultValue="uno">
            <TabsList>
              <TabsTrigger value="uno">General</TabsTrigger>
              <TabsTrigger value="dos">Equipo</TabsTrigger>
              <TabsTrigger value="tres">Facturación</TabsTrigger>
            </TabsList>
            <TabsContent value="uno">Contenido de la pestaña General.</TabsContent>
            <TabsContent value="dos">Contenido de la pestaña Equipo.</TabsContent>
            <TabsContent value="tres">Contenido de la pestaña Facturación.</TabsContent>
          </Tabs>
        </Section>

        <Section
          title="Badges / chips"
          description="Incluye growth (nuevo lead), sale (venta cerrada), info en tono marca; con ícono opcional."
        >
          <DemoCard>
            <div className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="active" icon={CheckCircle2}>
                Activo
              </Badge>
              <Badge variant="growth" icon={Sparkles}>
                Nuevo lead
              </Badge>
              <Badge variant="sale" icon={CheckCircle2}>
                Venta cerrada
              </Badge>
              <Badge variant="success" icon={CheckCircle2}>
                Éxito / pago
              </Badge>
              <Badge variant="info" icon={Info}>
                Informativo
              </Badge>
              <Badge variant="warning" icon={AlertCircle}>
                Atención
              </Badge>
              <Badge variant="error" icon={AlertCircle}>
                Error
              </Badge>
              <Badge variant="default" icon={Sparkles}>
                Con ícono
              </Badge>
            </div>
          </DemoCard>
        </Section>

        <Section title="Tooltip" description="Fondo oscuro, texto claro, sombra suave y fade en hover o foco.">
          <DemoCard>
            <p className="mb-3 text-sm text-muted">
              Pasá el cursor o enfocá con Tab el botón de información.
            </p>
            <Tooltip content="Texto de ayuda breve y legible." side="top">
              <button
                type="button"
                className="inline-flex size-9 items-center justify-center rounded-md border border-border bg-surface text-muted shadow-sm transition-colors hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
                aria-label="Más información"
              >
                <Info className="size-4" />
              </button>
            </Tooltip>
          </DemoCard>
        </Section>

        <footer className="border-t border-border pt-8 text-xs text-muted">
          Dark mode: preparado con <code className="rounded bg-disabled-bg px-1 py-0.5">[data-theme=&quot;dark&quot;]</code>{" "}
          en <code className="rounded bg-disabled-bg px-1 py-0.5">globals.css</code> (sin activar en la app aún).
        </footer>
      </div>
    </main>
  );
}
