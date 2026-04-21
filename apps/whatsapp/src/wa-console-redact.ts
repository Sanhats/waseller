/**
 * Baileys/libsignal a veces vuelcan `SessionEntry`, buffers y claves a `console.log`/`info`.
 * En Railway eso ensucia logs y expone material criptográfico. Activar redacción por defecto en Railway
 * o con `WA_REDACT_CRYPTO_CONSOLE=1`. Desactivar: `WA_VERBOSE_LIBSIGNAL=1`.
 */
export function installWaConsoleCryptoRedaction(): void {
  if (process.env.WA_VERBOSE_LIBSIGNAL === "1") return;
  const enabled =
    process.env.WA_REDACT_CRYPTO_CONSOLE === "1" || Boolean(process.env.RAILWAY_ENVIRONMENT?.trim());
  if (!enabled) return;

  const looksSensitive = (combined: string): boolean =>
    /SessionEntry|remoteIdentityKey|privKey:|pubKey:|ephemeralKeyPair|_chains|Closing session:|registrationId:/i.test(
      combined
    );

  const stringifyArg = (a: unknown): string => {
    if (typeof a === "string") return a;
    if (a instanceof Buffer) return "<Buffer>";
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  };

  for (const level of ["log", "info", "debug"] as const) {
    const orig = console[level].bind(console) as (...args: unknown[]) => void;
    console[level] = (...args: unknown[]) => {
      const combined = args.map(stringifyArg).join(" ");
      if (looksSensitive(combined)) return;
      orig(...args);
    };
  }
}
