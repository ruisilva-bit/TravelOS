import { developmentInstanceManifestJsonSchema } from "./instance-manifest.js";
import { instanceManifestInvariantRegistry } from "./instance-manifest-invariants.js";

export const developmentInstanceManifestRuntimeContract = instanceManifestInvariantRegistry;

export const createDevelopmentInstanceManifestJsonSchemaDocument = () => {
  const base = structuredClone(developmentInstanceManifestJsonSchema) as Record<string, unknown>;
  const properties = base["properties"] as Record<string, Record<string, unknown>>;
  const hostAllowlist = properties["hostAllowlist"];
  if (hostAllowlist === undefined) {
    throw new Error("Generated Zod JSON Schema omitted hostAllowlist");
  }
  properties["hostAllowlist"] = {
    ...hostAllowlist,
    uniqueItems: true,
    allOf: [
      {
        contains: {
          type: "object",
          required: ["surface"],
          properties: { surface: { const: "ADMIN" } },
        },
        minContains: 1,
        maxContains: 1,
      },
    ],
  };

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://travelos.local/schemas/development-instance-manifest.v1.json",
    title: "TravelOS DEVELOPMENT instance manifest — structural schema",
    $comment:
      "This JSON Schema includes all directly expressible constraints. It is not fully semantically equivalent to runtime validation. Consumers MUST also run the authoritative TravelOS runtime validator for the machine-readable runtimeOnly registry in x-travelos-invariant-registry.",
    ...base,
    "x-travelos-invariant-registry": instanceManifestInvariantRegistry,
  };
};
