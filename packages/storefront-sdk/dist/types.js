"use strict";
/**
 * Tipos del shape que devuelve la API pública del dashboard.
 * Espejados de los handlers en `apps/dashboard/src/lib/api-gateway.ts`.
 *
 * IMPORTANTE: si cambia el shape del backend, actualizar acá. No usamos `import` desde
 * el dashboard a propósito — el storefront es independiente y debería poder consumir un
 * dashboard versionado distinto. Si rompemos contrato, bumpear major.
 */
Object.defineProperty(exports, "__esModule", { value: true });
