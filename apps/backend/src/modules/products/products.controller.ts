import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { AuthTokenPayload } from "../../../../../packages/shared/src";
import { requireRole } from "../../common/auth/require-role";
import { ProductsService } from "./products.service";

@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async list(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Query("categoryId") categoryId?: string,
    @Query("q") q?: string
  ): Promise<
    Array<{
      variantId: string;
      productId: string;
      name: string;
      basePrice: unknown;
      variantPrice: unknown;
      effectivePrice: number;
      sku: string;
      attributes: Record<string, string>;
      stock: number;
      reservedStock: number;
      availableStock: number;
      imageUrl?: string | null;
      tags: string[];
      isActive: boolean;
      categoryIds: string[];
      categoryNames: string[];
    }>
  > {
    requireRole(req.auth?.role, ["admin", "vendedor", "viewer"]);
    return this.productsService.listByTenant(req.tenantId, {
      categoryId: categoryId?.trim() || undefined,
      q: q?.trim() || undefined
    });
  }

  @Post()
  async create(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Body()
    body: {
      name: string;
      price: number;
      imageUrl?: string;
      imageUrls?: string[];
      tags?: string[];
      variants?: Array<{
        sku: string;
        attributes: Record<string, string>;
        stock: number;
        price?: number | null;
        isActive?: boolean;
        imageUrls?: string[];
      }>;
      categoryIds?: string[];
    }
  ): Promise<unknown> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.productsService.createProduct(req.tenantId, body);
  }

  @Post(":productId/variants")
  async addVariant(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("productId") productId: string,
    @Body()
    body: {
      sku: string;
      attributes: Record<string, string>;
      stock: number;
      price?: number | null;
      isActive?: boolean;
      imageUrls?: string[];
    }
  ): Promise<unknown> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    const created = await this.productsService.addVariant(req.tenantId, productId, body);
    if (!created) throw new NotFoundException("Producto no encontrado");
    return created;
  }

  @Patch("variants/:variantId/adjust")
  async adjust(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("variantId") variantId: string,
    @Body() body: { stockDelta?: number; reservedDelta?: number; price?: number; isActive?: boolean }
  ): Promise<unknown> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.productsService.adjustStock(req.tenantId, variantId, body);
  }

  @Patch("variants/:variantId")
  async patchVariant(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("variantId") variantId: string,
    @Body()
    body: {
      sku?: string;
      attributes?: Record<string, string>;
      stock?: number;
      price?: number | null;
      isActive?: boolean;
      imageUrls?: string[] | null;
    }
  ): Promise<unknown> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.productsService.updateVariant(req.tenantId, variantId, body);
  }

  @Get("movements")
  async movements(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload; query: { limit?: string } }
  ): Promise<unknown[]> {
    requireRole(req.auth?.role, ["admin", "vendedor", "viewer"]);
    const limit = Number(req.query?.limit ?? 100);
    return this.productsService.listMovements(req.tenantId, Number.isFinite(limit) ? limit : 100);
  }

  @Patch(":productId")
  async patchProduct(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("productId") productId: string,
    @Body()
    body: {
      name?: string;
      price?: number;
      imageUrl?: string | null;
      imageUrls?: string[] | null;
      tags?: string[];
      categoryIds?: string[];
    }
  ): Promise<unknown> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.productsService.updateProduct(req.tenantId, productId, body);
  }
}
