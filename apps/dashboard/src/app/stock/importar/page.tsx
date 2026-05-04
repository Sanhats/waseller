"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

type RawRow = Record<string, unknown>;

type FieldKey = "name" | "price" | "talle" | "color" | "marca" | "stock" | "sku" | "category" | "imageUrl";

const FIELD_LABELS: Record<FieldKey, string> = {
  name: "Nombre del producto *",
  price: "Precio *",
  talle: "Talle",
  color: "Color",
  marca: "Marca",
  stock: "Stock",
  sku: "SKU (opcional)",
  category: "Categoría (slug)",
  imageUrl: "URL de imagen"
};

const ALIASES: Record<FieldKey, string[]> = {
  name: ["name", "nombre", "producto", "product"],
  price: ["price", "precio", "valor"],
  talle: ["talle", "talla", "size"],
  color: ["color"],
  marca: ["marca", "brand"],
  stock: ["stock", "cantidad", "qty"],
  sku: ["sku", "codigo", "código"],
  category: ["category", "categoria", "categoría", "rubro"],
  imageUrl: ["imageurl", "image_url", "imagen", "foto", "image"]
};

const REQUIRED_FIELDS: FieldKey[] = ["name", "price"];

const authContext = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? "";
  if (!token || !tenantId) return null;
  return { token, tenantId };
};

function autoMap(headers: string[]): Partial<Record<FieldKey, string>> {
  const map: Partial<Record<FieldKey, string>> = {};
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");
  for (const field of Object.keys(ALIASES) as FieldKey[]) {
    const aliases = ALIASES[field].map(norm);
    const hit = headers.find((h) => aliases.includes(norm(h)));
    if (hit) map[field] = hit;
  }
  return map;
}

