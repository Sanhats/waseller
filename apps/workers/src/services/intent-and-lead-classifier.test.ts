import { describe, expect, it } from "vitest";
import { IntentDetectionService } from "./intent-detection.service";
import { LeadClassifierService } from "./lead-classifier.service";

describe("IntentDetectionService (es-AR comercial)", () => {
  const service = new IntentDetectionService();

  it("detecta consulta de stock con saludo mixto", () => {
    const message = "Hola buenas noches, tenes adidas forum low bad bunny?";
    expect(service.detect(message)).toBe("buscar_producto");
    expect(service.isBusinessRelated(message, false)).toBe(true);
  });

  it("detecta consulta con acento local", () => {
    const message = "Buenas, tenés jordan 1 low en 42?";
    expect(service.detect(message)).toBe("buscar_producto");
  });

  it("detecta cierre tipico argentino", () => {
    const message = "Dale dale, las paso a buscar mañana";
    expect(service.detect(message)).toBe("preguntar_retiro");
    expect(service.isBusinessRelated(message, false)).toBe(true);
  });

  it("detecta intencion de pago directo", () => {
    const message = "Pasame alias que te transfiero";
    expect(service.detect(message)).toBe("elegir_medio_pago");
  });

  it("detecta consulta de precio", () => {
    const message = "Cuanto vale la Adidas Forum?";
    expect(service.detect(message)).toBe("consultar_precio");
  });

  it("detecta consulta de talle", () => {
    const message = "en que talle tenes?";
    expect(service.detect(message)).toBe("consultar_talle");
  });

  it("detecta pedido explicito de link de pago", () => {
    const message = "perfecto, si enviame el link de pago";
    expect(service.detect(message)).toBe("pedir_link_pago");
  });

  it("detecta reporte de pago realizado para confirmacion manual", () => {
    const message = "ya transferi, te mande el comprobante";
    expect(service.detect(message)).toBe("reportar_pago");
  });

  it("no marca saludo simple como comercial", () => {
    const message = "Hola, buenas noches";
    expect(service.detect(message)).toBe("saludo");
    expect(service.isBusinessRelated(message, false)).toBe(false);
  });

  it("detecta aceptacion corta de oferta en contexto comercial", () => {
    const message = "si dale";
    expect(service.detect(message)).toBe("aceptar_oferta");
  });

  it("detecta pedido de alternativas", () => {
    const message = "tenes otra opcion en otro color?";
    expect(service.detect(message)).toBe("pedir_alternativa");
  });

  it("detecta eleccion de variante por referencia", () => {
    const message = "la blanca";
    expect(service.detect(message)).toBe("elegir_variante");
  });
});

describe("LeadClassifierService (scoring comercial)", () => {
  const classifier = new LeadClassifierService();

  it("sube a interesado cuando consulta stock", () => {
    const result = classifier.classify("buscar_producto", "Hola, tenes stock de forum low?");
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.status).toBe("interesado");
  });

  it("sube a caliente cuando confirma compra", () => {
    const result = classifier.classify("confirmar_compra", "Dale, me lo llevo");
    expect(result.score).toBeGreaterThanOrEqual(100);
    expect(result.status).toBe("caliente");
  });

  it("sube a caliente cuando acepta una oferta", () => {
    const result = classifier.classify("aceptar_oferta", "si dale");
    expect(result.score).toBeGreaterThanOrEqual(100);
    expect(result.status).toBe("caliente");
  });

  it("sube a caliente cuando reporta pago", () => {
    const result = classifier.classify("reportar_pago", "ya transferi");
    expect(result.score).toBeGreaterThanOrEqual(100);
    expect(result.status).toBe("caliente");
  });
});
