import { Controller, Get } from "@nestjs/common";
import type { AdminHealthLiveResponse } from "@travelos/contracts/admin";

@Controller("health")
export class AdminHealthController {
  @Get("live")
  live(): AdminHealthLiveResponse {
    return {
      status: "ok",
      service: "admin-api",
      environment: "DEVELOPMENT",
    };
  }
}
