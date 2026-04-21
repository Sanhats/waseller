"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installWaConsoleCryptoRedaction = installWaConsoleCryptoRedaction;
/**
 * Baileys/libsignal a veces vuelcan `SessionEntry`, buffers y claves a `console.log`/`info`.
 * En Railway eso ensucia logs y expone material criptográfico. Activar redacción por defecto en Railway
 * o con `WA_REDACT_CRYPTO_CONSOLE=1`. Desactivar: `WA_VERBOSE_LIBSIGNAL=1`.
 */
function installWaConsoleCryptoRedaction() {
    if (process.env.WA_VERBOSE_LIBSIGNAL === "1")
        return;
    const enabled = process.env.WA_REDACT_CRYPTO_CONSOLE === "1" || Boolean(process.env.RAILWAY_ENVIRONMENT?.trim());
    if (!enabled)
        return;
    const looksSensitive = (combined) => /SessionEntry|remoteIdentityKey|privKey:|pubKey:|ephemeralKeyPair|_chains|Closing session:|registrationId:/i.test(combined);
    const stringifyArg = (a) => {
        if (typeof a === "string")
            return a;
        if (a instanceof Buffer)
            return "<Buffer>";
        try {
            return JSON.stringify(a);
        }
        catch {
            return String(a);
        }
    };
    for (const level of ["log", "info", "debug"]) {
        const orig = console[level].bind(console);
        console[level] = (...args) => {
            const combined = args.map(stringifyArg).join(" ");
            if (looksSensitive(combined))
                return;
            orig(...args);
        };
    }
}
