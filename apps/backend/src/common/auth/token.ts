import type { AuthTokenPayload } from "../../../../../packages/shared/src";
import {
  authTokenEnvFromProcess,
  createAuthToken as createAuthTokenCore,
  verifyAuthToken as verifyAuthTokenCore
} from "@waseller/api-core";

/** Compatibilidad Nest: usa `process.env` para el secreto y TTL. */
export const createAuthToken = (
  payload: Omit<AuthTokenPayload, "exp">
): { token: string; exp: number } => createAuthTokenCore(authTokenEnvFromProcess(process.env), payload);

export const verifyAuthToken = (token: string): AuthTokenPayload | null =>
  verifyAuthTokenCore(authTokenEnvFromProcess(process.env), token);
