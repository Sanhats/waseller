import { prisma } from "../../../../packages/db/src";

type VariantCandidate = {
  productId: string;
  productName: string;
  variantId?: string | null;
  sku?: string | null;
  attributes: Record<string, string>;
};

export class ProductMatcherService {
  private normalize(value: string): string {
    return value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  private buildProductAxisValues(
    variants: Array<{ productId: string; attributes: Record<string, string> }>,
    requiredAxes: string[]
  ): Map<string, Record<string, string[]>> {
    const byProduct = new Map<string, Record<string, Set<string>>>();
    for (const item of variants) {
      const current = byProduct.get(item.productId) ?? {};
      for (const axis of requiredAxes) {
        const value = item.attributes[axis];
        if (!value) continue;
        const bucket = current[axis] ?? new Set<string>();
        bucket.add(value);
        current[axis] = bucket;
      }
      byProduct.set(item.productId, current);
    }

    return new Map(
      Array.from(byProduct.entries()).map(([productId, axisMap]) => [
        productId,
        Object.fromEntries(
          Object.entries(axisMap).map(([axis, values]) => [axis, Array.from(values)])
        ) as Record<string, string[]>
      ])
    );
  }

  async matchByMessage(
    tenantId: string,
    message: string,
    context?: {
      previousProductName?: string | null;
      previousProductConfidence?: number | null;
      lastRecommendedAction?: string | null;
      requiredAxes?: string[];
    }
  ): Promise<
    | (VariantCandidate & {
        missingAxes: string[];
        requestedAttributes: Record<string, string>;
        unavailableCombination?: boolean;
      })
    | null
  > {
    const text = this.normalize(message);
    const previousProductName = context?.previousProductName?.trim();
    const requiredAxes = Array.isArray(context?.requiredAxes)
      ? context.requiredAxes.map((item) => this.normalize(String(item))).filter(Boolean)
      : [];
    const variants = (await (prisma as any).$queryRaw`
      select
        p.id as "productId",
        p.name as "productName",
        p.tags as "productTags",
        v.id as "variantId",
        v.sku as "sku",
        v.attributes as "attributes",
        v.is_active as "isActive"
      from public.product_variants v
      inner join public.products p on p.id = v.product_id
      where v.tenant_id::text = ${tenantId}
        and v.is_active = true
      limit 400
    `) as Array<{
      productId: string;
      productName: string;
      productTags?: string[] | null;
      variantId: string;
      sku: string;
      attributes: Record<string, unknown>;
      isActive: boolean;
    }>;
    const normalized = variants.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      variantId: item.variantId,
      sku: item.sku,
      attributes: Object.fromEntries(
        Object.entries(item.attributes ?? {}).map(([key, value]) => [
          this.normalize(key),
          this.normalize(String(value ?? ""))
        ])
      ) as Record<string, string>,
      productTags: Array.isArray(item.productTags)
        ? item.productTags.map((tag) => this.normalize(String(tag)))
        : []
    }));
    const productAxisValues = this.buildProductAxisValues(normalized, requiredAxes);
    const resolveRequestedAttributes = (productId: string): Record<string, string> => {
      const axisValues = productAxisValues.get(productId) ?? {};
      return Object.fromEntries(
        requiredAxes.flatMap((axis) => {
          const values = axisValues[axis] ?? [];
          const match = values
            .filter((value) => text.includes(value))
            .sort((a, b) => b.length - a.length)[0];
          return match ? [[axis, match]] : [];
        })
      ) as Record<string, string>;
    };
    const resolveMissingAxes = (productId: string, requestedAttributes: Record<string, string>): string[] => {
      const axisValues = productAxisValues.get(productId) ?? {};
      return requiredAxes.filter((axis) => {
        const values = axisValues[axis] ?? [];
        return values.length > 0 && !requestedAttributes[axis];
      });
    };
    const variantsByProduct = new Map<string, typeof normalized>();
    for (const item of normalized) {
      const bucket = variantsByProduct.get(item.productId) ?? [];
      bucket.push(item);
      variantsByProduct.set(item.productId, bucket);
    }
    const tokens = text.split(/[^a-z0-9]+/g).filter((token) => token.length >= 2);
    const previousProductNormalized = this.normalize(previousProductName ?? "");
    const lastAction = String(context?.lastRecommendedAction ?? "").trim().toLowerCase();
    const productScores = Array.from(variantsByProduct.entries()).map(([productId, productVariants]) => {
      const first = productVariants[0];
      const requestedAttributes = resolveRequestedAttributes(productId);
      const missingAxes = resolveMissingAxes(productId, requestedAttributes);
      const haystack = `${this.normalize(first?.productName ?? "")} ${productVariants
        .map((item) => `${item.sku} ${Object.values(item.attributes).join(" ")} ${item.productTags.join(" ")}`)
        .join(" ")}`;
      const score = tokens.reduce((acc, token) => (haystack.includes(token) ? acc + 1 : acc), 0);
      const normalizedProductName = this.normalize(first?.productName ?? "");
      const exactProductMention = text.includes(normalizedProductName) || normalizedProductName.includes(text);
      const contextualMatch = Boolean(previousProductNormalized) && normalizedProductName === previousProductNormalized;
      const finalScore =
        score * 10 +
        (exactProductMention ? 20 : 0) +
        (contextualMatch ? 15 : 0) +
        Object.keys(requestedAttributes).length * 8 +
        (missingAxes.length > 0 ? -missingAxes.length : 5);
      return {
        productId,
        productName: first?.productName ?? "",
        productVariants,
        requestedAttributes,
        missingAxes,
        finalScore
      };
    });

    const buildMatchResult = (selectedProduct: (typeof productScores)[number]) => {
      const requestedAttributeCount = Object.keys(selectedProduct.requestedAttributes).length;
      const exactVariants = selectedProduct.productVariants.filter((item) =>
        Object.entries(selectedProduct.requestedAttributes).every(([axis, value]) => item.attributes[axis] === value)
      );
      const exact = exactVariants[0];
      const onlyOnePossibleVariant =
        selectedProduct.productVariants.length === 1 || (requestedAttributeCount > 0 && exactVariants.length === 1);
      if (onlyOnePossibleVariant && exact) {
        return {
          productId: selectedProduct.productId,
          productName: selectedProduct.productName,
          variantId: exact.variantId,
          sku: exact.sku,
          attributes: exact.attributes,
          missingAxes: [],
          requestedAttributes: selectedProduct.requestedAttributes
        };
      }
      if (requestedAttributeCount > 0) {
        return {
          productId: selectedProduct.productId,
          productName: selectedProduct.productName,
          variantId: null,
          sku: null,
          attributes: {},
          missingAxes: [],
          requestedAttributes: selectedProduct.requestedAttributes,
          unavailableCombination: true
        };
      }
      const fallback = selectedProduct.productVariants[0];
      return {
        productId: selectedProduct.productId,
        productName: selectedProduct.productName,
        variantId: fallback?.variantId ?? null,
        sku: fallback?.sku ?? null,
        attributes: fallback?.attributes ?? {},
        missingAxes: selectedProduct.missingAxes,
        requestedAttributes: selectedProduct.requestedAttributes
      };
    };

    const contextualProduct = productScores.find(
      (item) => this.normalize(item.productName) === previousProductNormalized
    );
    const isEllipticContinuation = /\b(si|dale|ok|listo|compr(o|a)|reserva|apart(a|ame)|pago|efectivo|puede\s+ser)\b/.test(
      text
    );
    const hasContextualAttributes = Object.keys(contextualProduct?.requestedAttributes ?? {}).length > 0;
    const shouldPreferContext =
      Boolean(contextualProduct) &&
      (hasContextualAttributes ||
        isEllipticContinuation ||
        lastAction === "offer_reservation" ||
        lastAction === "share_payment_link" ||
        lastAction === "ask_clarification");
    if (shouldPreferContext && contextualProduct) {
      return buildMatchResult(contextualProduct);
    }

    const bestProduct = productScores.sort((a, b) => b.finalScore - a.finalScore)[0];
    if (!bestProduct || bestProduct.finalScore <= 0 || text.trim().length === 0) return null;
    return {
      ...buildMatchResult(bestProduct)
    };
  }
}
