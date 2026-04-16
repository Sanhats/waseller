/** Solo dígitos (normalización para comparar teléfonos entre tablas y la URL). */
export function digitsOnlyPhone(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\D/g, "");
}

/** Variantes comunes AR: prefijo 54 vs número nacional. */
export function buildPhoneDigitVariants(digits: string): string[] {
  const d = String(digits ?? "").trim();
  if (!d) return [];
  const variants = new Set<string>([d]);
  if (d.startsWith("54") && d.length >= 11) {
    variants.add(d.slice(2));
  }
  if (!d.startsWith("54") && d.length >= 8) {
    variants.add(`54${d}`);
  }
  return [...variants];
}
