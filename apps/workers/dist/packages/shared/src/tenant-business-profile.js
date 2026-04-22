"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTenantBusinessProfile = exports.BUSINESS_PRESETS = exports.DEFAULT_TENANT_BUSINESS_PROFILE = exports.TENANT_BUSINESS_PROFILE_VERSION = void 0;
exports.TENANT_BUSINESS_PROFILE_VERSION = 1;
const toArray = (value) => Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
const asBoolean = (value, fallback = false) => typeof value === "boolean" ? value : fallback;
const asNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const isBusinessCategory = (value) => value === "general" ||
    value === "indumentaria_calzado" ||
    value === "electronica" ||
    value === "hogar_deco" ||
    value === "belleza_salud" ||
    value === "repuestos_lubricentro";
const asBusinessCategory = (value) => {
    const candidate = String(value ?? "").trim().toLowerCase();
    return isBusinessCategory(candidate) ? candidate : "general";
};
const PAYMENT_METHOD_SET = new Set(["link_pago", "efectivo_retiro"]);
const SHIPPING_METHOD_SET = new Set([
    "retiro_local",
    "envio_moto",
    "correo",
    "pickup_point"
]);
const VARIANT_AXIS_SET = new Set([
    "talle",
    "color",
    "modelo",
    "capacidad",
    "material"
]);
const asPaymentMethods = (value) => {
    const raw = toArray(value).map((item) => item.toLowerCase());
    const mapped = raw
        .map((item) => {
        if (item === "link_pago" || item === "efectivo_retiro")
            return item;
        if (item === "efectivo" || item === "cash" || item === "contado")
            return "efectivo_retiro";
        return null;
    })
        .filter((item) => item !== null);
    return Array.from(new Set(mapped));
};
const asShippingMethods = (value) => toArray(value)
    .map((item) => item.toLowerCase())
    .filter((item) => SHIPPING_METHOD_SET.has(item));
const asVariantAxes = (value) => toArray(value)
    .map((item) => item.toLowerCase())
    .filter((item) => VARIANT_AXIS_SET.has(item));
exports.DEFAULT_TENANT_BUSINESS_PROFILE = {
    version: exports.TENANT_BUSINESS_PROFILE_VERSION,
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
exports.BUSINESS_PRESETS = {
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
    },
    repuestos_lubricentro: {
        businessLabels: ["compatibilidad_vehiculo", "stock_bajo_rotacion"],
        payment: { methods: ["link_pago", "efectivo_retiro"], acceptsInstallments: false },
        productVariantAxes: ["modelo", "material"],
        policy: { reservationTtlMinutes: 30, allowExchange: true, allowReturns: false }
    }
};
const normalizeTenantBusinessProfile = (raw) => {
    const input = raw && typeof raw === "object" ? raw : {};
    const paymentSource = input.payment && typeof input.payment === "object"
        ? input.payment
        : input.paymentMethods && typeof input.paymentMethods === "object"
            ? input.paymentMethods
            : {};
    const payment = paymentSource;
    const shipping = input.shipping && typeof input.shipping === "object"
        ? input.shipping
        : input.shippingMethods && typeof input.shippingMethods === "object"
            ? input.shippingMethods
            : {};
    const policy = input.policy && typeof input.policy === "object"
        ? input.policy
        : input.businessPolicy && typeof input.businessPolicy === "object"
            ? input.businessPolicy
            : {};
    const category = asBusinessCategory(input.businessCategory);
    const preset = exports.BUSINESS_PRESETS[category] ?? {};
    const presetPayment = (preset.payment ?? {});
    const presetPolicy = (preset.policy ?? {});
    const methods = asPaymentMethods(payment.methods ?? payment.available);
    const shippingMethods = asShippingMethods(shipping.methods ?? shipping.available);
    const variantAxes = asVariantAxes(input.productVariantAxes ??
        (input.productAttributes && typeof input.productAttributes === "object"
            ? input.productAttributes.dimensions
            : undefined));
    return {
        version: exports.TENANT_BUSINESS_PROFILE_VERSION,
        businessCategory: category,
        businessLabels: toArray(input.businessLabels),
        payment: {
            methods: methods.length > 0
                ? methods
                : (presetPayment.methods ?? exports.DEFAULT_TENANT_BUSINESS_PROFILE.payment.methods),
            transferAlias: String(payment.transferAlias ?? "").trim() || undefined,
            acceptsInstallments: asBoolean(payment.acceptsInstallments, presetPayment.acceptsInstallments ?? exports.DEFAULT_TENANT_BUSINESS_PROFILE.payment.acceptsInstallments)
        },
        shipping: {
            methods: shippingMethods.length > 0 ? shippingMethods : exports.DEFAULT_TENANT_BUSINESS_PROFILE.shipping.methods,
            zones: toArray(shipping.zones),
            sameDay: asBoolean(shipping.sameDay, exports.DEFAULT_TENANT_BUSINESS_PROFILE.shipping.sameDay)
        },
        productVariantAxes: variantAxes.length > 0
            ? variantAxes
            : (preset.productVariantAxes ?? exports.DEFAULT_TENANT_BUSINESS_PROFILE.productVariantAxes),
        policy: {
            reservationTtlMinutes: Math.max(5, asNumber(policy.reservationTtlMinutes, presetPolicy.reservationTtlMinutes ?? exports.DEFAULT_TENANT_BUSINESS_PROFILE.policy.reservationTtlMinutes)),
            supportHours: String(policy.supportHours ?? "").trim() || undefined,
            notes: String(policy.notes ?? "").trim() || undefined,
            allowExchange: asBoolean(policy.allowExchange, presetPolicy.allowExchange ?? exports.DEFAULT_TENANT_BUSINESS_PROFILE.policy.allowExchange),
            allowReturns: asBoolean(policy.allowReturns, presetPolicy.allowReturns ?? exports.DEFAULT_TENANT_BUSINESS_PROFILE.policy.allowReturns)
        },
        businessName: String(input.businessName ?? "").trim() || undefined,
        tone: String(input.tone ?? input.communicationTone ?? "").trim() || undefined,
        deliveryInfo: (() => {
            const raw = String(input.deliveryInfo ?? input.deliverySummary ?? input.shippingNotes ?? "").trim();
            if (!raw)
                return undefined;
            return raw.length > 2000 ? `${raw.slice(0, 2000)}…` : raw;
        })()
    };
};
exports.normalizeTenantBusinessProfile = normalizeTenantBusinessProfile;
