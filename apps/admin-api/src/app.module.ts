import { Module } from "@nestjs/common";

import { AdminHealthController } from "./health.controller.js";

@Module({
  controllers: [AdminHealthController],
})
export class AdminApiModule {}
