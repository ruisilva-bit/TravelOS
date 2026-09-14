import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AdminApiModule } from "./app.module.js";

export const createAdminApi = async (): Promise<INestApplication> => {
  const application = await NestFactory.create(AdminApiModule, {
    abortOnError: true,
    logger: false,
  });
  await application.init();
  return application;
};
