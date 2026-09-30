import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { hostHeaderMatchesExpectedHost } from "@travelos/auth-adapters";

import { AdminApiModule } from "./app.module.js";
import { registerAdminAuthBridge, type AdminAuthBridgeOptions } from "./auth-bridge.js";
import { createAdminHostValidationMiddleware } from "./host-validation.js";

export interface CreateAdminApiOptions {
  readonly expectedHost: string;
  readonly auth?: AdminAuthBridgeOptions;
}

export const createAdminApi = async (
  options: CreateAdminApiOptions,
): Promise<NestExpressApplication> => {
  if (
    options.auth !== undefined &&
    (!hostHeaderMatchesExpectedHost(options.auth.policy.expectedHost, options.expectedHost) ||
      new URL(options.auth.policy.canonicalOrigin).host !== options.expectedHost)
  ) {
    throw new Error("Admin API and Staff auth must use the same canonical manifest host");
  }

  const application = await NestFactory.create<NestExpressApplication>(AdminApiModule, {
    abortOnError: true,
    logger: false,
    bodyParser: false,
  });
  application.use(createAdminHostValidationMiddleware(options.expectedHost));
  application.useBodyParser("json");
  if (options.auth !== undefined) {
    registerAdminAuthBridge(application, options.auth);
  }
  await application.init();
  return application;
};
