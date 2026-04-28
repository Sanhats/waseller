import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function json(status: number, message: string) {
  return NextResponse.json({ message }, { status });
}

export async function POST(req: NextRequest) {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const bucket = env("SUPABASE_STORAGE_BUCKET") || "product-images";

  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      502,
      "Falta configurar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para subir imágenes."
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return json(400, `No se pudo leer form-data. Detalle: ${e instanceof Error ? e.message : String(e)}`);
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return json(400, "No se recibieron archivos (campo 'files').");
  if (files.length > 12) return json(400, "Máximo 12 imágenes por subida.");

  // Optional subfolder: "products" (default) | "store-config" | "banners" | etc.
  const folder = String(form.get("folder") ?? "products").replace(/[^a-z0-9_-]/gi, "") || "products";

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const tenantId = String(req.headers.get("x-tenant-id") ?? "").trim();
  const prefix = tenantId ? `tenants/${tenantId}` : "tenants/unknown";
  const now = Date.now();

  const urls: string[] = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const extRaw = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const ext = ["jpg", "jpeg", "png", "webp", "gif"].includes(extRaw) ? extRaw : "jpg";
    const path = `${prefix}/${folder}/${now}-${i}-${crypto.randomUUID()}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const contentType =
      file.type ||
      (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg");

    const { error } = await supabase.storage.from(bucket).upload(path, arrayBuffer, {
      contentType,
      upsert: false,
      cacheControl: "3600",
    });
    if (error) return json(502, `Error al subir imagen a Supabase Storage: ${error.message}`);

    const pub = supabase.storage.from(bucket).getPublicUrl(path);
    const url = String(pub?.data?.publicUrl ?? "").trim();
    if (!url) return json(502, "No se pudo obtener la URL pública del archivo subido.");
    urls.push(url);
  }

  return NextResponse.json({ urls });
}
