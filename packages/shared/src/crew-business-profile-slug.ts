/** Patrón alineado a waseller-crew para `businessProfileSlug` en el body HTTP. */
export const CREW_BUSINESS_PROFILE_SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/** Mapea valores guardados en Waseller (`tenant_knowledge.business_category`) al slug esperado por waseller-crew. */
const WASeller_CATEGORY_TO_CREW_SLUG: Record<string, string> = {
  hogar_deco: "muebles_deco"
};

/**
 * Devuelve el slug a enviar en `businessProfileSlug` o `null` si no debe enviarse (general / inválido).
 */
export function toCrewBusinessProfileSlug(storedBusinessCategory: string): string | null {
  const raw = String(storedBusinessCategory ?? "").trim();
  if (!raw || raw === "general") return null;
  const mapped = WASeller_CATEGORY_TO_CREW_SLUG[raw] ?? raw;
  if (!CREW_BUSINESS_PROFILE_SLUG_RE.test(mapped)) return null;
  return mapped;
}
