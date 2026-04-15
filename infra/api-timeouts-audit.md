# Auditoría: timeouts y trabajo pesado (API → Vercel)

## Módulo `ops` (`ops.service.ts`)

- Lee y escribe configuración de tenant, playbooks, templates, eval dataset.
- Integra **LLM** vía flags globales (`LLM_SHADOW_MODE`, `LLM_KILL_SWITCH`, etc.) y flujos que pueden ser lentos o dependientes de red externa.
- **Recomendación:** en Vercel, rutas `GET/PUT /api/ops/*` que invoquen modelo deben:
  - usar **`export const maxDuration = 60`** (o el máximo del plan) solo donde haga falta, o
  - delegar en **job en Redis/worker** y devolver `202` + `jobId` para consulta posterior.

## Onboarding / WhatsApp

- `GET .../qr.png` y estado de sesión: I/O a servicio WhatsApp; latencia variable.
- **Recomendación:** timeout explícito en fetch interno; no bloquear el handler más de unos segundos; cachear QR si aplica.

## Mercado Pago

- OAuth callback y webhook: deben completar en segundos; evitar trabajo pesado inline — encolar si el procesamiento es largo.

## `messages/incoming`

- Diseñado para **encolar**; adecuado para serverless si la conexión Redis es estable y el payload acotado.

## Variables de entorno relacionadas

| Variable | Uso |
|----------|-----|
| `LLM_KILL_SWITCH` | Cortar llamadas costosas en incidentes |
| `LLM_SHADOW_MODE` | Reducir efectos secundarios mientras se mide latencia |

Revisar límites oficiales de Vercel para tu plan antes de mover `ops` completo a Route Handlers.
