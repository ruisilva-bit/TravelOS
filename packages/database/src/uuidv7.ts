import { randomBytes } from "node:crypto";

import { uuidV7FromEntropy, type OpaqueId } from "@travelos/backend-core";

export const createUuidV7 = (now = Date.now()): OpaqueId => uuidV7FromEntropy(now, randomBytes(10));
