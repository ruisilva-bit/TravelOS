import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { hostHeaderMatchesExpectedHost } from "@travelos/auth-adapters";

import { AdminApiModule } from "./app.module.js";
import { registerAdminAuthBridge, type AdminAuthBridgeOptions } from "./auth-bridge.js";
import { createAdminHostValidationMiddleware } from "./host-validation.js";
import {
  createAdminCacheControlMiddleware,
  createAdminOriginValidationMiddleware,
} from "./http-security.js";

export interface CreateAdminApiOptions {
  readonly expectedHost: string;
  readonly auth?: AdminAuthBridgeOptions;
}

const isCanonicalOriginForHost = (canonicalOrigin: string, expectedHost: string): boolean => {
  try {
    const parsedOrigin = new URL(canonicalOrigin);
    return (
      parsedOrigin.origin === canonicalOrigin &&
      parsedOrigin.host === expectedHost &&
      parsedOrigin.pathname === "/" &&
      parsedOrigin.search === "" &&
      parsedOrigin.hash === "" &&
      parsedOrigin.username === "" &&
      parsedOrigin.password === ""
    );
  } catch {
    return false;
  }
};

export const createAdminApi = async (
  options: CreateAdminApiOptions,
): Promise<NestExpressApplication> => {
  if (
    options.auth !== undefined &&
    (!hostHeaderMatchesExpectedHost(options.auth.policy.expectedHost, options.expectedHost) ||
      !isCanonicalOriginForHost(options.auth.policy.canonicalOrigin, options.expectedHost))
  ) {
    throw new Error("Admin API and Staff auth must use the same canonical manifest host");
  }

  const application = await NestFactory.create<NestExpressApplication>(AdminApiModule, {
    abortOnError: true,
    logger: false,
    bodyParser: false,
  });
  application.use(createAdminCacheControlMiddleware());
  application.use(createAdminHostValidationMiddleware(options.expectedHost));
  application.use(
    createAdminOriginValidationMiddleware(options.auth?.policy.canonicalOrigin ?? null),
  );
  application.useBodyParser("json");
  if (options.auth !== undefined) {
    registerAdminAuthBridge(application, options.auth);
  }
  await application.init();
  return application;
};
