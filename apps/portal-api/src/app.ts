import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { hostHeaderMatchesExpectedHost } from "@travelos/auth-adapters";

import { PortalApiModule } from "./app.module.js";
import { registerPortalAuthBridge, type PortalAuthBridgeOptions } from "./auth-bridge.js";
import { createPortalHostValidationMiddleware } from "./host-validation.js";

export interface CreatePortalApiOptions {
  readonly expectedHost: string;
  readonly auth?: PortalAuthBridgeOptions;
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

export const createPortalApi = async (
  options: CreatePortalApiOptions,
): Promise<NestExpressApplication> => {
  if (
    options.auth !== undefined &&
    (!hostHeaderMatchesExpectedHost(options.auth.policy.expectedHost, options.expectedHost) ||
      !isCanonicalOriginForHost(options.auth.policy.canonicalOrigin, options.expectedHost))
  ) {
    throw new Error("Portal API and Portal auth must use the same canonical manifest host");
  }

  const application = await NestFactory.create<NestExpressApplication>(PortalApiModule, {
    abortOnError: true,
    logger: false,
    bodyParser: false,
  });
  application.use(createPortalHostValidationMiddleware(options.expectedHost));
  application.useBodyParser("json");
  if (options.auth !== undefined) {
    registerPortalAuthBridge(application, options.auth);
  }
  await application.init();
  return application;
};
