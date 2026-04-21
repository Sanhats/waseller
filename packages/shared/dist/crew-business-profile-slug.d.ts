/** Patrón alineado a waseller-crew para `businessProfileSlug` en el body HTTP. */
export declare const CREW_BUSINESS_PROFILE_SLUG_RE: RegExp;
/**
 * Devuelve el slug a enviar en `businessProfileSlug` o `null` si no debe enviarse (general / inválido).
 */
export declare function toCrewBusinessProfileSlug(storedBusinessCategory: string): string | null;