export default function ImportarStockPage() {
  const [isMobile, setIsMobile] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [fieldMap, setFieldMap] = useState<Partial<Record<FieldKey, string>>>({});
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<null | {
    productsCreated: number;
    productsUpdated: number;
    variantsCreated: number;
    variantsUpdated: number;
    errors: Array<{ rowIndex: number; message: string }>;
  }>(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleFile = async (file: File) => {
    setParseError("");
    setResult(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        setParseError("El archivo no tiene hojas.");
        return;
      }
      const sheet = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "", raw: false });
      if (json.length === 0) {
        setParseError("El archivo está vacío.");
        return;
      }
      const firstHeaders = Object.keys(json[0]);
      setHeaders(firstHeaders);
      setRawRows(json);
      setFieldMap(autoMap(firstHeaders));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
      setHeaders([]);
      setRawRows([]);
      setFieldMap({});
    }
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const data = [
      {
        nombre: "Remera Oversize",
        precio: 18900,
        talle: "M",
        color: "Negro",
        marca: "Mi Marca",
        stock: 12,
        sku: "",
        categoria: "mujer-remeras",
        imageUrl: ""
      },
      {
        nombre: "Remera Oversize",
        precio: 18900,
        talle: "L",
        color: "Negro",
        marca: "Mi Marca",
        stock: 8,
        sku: "",
        categoria: "mujer-remeras",
        imageUrl: ""
      },
      {
        nombre: "Jean Mom",
        precio: 42900,
        talle: "38",
        color: "Azul medio",
        marca: "Mi Marca",
        stock: 6,
        sku: "",
        categoria: "mujer-pantalones",
        imageUrl: ""
      }
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "productos");
    XLSX.writeFile(wb, "plantilla-productos-waseller.xlsx");
  };

  const buildPayload = (): Array<Record<string, unknown>> => {
    return rawRows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const field of Object.keys(fieldMap) as FieldKey[]) {
        const sourceCol = fieldMap[field];
        if (!sourceCol) continue;
        out[field] = row[sourceCol];
      }
      return out;
    });
  };

  const canImport =
    rawRows.length > 0 && REQUIRED_FIELDS.every((f) => Boolean(fieldMap[f]));

  const submitImport = async () => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setImporting(true);
    setResult(null);
    try {
      const response = await fetch(`${getClientApiBase()}/products/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
          "x-tenant-id": auth.tenantId
        },
        body: JSON.stringify({ rows: buildPayload() })
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as NonNullable<typeof result>;
      setResult(data);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Error al importar");
    } finally {
      setImporting(false);
    }
  };

  const previewRows = rawRows.slice(0, 10);

  return (
    <main
      className={cn(
        "flex min-h-0 bg-canvas text-[var(--color-text)]",
        "h-[100dvh] max-h-[100dvh]",
        "flex-col-reverse lg:flex-row lg:items-stretch"
      )}
    >
      <AppSidebar active="stock" compact={isMobile} />
      <section className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6 lg:py-8">
        <header className="mb-6">
          <div className="flex flex-wrap items-center gap-3 text-label-ui text-muted-ui">
            <Link href="/stock" className="hover:text-[var(--color-text)]">
              ← Volver a Stock
            </Link>
          </div>
          <h1 className="mt-2 text-title">Importar productos</h1>
          <p className="mt-1 max-w-2xl text-body text-muted-ui">
            Subí un archivo Excel (.xlsx) o CSV con tus productos. Cada fila es una variante (talle/color); las filas
            con el mismo nombre se agrupan en un único producto.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-6">
            <section className="rounded-lg border border-border bg-surface p-4 shadow-sm md:p-5">
              <h2 className="text-section">1. Subir archivo</h2>
              <p className="mt-2 text-body text-muted-ui">
                Aceptamos <code>.xlsx</code> y <code>.csv</code>. Máximo 2000 filas por importación.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-canvas px-4 py-2.5 text-sm font-medium hover:bg-surface"
                  )}
                >
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFile(f);
                    }}
                  />
                  Elegir archivo
                </label>
                <Button type="button" variant="ghost" onClick={downloadTemplate}>
                  Descargar plantilla
                </Button>
                {fileName ? (
                  <span className="text-label-ui text-muted-ui">
                    Cargado: <span className="font-medium text-[var(--color-text)]">{fileName}</span> ·{" "}
                    {rawRows.length} filas
                  </span>
                ) : null}
              </div>
              {parseError ? (
                <p className="mt-3 rounded-md border border-error bg-error-bg px-3 py-2 text-body text-error" role="alert">
                  {parseError}
                </p>
              ) : null}
            </section>

            {headers.length > 0 ? (
              <section className="rounded-lg border border-border bg-surface p-4 shadow-sm md:p-5">
                <h2 className="text-section">2. Mapear columnas</h2>
                <p className="mt-2 text-body text-muted-ui">
                  Indicá qué columna del archivo corresponde a cada campo. Auto-detectamos por nombre. * = obligatorio.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {(Object.keys(FIELD_LABELS) as FieldKey[]).map((field) => (
                    <div key={field}>
                      <label className="text-label-ui font-semibold text-[var(--color-text)]">
                        {FIELD_LABELS[field]}
                      </label>
                      <select
                        value={fieldMap[field] ?? ""}
                        onChange={(e) =>
                          setFieldMap((prev) => ({ ...prev, [field]: e.target.value || undefined }))
                        }
                        className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-body shadow-sm"
                      >
                        <option value="">— No mapear —</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {previewRows.length > 0 ? (
              <section className="rounded-lg border border-border bg-surface p-4 shadow-sm md:p-5">
                <h2 className="text-section">3. Vista previa (primeras 10 filas)</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-label-ui">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-ui">
                        <th className="px-2 py-2">#</th>
                        {(Object.keys(FIELD_LABELS) as FieldKey[]).map((field) => (
                          <th key={field} className="px-2 py-2">
                            {field}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, idx) => (
                        <tr key={idx} className="border-b border-border/50">
                          <td className="px-2 py-2 text-muted-ui">{idx + 1}</td>
                          {(Object.keys(FIELD_LABELS) as FieldKey[]).map((field) => {
                            const col = fieldMap[field];
                            const v = col ? row[col] : "";
                            return (
                              <td key={field} className="px-2 py-2 text-[var(--color-text)]">
                                {v == null || v === "" ? "—" : String(v)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {result ? (
              <section
                className={cn(
                  "rounded-lg border p-4 shadow-sm md:p-5",
                  result.errors.length > 0
                    ? "border-warning bg-warning-bg"
                    : "border-primary/30 bg-[var(--badge-active-bg)]"
                )}
              >
                <h2 className="text-section">Resultado</h2>
                <ul className="mt-2 space-y-1 text-body">
                  <li>Productos creados: <strong>{result.productsCreated}</strong></li>
                  <li>Productos actualizados: <strong>{result.productsUpdated}</strong></li>
                  <li>Variantes creadas: <strong>{result.variantsCreated}</strong></li>
                  <li>Variantes actualizadas: <strong>{result.variantsUpdated}</strong></li>
                  <li>Errores: <strong>{result.errors.length}</strong></li>
                </ul>
                {result.errors.length > 0 ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-label-ui text-muted-ui">
                      Ver detalle de errores
                    </summary>
                    <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto text-label-ui">
                      {result.errors.map((e, i) => (
                        <li key={i} className="text-error">
                          Fila {e.rowIndex}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <div className="mt-4 flex gap-2">
                  <Link
                    href="/stock"
                    className={cn(
                      "inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-canvas"
                    )}
                  >
                    Ir a Stock
                  </Link>
                </div>
              </section>
            ) : null}
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-border bg-surface p-4 shadow-sm md:p-5">
              <h3 className="text-section">Importar</h3>
              <p className="mt-2 text-body text-muted-ui">
                Revisá la vista previa antes de confirmar. Los productos con el mismo nombre se agrupan; las variantes
                existentes (mismo SKU) se actualizan, no se duplican.
              </p>
              <Button
                type="button"
                variant="primary"
                className="mt-4 w-full"
                onClick={() => void submitImport()}
                disabled={!canImport || importing}
                loading={importing}
              >
                Importar {rawRows.length || 0} fila{rawRows.length === 1 ? "" : "s"}
              </Button>
              {!canImport && rawRows.length > 0 ? (
                <p className="mt-2 text-label-ui text-error">
                  Asigná las columnas obligatorias (nombre y precio) para continuar.
                </p>
              ) : null}
            </div>

            <div className="rounded-lg border border-border bg-surface p-4 text-label-ui text-muted-ui shadow-sm md:p-5">
              <p className="font-semibold text-[var(--color-text)]">Tips</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Una fila por variante (cada combinación de talle/color).</li>
                <li>Productos con mismo nombre se agrupan automáticamente.</li>
                <li>Si no ponés SKU, lo generamos: <code>IMP-nombre-color-talle</code>.</li>
                <li>Categoría debe ser el <em>slug</em> de una categoría existente (creala antes en Stock → Categorías).</li>
                <li>Re-importar el mismo archivo actualiza precios y stock sin duplicar.</li>
              </ul>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
