import { Controller, Get } from "@nestjs/common";
import type { PortalHealthLiveResponse } from "@travelos/contracts/portal";

@Controller("health")
export class PortalHealthController {
  @Get("live")
  live(): PortalHealthLiveResponse {
    return {
      status: "ok",
      service: "portal-api",
      environment: "DEVELOPMENT",
    };
  }
}
