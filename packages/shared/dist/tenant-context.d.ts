export interface TenantContext {
    tenantId: string;
    whatsappNumber?: string;
}
export interface TenantScopedJob<TPayload> {
    tenantId: string;
    payload: TPayload;
    createdAt: string;
}
export declare const TENANT_HEADER = "x-tenant-id";
