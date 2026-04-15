export const TENANT_BUSINESS_PROFILE_VERSION = 1 as const;

export type BusinessCategory =
  | "general"
  | "indumentaria_calzado"
  | "electronica"
  | "hogar_deco"
  | "belleza_salud";

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

const toArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const asNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isBusinessCategory = (value: string): value is BusinessCategory =>
  value === "general" ||
  value === "indumentaria_calzado" ||
  value === "electronica" ||
  value === "hogar_deco" ||
  value === "belleza_salud";

const asBusinessCategory = (value: unknown): BusinessCategory => {
  const candidate = String(value ?? "").trim().toLowerCase();
  return isBusinessCategory(candidate) ? candidate : "general";
};

const PAYMENT_METHOD_SET = new Set<PaymentMethod>(["link_pago", "efectivo_retiro"]);
const SHIPPING_METHOD_SET = new Set<ShippingMethod>([
  "retiro_local",
  "envio_moto",
  "correo",
  "pickup_point"
]);
const VARIANT_AXIS_SET = new Set<VariantAxis>([
  "talle",
  "color",
  "modelo",
  "capacidad",
  "material"
]);

const asPaymentMethods = (value: unknown): PaymentMethod[] => {
  const raw = toArray(value).map((item) => item.toLowerCase());
  const mapped = raw
    .map((item) => {
      if (item === "link_pago" || item === "efectivo_retiro") return item as PaymentMethod;
      if (item === "efectivo" || item === "cash" || item === "contado") return "efectivo_retiro";
      return null;
    })
    .filter((item): item is PaymentMethod => item !== null);
  return Array.from(new Set(mapped));
};

const asShippingMethods = (value: unknown): ShippingMethod[] =>
  toArray(value)
    .map((item) => item.toLowerCase())
    .filter((item): item is ShippingMethod => SHIPPING_METHOD_SET.has(item as ShippingMethod));

const asVariantAxes = (value: unknown): VariantAxis[] =>
  toArray(value)
    .map((item) => item.toLowerCase())
    .filter((item): item is VariantAxis => VARIANT_AXIS_SET.has(item as VariantAxis));

export const DEFAULT_TENANT_BUSINESS_PROFILE: TenantBusinessProfile = {
  version: TENANT_BUSINESS_PROFILE_VERSION,
  businessCategory: "general",
  businessLabels: [],
  payment: {
    methods: ["link_pago", "efectivo_retiro"],
    acceptsInstallments: false
  },
  /** Envíos se coordinan fuera del perfil (p. ej. WhatsApp); el bot no ofrece métodos desde acá. */
  shipping: {
    methods: [],
    zones: [],
    sameDay: false
  },
  productVariantAxes: ["talle", "color"],
  policy: {
    reservationTtlMinutes: 30,
    allowExchange: true,
    allowReturns: false
  }
};

export const BUSINESS_PRESETS: Record<BusinessCategory, Partial<TenantBusinessProfile>> = {
  general: {},
  indumentaria_calzado: {
    businessLabels: ["venta_minorista", "catalogo_whatsapp"],
    payment: { methods: ["link_pago", "efectivo_retiro"], acceptsInstallments: false },
    productVariantAxes: ["talle", "color", "modelo"],
    policy: { reservationTtlMinutes: 30, allowExchange: true, allowReturns: true }
  },
  electronica: {
    businessLabels: ["garantia_fabricante"],
    payment: { methods: ["link_pago", "efectivo_retiro"], acceptsInstallments: false },
    productVariantAxes: ["modelo", "capacidad", "color"],
    policy: { reservationTtlMinutes: 45, allowExchange: true, allowReturns: true }
  },
  hogar_deco: {
    businessLabels: ["catalogo_temporada"],
    payment: { methods: ["link_pago", "efectivo_retiro"], acceptsInstallments: false },
    productVariantAxes: ["material", "color", "modelo"],
    policy: { reservationTtlMinutes: 60, allowExchange: true, allowReturns: false }
  },
  belleza_salud: {
    businessLabels: ["productos_sellados"],
    payment: { methods: ["link_pago", "efectivo_retiro"], acceptsInstallments: false },
    productVariantAxes: ["color", "modelo"],
    policy: { reservationTtlMinutes: 20, allowExchange: false, allowReturns: false }
  }
};

