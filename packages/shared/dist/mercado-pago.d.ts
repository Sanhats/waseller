export declare const encryptIntegrationSecret: (plain: string) => string;
export declare const decryptIntegrationSecret: (payload: string) => string;
export declare const signMercadoPagoState: (payload: Record<string, unknown>) => string;
export declare const verifyMercadoPagoState: <T extends Record<string, unknown>>(state: string) => T | null;
export declare const verifyMercadoPagoWebhookSignature: (input: {
    secret: string;
    signatureHeader?: string | null;
    requestId?: string | null;
    resourceId?: string | null;
}) => boolean;
