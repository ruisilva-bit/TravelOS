import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { PortalApiModule } from "./app.module.js";

export const createPortalApi = async (): Promise<INestApplication> => {
  const application = await NestFactory.create(PortalApiModule, {
    abortOnError: true,
    logger: false,
  });
  await application.init();
  return application;
};
