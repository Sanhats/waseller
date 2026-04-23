import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { slugifyTenantCatalogSlug } from "../tenant-catalog-slug";
import type { UserRole } from "./types";
import { createAuthToken, type AuthTokenEnv } from "./token";

export type AuthPasswordEnv = {
  AUTH_PASSWORD_PEPPER: string;
  AUTH_FALLBACK_EMAIL: string;
  AUTH_FALLBACK_PASSWORD: string;
};

export type AuthRuntimeEnv = AuthTokenEnv & AuthPasswordEnv;

export const authRuntimeEnvFromProcess = (env: NodeJS.ProcessEnv): AuthRuntimeEnv => ({
  AUTH_TOKEN_SECRET: env.AUTH_TOKEN_SECRET ?? "dev-secret-change-me",
  AUTH_TOKEN_TTL_SECONDS: Number(env.AUTH_TOKEN_TTL_SECONDS ?? 60 * 60 * 8),
  AUTH_PASSWORD_PEPPER: env.AUTH_PASSWORD_PEPPER ?? "",
  AUTH_FALLBACK_EMAIL: env.AUTH_FALLBACK_EMAIL ?? "admin@demo.local",
  AUTH_FALLBACK_PASSWORD: env.AUTH_FALLBACK_PASSWORD ?? "demo123"
});

export type AuthSessionBody = {
  tenantId: string;
  token: string;
  expiresAt: string;
  role: string;
  email: string;
};

export type AuthError = { status: 400 | 401 | 409; message: string };
export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: AuthError };

const hashPassword = (pepper: string, tenantId: string, password: string): string =>
  createHash("sha256").update(`${password}:${tenantId}:${pepper}`).digest("hex");

const issueToken = (
  runtime: AuthRuntimeEnv,
  input: { userId: string; tenantId: string; role: UserRole; email: string }
): AuthSessionBody => {
  const { token, exp } = createAuthToken(runtime, {
    sub: input.userId,
    tenantId: input.tenantId,
    role: input.role,
    email: input.email
  });
  return {
    tenantId: input.tenantId,
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    role: input.role,
    email: input.email
  };
};

async function loginWithTenant(
  prisma: PrismaClient,
  runtime: AuthRuntimeEnv,
  tenantId: string,
  email: string,
  password: string
): Promise<AuthResult<AuthSessionBody>> {
  const normalizedEmail = email.toLowerCase().trim();
  let user:
    | {
        id: string;
        role: UserRole;
        email: string;
        passwordHash: string;
      }
    | null = null;

  try {
    user = await prisma.appUser.findFirst({
      where: {
        tenantId,
        email: normalizedEmail,
        isActive: true
      }
    });
  } catch (error) {
    const maybeError = error as { code?: string; message?: string };
    const message = maybeError?.message ?? "";
    const missingUsersTable = maybeError?.code === "P2021" || message.includes("app_users");
    if (!missingUsersTable) throw error;
  }

  if (!user) {
    const fallbackEmail = runtime.AUTH_FALLBACK_EMAIL.toLowerCase().trim();
    const fallbackHash = hashPassword(runtime.AUTH_PASSWORD_PEPPER, tenantId, runtime.AUTH_FALLBACK_PASSWORD);
    const candidateHash = hashPassword(runtime.AUTH_PASSWORD_PEPPER, tenantId, password);
    if (normalizedEmail !== fallbackEmail || candidateHash !== fallbackHash) {
      return { ok: false, error: { status: 401, message: "Credenciales inválidas" } };
    }
    user = {
      id: `fallback-${tenantId}`,
      role: "admin",
      email: fallbackEmail,
      passwordHash: fallbackHash
    };
  } else {
    const candidate = hashPassword(runtime.AUTH_PASSWORD_PEPPER, tenantId, password);
    if (candidate !== user.passwordHash) {
      return { ok: false, error: { status: 401, message: "Credenciales inválidas" } };
    }
  }

  return {
    ok: true,
    data: issueToken(runtime, {
      userId: user.id,
      tenantId,
      role: user.role,
      email: user.email
    })
  };
}

