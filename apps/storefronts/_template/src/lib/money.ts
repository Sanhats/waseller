/** Formato de precio en pesos argentinos sin decimales (cambialo a tu moneda si corresponde). */
export const money = (n: number): string =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));
