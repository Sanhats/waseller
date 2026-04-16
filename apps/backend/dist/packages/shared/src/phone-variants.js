"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.digitsOnlyPhone = digitsOnlyPhone;
exports.buildPhoneDigitVariants = buildPhoneDigitVariants;
/** Solo dígitos (normalización para comparar teléfonos entre tablas y la URL). */
function digitsOnlyPhone(value) {
    return String(value ?? "")
        .trim()
        .replace(/\D/g, "");
}
/** Variantes comunes AR: prefijo 54 vs número nacional. */
function buildPhoneDigitVariants(digits) {
    const d = String(digits ?? "").trim();
    if (!d)
        return [];
    const variants = new Set([d]);
    if (d.startsWith("54") && d.length >= 11) {
        variants.add(d.slice(2));
    }
    if (!d.startsWith("54") && d.length >= 8) {
        variants.add(`54${d}`);
    }
    return [...variants];
}
