import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { PortalApiModule } from "./app.module.js";
import { registerPortalAuthBridge, type PortalAuthBridgeOptions } from "./auth-bridge.js";

export interface CreatePortalApiOptions {
  readonly auth?: PortalAuthBridgeOptions;
}

export const createPortalApi = async (
  options: CreatePortalApiOptions = {},
): Promise<INestApplication> => {
  const application = await NestFactory.create(PortalApiModule, {
    abortOnError: true,
    logger: false,
  });
  if (options.auth !== undefined) {
    registerPortalAuthBridge(application, options.auth);
  }
  await application.init();
  return application;
};
