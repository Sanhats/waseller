export type UserRole = "admin" | "vendedor" | "viewer";
export interface AuthTokenPayload {
    sub: string;
    tenantId: string;
    role: UserRole;
    email: string;
    exp: number;
}