export const normalizeTenantBusinessProfile = (raw: unknown): TenantBusinessProfile => {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const paymentSource =
    input.payment && typeof input.payment === "object"
      ? input.payment
      : input.paymentMethods && typeof input.paymentMethods === "object"
        ? input.paymentMethods
        : {};
  const payment = paymentSource as Record<string, unknown>;
  const shipping =
    input.shipping && typeof input.shipping === "object"
      ? (input.shipping as Record<string, unknown>)
      : input.shippingMethods && typeof input.shippingMethods === "object"
        ? (input.shippingMethods as Record<string, unknown>)
        : {};
  const policy =
    input.policy && typeof input.policy === "object"
      ? (input.policy as Record<string, unknown>)
      : input.businessPolicy && typeof input.businessPolicy === "object"
        ? (input.businessPolicy as Record<string, unknown>)
        : {};
  const category = asBusinessCategory(input.businessCategory);
  const preset = BUSINESS_PRESETS[category] ?? {};
  const presetPayment = (preset.payment ?? {}) as Partial<TenantBusinessProfile["payment"]>;
  const presetPolicy = (preset.policy ?? {}) as Partial<TenantBusinessProfile["policy"]>;
  const methods = asPaymentMethods(payment.methods ?? payment.available);
  const shippingMethods = asShippingMethods(shipping.methods ?? shipping.available);
  const variantAxes = asVariantAxes(
    input.productVariantAxes ??
      (input.productAttributes && typeof input.productAttributes === "object"
        ? (input.productAttributes as Record<string, unknown>).dimensions
        : undefined)
  );

  return {
    version: TENANT_BUSINESS_PROFILE_VERSION,
    businessCategory: category,
    businessLabels: toArray(input.businessLabels),
    payment: {
      methods:
        methods.length > 0
          ? methods
          : (presetPayment.methods ?? DEFAULT_TENANT_BUSINESS_PROFILE.payment.methods),
      transferAlias: String(payment.transferAlias ?? "").trim() || undefined,
      acceptsInstallments: asBoolean(
        payment.acceptsInstallments,
        presetPayment.acceptsInstallments ?? DEFAULT_TENANT_BUSINESS_PROFILE.payment.acceptsInstallments
      )
    },
    shipping: {
      methods: shippingMethods.length > 0 ? shippingMethods : DEFAULT_TENANT_BUSINESS_PROFILE.shipping.methods,
      zones: toArray(shipping.zones),
      sameDay: asBoolean(shipping.sameDay, DEFAULT_TENANT_BUSINESS_PROFILE.shipping.sameDay)
    },
    productVariantAxes:
      variantAxes.length > 0
        ? variantAxes
        : ((preset.productVariantAxes as VariantAxis[] | undefined) ?? DEFAULT_TENANT_BUSINESS_PROFILE.productVariantAxes),
    policy: {
      reservationTtlMinutes: Math.max(
        5,
        asNumber(
          policy.reservationTtlMinutes,
          presetPolicy.reservationTtlMinutes ?? DEFAULT_TENANT_BUSINESS_PROFILE.policy.reservationTtlMinutes
        )
      ),
      supportHours: String(policy.supportHours ?? "").trim() || undefined,
      notes: String(policy.notes ?? "").trim() || undefined,
      allowExchange: asBoolean(
        policy.allowExchange,
        presetPolicy.allowExchange ?? DEFAULT_TENANT_BUSINESS_PROFILE.policy.allowExchange
      ),
      allowReturns: asBoolean(
        policy.allowReturns,
        presetPolicy.allowReturns ?? DEFAULT_TENANT_BUSINESS_PROFILE.policy.allowReturns
      )
    },
    businessName: String(input.businessName ?? "").trim() || undefined
  };
};
