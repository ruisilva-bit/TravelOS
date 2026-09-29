import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AdminApiModule } from "./app.module.js";
import { registerAdminAuthBridge, type AdminAuthBridgeOptions } from "./auth-bridge.js";

export interface CreateAdminApiOptions {
  readonly auth?: AdminAuthBridgeOptions;
}

export const createAdminApi = async (
  options: CreateAdminApiOptions = {},
): Promise<NestExpressApplication> => {
  const application = await NestFactory.create<NestExpressApplication>(AdminApiModule, {
    abortOnError: true,
    logger: false,
  });
  application.useBodyParser("json");
  if (options.auth !== undefined) {
    registerAdminAuthBridge(application, options.auth);
  }
  await application.init();
  return application;
};
