import { Module, type DynamicModule } from "@nestjs/common";
import type { AdminHealthEnvironment } from "@travelos/contracts/admin";

import { ADMIN_HEALTH_ENVIRONMENT, AdminHealthController } from "./health.controller.js";

@Module({})
export class AdminApiModule {
  static register(environment: AdminHealthEnvironment): DynamicModule {
    return {
      module: AdminApiModule,
      controllers: [AdminHealthController],
      providers: [{ provide: ADMIN_HEALTH_ENVIRONMENT, useValue: environment }],
    };
  }
}
