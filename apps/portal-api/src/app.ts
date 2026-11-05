import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { hostHeaderMatchesExpectedHost } from "@travelos/auth-adapters/portal";
import { createRequestTelemetry } from "@travelos/observability";
import type {
  CurrentAuthorizedPortalTripListReader,
  CurrentPublishedPortalTripSnapshotReader,
} from "@travelos/portal-safe-core/customer-presentation";

import { PortalApiModule } from "./app.module.js";
import { registerPortalAuthBridge, type PortalAuthBridgeOptions } from "./auth-bridge.js";
import { createPortalHostValidationMiddleware } from "./host-validation.js";
import { registerPortalTripRoutes } from "./trip-routes.js";

export interface CreatePortalApiOptions {
  readonly expectedHost: string;
  readonly auth?: PortalAuthBridgeOptions;
  readonly tripSnapshotReader?: CurrentPublishedPortalTripSnapshotReader;
  readonly tripListReader?: CurrentAuthorizedPortalTripListReader;
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
  application.use(createRequestTelemetry("portal-api"));
  application.useBodyParser("json");
  if (options.auth !== undefined) {
    registerPortalAuthBridge(application, options.auth);
  }
  if (options.tripSnapshotReader !== undefined || options.tripListReader !== undefined) {
    if (options.auth === undefined) {
      throw new Error("Portal Trip routes require Portal authentication");
    }
    registerPortalTripRoutes(application, {
      realm: options.auth.realm,
      policy: options.auth.policy,
      ...(options.tripSnapshotReader === undefined ? {} : { reader: options.tripSnapshotReader }),
      ...(options.tripListReader === undefined ? {} : { listReader: options.tripListReader }),
    });
  }
  await application.init();
  return application;
};