export async function loginUser(
  prisma: PrismaClient,
  runtime: AuthRuntimeEnv,
  input: { email: string; password: string; /** body.tenantId ?? header x-tenant-id */ tenantId?: string }
): Promise<AuthResult<AuthSessionBody>> {
  const tenantId = input.tenantId?.trim();
  if (tenantId) {
    return loginWithTenant(prisma, runtime, tenantId, input.email, input.password);
  }

  const normalizedEmail = input.email.toLowerCase().trim();
  const users = await prisma.appUser.findMany({
    where: {
      email: normalizedEmail,
      isActive: true
    },
    select: {
      id: true,
      tenantId: true,
      role: true,
      email: true,
      passwordHash: true
    }
  });

  if (users.length === 0) {
    return { ok: false, error: { status: 401, message: "Credenciales inválidas" } };
  }
  if (users.length > 1) {
    return {
      ok: false,
      error: {
        status: 409,
        message:
          "Tu email está asociado a más de un tenant. Contactá soporte para habilitar selección de workspace."
      }
    };
  }

  const user = users[0];
  const candidate = hashPassword(runtime.AUTH_PASSWORD_PEPPER, user.tenantId, input.password);
  if (candidate !== user.passwordHash) {
    return { ok: false, error: { status: 401, message: "Credenciales inválidas" } };
  }

  return {
    ok: true,
    data: issueToken(runtime, {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email
    })
  };
}

async function reserveUniquePublicCatalogSlug(prisma: PrismaClient, tenantName: string): Promise<string> {
  const root = slugifyTenantCatalogSlug(tenantName);
  let candidate = root;
  for (let n = 2; n < 10_000; n += 1) {
    const taken = await prisma.tenant.findFirst({
      where: { publicCatalogSlug: candidate },
      select: { id: true }
    });
    if (!taken) return candidate;
    candidate = `${root}-${n}`;
  }
  throw new Error("reserveUniquePublicCatalogSlug: demasiados intentos");
}

export async function registerTenantUser(
  prisma: PrismaClient,
  runtime: AuthRuntimeEnv,
  input: {
    tenantName: string;
    whatsappNumber: string;
    email: string;
    password: string;
  }
): Promise<AuthResult<AuthSessionBody>> {
  const tenantName = input.tenantName.trim();
  const whatsappNumber = input.whatsappNumber.trim().replace(/[^\d]/g, "");
  const email = input.email.toLowerCase().trim();
  const password = input.password;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!tenantName) return { ok: false, error: { status: 400, message: "tenantName es requerido" } };
  if (!whatsappNumber) return { ok: false, error: { status: 400, message: "whatsappNumber es requerido" } };
  if (whatsappNumber.length < 10) {
    return {
      ok: false,
      error: {
        status: 400,
        message: "El WhatsApp debe incluir codigo de pais y numero completo"
      }
    };
  }
  if (!email) return { ok: false, error: { status: 400, message: "email es requerido" } };
  if (!emailRegex.test(email)) return { ok: false, error: { status: 400, message: "Formato de email invalido" } };
  if (password.length < 6) {
    return { ok: false, error: { status: 400, message: "La contraseña debe tener al menos 6 caracteres" } };
  }

  const whatsappTaken = await prisma.tenant.findFirst({
    where: { whatsappNumber },
    select: { id: true }
  });
  if (whatsappTaken) {
    return {
      ok: false,
      error: {
        status: 409,
        message:
          "Ese número de WhatsApp ya está asociado a otro negocio. Si es tuyo, iniciá sesión; si necesitás otra cuenta, usá otro número."
      }
    };
  }

  const emailTaken = await prisma.appUser.findFirst({
    where: { email },
    select: { id: true }
  });
  if (emailTaken) {
    return {
      ok: false,
      error: {
        status: 409,
        message:
          "Ese correo electrónico ya está registrado. Iniciá sesión o usá otro email para crear un negocio nuevo."
      }
    };
  }

  const publicCatalogSlug = await reserveUniquePublicCatalogSlug(prisma, tenantName);

  let tenant: { id: string };
  let admin: { id: string; email: string };
  try {
    tenant = await prisma.tenant.create({
      data: {
        name: tenantName,
        whatsappNumber,
        publicCatalogSlug
      },
      select: { id: true }
    });

    const passwordHash = hashPassword(runtime.AUTH_PASSWORD_PEPPER, tenant.id, password);
    admin = await prisma.appUser.create({
      data: {
        tenantId: tenant.id,
        email,
        passwordHash,
        role: "admin",
        isActive: true
      },
      select: { id: true, email: true }
    });
  } catch (error) {
    const maybeError = error as { code?: string; message?: string };
    if (maybeError.code === "P2002") {
      return {
        ok: false,
        error: {
          status: 409,
          message:
            "Ese correo electrónico ya está registrado. Iniciá sesión o usá otro email para crear un negocio nuevo."
        }
      };
    }
    throw error;
  }

  return {
    ok: true,
    data: issueToken(runtime, {
      userId: admin.id,
      tenantId: tenant.id,
      role: "admin",
      email: admin.email
    })
  };
}
