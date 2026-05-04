export declare const TENANT_BUSINESS_PROFILE_VERSION: 2;
export type OutOfStockPolicy = "offer_alternative" | "waitlist" | "decline" | "backorder";
export type BusinessCategory = "general" | "indumentaria_calzado" | "electronica" | "hogar_deco" | "belleza_salud" | "repuestos_lubricentro";
/** Solo Mercado Pago (link) y efectivo; cobros confirmados vía webhook o acción manual en panel. */
export type PaymentMethod = "link_pago" | "efectivo_retiro";
export type ShippingMethod = "retiro_local" | "envio_moto" | "correo" | "pickup_point";
export type VariantAxis = "talle" | "color" | "marca" | "modelo" | "capacidad" | "material";
export type TenantBusinessProfile = {
    version: number;
    /** Nombre público del negocio (suele coincidir con el nombre del tenant en el registro). */
    businessName?: string;
    /**
     * Tono sugerido para respuestas (p. ej. `voseo_informal`, `formal_usted`). Opcional en `tenant_knowledge.profile`.
     * Lo consumen workers / waseller-crew para alinear el estilo.
     */
    tone?: string;
    /**
     * Texto libre de entregas: zonas, plazos, costos orientativos (sin datos sensibles). Opcional en `profile`.
     */
    deliveryInfo?: string;
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
    /**
     * Políticas comerciales adicionales que el copiloto LLM usa para recomendar
     * acciones al vendedor (descuentos permitidos, qué hacer sin stock, cuándo
     * hacer follow-up, cuándo escalar a humano). Todas opcionales.
     */
    commercialPolicies?: {
        /** Tope de descuento que el vendedor puede ofrecer sin escalar (0-100). */
        maxDiscountPercent?: number;
        /** Sobre qué porcentaje requiere aprobación del admin (0-100). */
        discountRequiresApprovalAbovePercent?: number;
        /** Comportamiento por defecto cuando un producto pedido no tiene stock. */
        outOfStockPolicy?: OutOfStockPolicy;
        /** Horas tras las cuales un lead "frío"/"consulta" sin actividad debe recibir follow-up. */
        coldLeadFollowUpHours?: number;
        /** Horas tras las cuales un lead "interesado"/"caliente" sin actividad debe recibir follow-up. */
        warmLeadFollowUpHours?: number;
        /** Frases/keywords que disparan escalación inmediata a humano. */
        escalationKeywords?: string[];
        /** Texto libre con horario de atención (para sugerir seguimiento dentro de horario). */
        businessHours?: string;
        /** Notas libres sobre políticas comerciales (envío gratis sobre X, cuotas, combos, etc.). */
        notes?: string;
    };
};
export declare const DEFAULT_TENANT_BUSINESS_PROFILE: TenantBusinessProfile;
export declare const BUSINESS_PRESETS: Record<BusinessCategory, Partial<TenantBusinessProfile>>;
/** Mínimo para enviar `tenantBrief` útil a waseller-crew (tono + logística/entregas en texto). */
export declare function isTenantCrewCommercialContextComplete(profile: TenantBusinessProfile): boolean;
export declare const normalizeTenantBusinessProfile: (raw: unknown) => TenantBusinessProfile;
