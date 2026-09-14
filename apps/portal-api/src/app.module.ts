import { Module } from "@nestjs/common";

import { PortalHealthController } from "./health.controller.js";

@Module({
  controllers: [PortalHealthController],
})
export class PortalApiModule {}
