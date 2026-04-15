import type { PrismaClient } from "@prisma/client";
import { type AuthTokenEnv } from "./token";
export type AuthPasswordEnv = {
    AUTH_PASSWORD_PEPPER: string;
    AUTH_FALLBACK_EMAIL: string;
    AUTH_FALLBACK_PASSWORD: string;
};
export type AuthRuntimeEnv = AuthTokenEnv & AuthPasswordEnv;
export declare const authRuntimeEnvFromProcess: (env: NodeJS.ProcessEnv) => AuthRuntimeEnv;
export type AuthSessionBody = {
    tenantId: string;
    token: string;
    expiresAt: string;
    role: string;
    email: string;
};
export type AuthError = {
    status: 400 | 401 | 409;
    message: string;
};
export type AuthResult<T> = {
    ok: true;
    data: T;
} | {
    ok: false;
    error: AuthError;
};
export declare function loginUser(prisma: PrismaClient, runtime: AuthRuntimeEnv, input: {
    email: string;
    password: string; /** body.tenantId ?? header x-tenant-id */
    tenantId?: string;
}): Promise<AuthResult<AuthSessionBody>>;
export declare function registerTenantUser(prisma: PrismaClient, runtime: AuthRuntimeEnv, input: {
    tenantName: string;
    whatsappNumber: string;
    email: string;
    password: string;
}): Promise<AuthResult<AuthSessionBody>>;
//# sourceMappingURL=auth-operations.d.ts.map