import type { AuthTokenPayload } from "./types";
export type AuthTokenEnv = {
    AUTH_TOKEN_SECRET: string;
    AUTH_TOKEN_TTL_SECONDS: number;
};
export declare const authTokenEnvFromProcess: (env: NodeJS.ProcessEnv) => AuthTokenEnv;
export declare const createAuthToken: (tokenEnv: AuthTokenEnv, payload: Omit<AuthTokenPayload, "exp">) => {
    token: string;
    exp: number;
};
export declare const verifyAuthToken: (tokenEnv: AuthTokenEnv, token: string) => AuthTokenPayload | null;
//# sourceMappingURL=token.d.ts.map