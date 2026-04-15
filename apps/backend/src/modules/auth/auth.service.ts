import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { prisma } from "../../../../../packages/db/src";
import {
  authRuntimeEnvFromProcess,
  loginUser,
  registerTenantUser,
  type AuthError
} from "@waseller/api-core";

function throwFromAuthError(e: AuthError): never {
  if (e.status === 401) throw new UnauthorizedException(e.message);
  if (e.status === 409) throw new ConflictException(e.message);
  throw new BadRequestException(e.message);
}

@Injectable()
export class AuthService {
  async login(
    email: string,
    password: string,
    tenantId?: string
  ): Promise<{ tenantId: string; token: string; expiresAt: string; role: string; email: string }> {
    const runtime = authRuntimeEnvFromProcess(process.env);
    const r = await loginUser(prisma, runtime, {
      email,
      password,
      tenantId
    });
    if (!r.ok) throwFromAuthError(r.error);
    return r.data;
  }

  async registerTenant(input: {
    tenantName: string;
    whatsappNumber: string;
    email: string;
    password: string;
  }): Promise<{ tenantId: string; token: string; expiresAt: string; role: string; email: string }> {
    const runtime = authRuntimeEnvFromProcess(process.env);
    const r = await registerTenantUser(prisma, runtime, input);
    if (!r.ok) throwFromAuthError(r.error);
    return r.data;
  }
}
