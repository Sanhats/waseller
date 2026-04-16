/** Solo dígitos (normalización para comparar teléfonos entre tablas y la URL). */
export declare function digitsOnlyPhone(value: string): string;
/** Variantes comunes AR: prefijo 54 vs número nacional. */
export declare function buildPhoneDigitVariants(digits: string): string[];
