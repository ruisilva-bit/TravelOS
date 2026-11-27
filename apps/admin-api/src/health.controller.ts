import { Controller, Get, Inject } from "@nestjs/common";
import type { AdminHealthEnvironment, AdminHealthLiveResponse } from "@travelos/contracts/admin";

export const ADMIN_HEALTH_ENVIRONMENT = Symbol("ADMIN_HEALTH_ENVIRONMENT");

@Controller("health")
export class AdminHealthController {
  constructor(
    @Inject(ADMIN_HEALTH_ENVIRONMENT) private readonly environment: AdminHealthEnvironment,
  ) {}

  @Get("live")
  live(): AdminHealthLiveResponse {
    return {
      status: "ok",
      service: "admin-api",
      environment: this.environment,
    };
  }
}
