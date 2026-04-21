export declare const TENANT_BUSINESS_PROFILE_VERSION: 1;
export type BusinessCategory =
  | "general"
  | "indumentaria_calzado"
  | "electronica"
  | "hogar_deco"
  | "belleza_salud"
  | "repuestos_lubricentro";
/** Solo Mercado Pago (link) y efectivo; cobros confirmados vía webhook o acción manual en panel. */
export type PaymentMethod = "link_pago" | "efectivo_retiro";
export type ShippingMethod = "retiro_local" | "envio_moto" | "correo" | "pickup_point";
export type VariantAxis = "talle" | "color" | "modelo" | "capacidad" | "material";
export type TenantBusinessProfile = {
    version: number;
    /** Nombre público del negocio (suele coincidir con el nombre del tenant en el registro). */
    businessName?: string;
    businessCategory: BusinessCategory;
    businessLabels: string[];
    payment: {
        methods: PaymentMethod[];
        transferAlias?: string;
        acceptsInstallments: boolean;
    };
    shipping: {
        methods: ShippingMethod[];
        zones: string[];
        sameDay: boolean;
    };
    productVariantAxes: VariantAxis[];
    policy: {
        reservationTtlMinutes: number;
        supportHours?: string;
        notes?: string;
        allowExchange: boolean;
        allowReturns: boolean;
    };
};
export declare const DEFAULT_TENANT_BUSINESS_PROFILE: TenantBusinessProfile;
export declare const BUSINESS_PRESETS: Record<BusinessCategory, Partial<TenantBusinessProfile>>;
export declare const normalizeTenantBusinessProfile: (raw: unknown) => TenantBusinessProfile;
//# sourceMappingURL=tenant-business-profile.d.ts.map