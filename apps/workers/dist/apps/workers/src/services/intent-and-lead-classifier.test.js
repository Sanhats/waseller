"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const intent_detection_service_1 = require("./intent-detection.service");
const lead_classifier_service_1 = require("./lead-classifier.service");
(0, vitest_1.describe)("IntentDetectionService (es-AR comercial)", () => {
    const service = new intent_detection_service_1.IntentDetectionService();
    (0, vitest_1.it)("detecta consulta de stock con saludo mixto", () => {
        const message = "Hola buenas noches, tenes adidas forum low bad bunny?";
        (0, vitest_1.expect)(service.detect(message)).toBe("buscar_producto");
        (0, vitest_1.expect)(service.isBusinessRelated(message, false)).toBe(true);
    });
    (0, vitest_1.it)("detecta consulta con acento local", () => {
        const message = "Buenas, tenés jordan 1 low en 42?";
        (0, vitest_1.expect)(service.detect(message)).toBe("buscar_producto");
    });
    (0, vitest_1.it)("detecta cierre tipico argentino", () => {
        const message = "Dale dale, las paso a buscar mañana";
        (0, vitest_1.expect)(service.detect(message)).toBe("preguntar_retiro");
        (0, vitest_1.expect)(service.isBusinessRelated(message, false)).toBe(true);
    });
    (0, vitest_1.it)("detecta intencion de pago directo", () => {
        const message = "Pasame alias que te transfiero";
        (0, vitest_1.expect)(service.detect(message)).toBe("elegir_medio_pago");
    });
    (0, vitest_1.it)("detecta consulta de precio", () => {
        const message = "Cuanto vale la Adidas Forum?";
        (0, vitest_1.expect)(service.detect(message)).toBe("consultar_precio");
    });
    (0, vitest_1.it)("detecta consulta de talle", () => {
        const message = "en que talle tenes?";
        (0, vitest_1.expect)(service.detect(message)).toBe("consultar_talle");
    });
    (0, vitest_1.it)("detecta pedido explicito de link de pago", () => {
        const message = "perfecto, si enviame el link de pago";
        (0, vitest_1.expect)(service.detect(message)).toBe("pedir_link_pago");
    });
    (0, vitest_1.it)("detecta reporte de pago realizado para confirmacion manual", () => {
        const message = "ya transferi, te mande el comprobante";
        (0, vitest_1.expect)(service.detect(message)).toBe("reportar_pago");
    });
    (0, vitest_1.it)("no marca saludo simple como comercial", () => {
        const message = "Hola, buenas noches";
        (0, vitest_1.expect)(service.detect(message)).toBe("saludo");
        (0, vitest_1.expect)(service.isBusinessRelated(message, false)).toBe(false);
    });
    (0, vitest_1.it)("detecta aceptacion corta de oferta en contexto comercial", () => {
        const message = "si dale";
        (0, vitest_1.expect)(service.detect(message)).toBe("aceptar_oferta");
    });
    (0, vitest_1.it)("detecta pedido de alternativas", () => {
        const message = "tenes otra opcion en otro color?";
        (0, vitest_1.expect)(service.detect(message)).toBe("pedir_alternativa");
    });
    (0, vitest_1.it)("detecta eleccion de variante por referencia", () => {
        const message = "la blanca";
        (0, vitest_1.expect)(service.detect(message)).toBe("elegir_variante");
    });
});
(0, vitest_1.describe)("LeadClassifierService (scoring comercial)", () => {
    const classifier = new lead_classifier_service_1.LeadClassifierService();
    (0, vitest_1.it)("sube a interesado cuando consulta stock", () => {
        const result = classifier.classify("buscar_producto", "Hola, tenes stock de forum low?");
        (0, vitest_1.expect)(result.score).toBeGreaterThanOrEqual(40);
        (0, vitest_1.expect)(result.status).toBe("interesado");
    });
    (0, vitest_1.it)("sube a caliente cuando confirma compra", () => {
        const result = classifier.classify("confirmar_compra", "Dale, me lo llevo");
        (0, vitest_1.expect)(result.score).toBeGreaterThanOrEqual(100);
        (0, vitest_1.expect)(result.status).toBe("caliente");
    });
    (0, vitest_1.it)("sube a caliente cuando acepta una oferta", () => {
        const result = classifier.classify("aceptar_oferta", "si dale");
        (0, vitest_1.expect)(result.score).toBeGreaterThanOrEqual(100);
        (0, vitest_1.expect)(result.status).toBe("caliente");
    });
    (0, vitest_1.it)("sube a caliente cuando reporta pago", () => {
        const result = classifier.classify("reportar_pago", "ya transferi");
        (0, vitest_1.expect)(result.score).toBeGreaterThanOrEqual(100);
        (0, vitest_1.expect)(result.status).toBe("caliente");
    });
});
