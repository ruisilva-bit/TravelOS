import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  createDevelopmentInstanceManifestJsonSchemaDocument,
  instanceManifestInvariantRegistry,
  parseDevelopmentInstanceManifest,
} from "../src/index.js";

type JsonObject = Record<string, unknown>;
type ListenerRecords = {
  adminApi: Record<string, unknown>;
  portalApi: Record<string, unknown>;
};

const examplePath = fileURLToPath(
  new URL("../../../deploy/manifests/development.example.json", import.meta.url),
);
const generatedSchemaPath = fileURLToPath(
  new URL("../../../deploy/manifests/schema/instance-manifest.schema.json", import.meta.url),
);
const validManifest = JSON.parse(readFileSync(examplePath, "utf8")) as JsonObject;
const copyManifest = (): JsonObject => structuredClone(validManifest);
const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const equalJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const resolveJsonPointer = (root: JsonObject, pointer: string): unknown => {
  if (!pointer.startsWith("#/")) throw new Error(`Unsupported JSON Schema reference: ${pointer}`);
  let current: unknown = root;
  for (const rawSegment of pointer.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObject(current) || !(segment in current)) {
      throw new Error(`JSON Schema reference does not exist: ${pointer}`);
    }
    current = current[segment];
  }
  return current;
};

const acceptsSchema = (schemaValue: unknown, value: unknown, root: JsonObject): boolean => {
  if (typeof schemaValue === "boolean") return schemaValue;
  if (!isObject(schemaValue)) throw new Error("JSON Schema node must be an object or boolean");
  if (typeof schemaValue["$ref"] === "string") {
    return acceptsSchema(resolveJsonPointer(root, schemaValue["$ref"]), value, root);
  }
  if (
    Array.isArray(schemaValue["allOf"]) &&
    !schemaValue["allOf"].every((schema) => acceptsSchema(schema, value, root))
  ) {
    return false;
  }
  if (
    Array.isArray(schemaValue["anyOf"]) &&
    !schemaValue["anyOf"].some((schema) => acceptsSchema(schema, value, root))
  ) {
    return false;
  }
  if (
    Array.isArray(schemaValue["oneOf"]) &&
    schemaValue["oneOf"].filter((schema) => acceptsSchema(schema, value, root)).length !== 1
  ) {
    return false;
  }
  if (schemaValue["not"] !== undefined && acceptsSchema(schemaValue["not"], value, root)) {
    return false;
  }
  if (schemaValue["const"] !== undefined && !equalJson(value, schemaValue["const"])) return false;
  if (
    Array.isArray(schemaValue["enum"]) &&
    !schemaValue["enum"].some((entry) => equalJson(value, entry))
  ) {
    return false;
  }

  const declaredType = schemaValue["type"];
  const typeMatches = (type: unknown): boolean => {
    if (type === "object") return isObject(value);
    if (type === "array") return Array.isArray(value);
    if (type === "string") return typeof value === "string";
    if (type === "integer") return typeof value === "number" && Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    if (type === "boolean") return typeof value === "boolean";
    if (type === "null") return value === null;
    return true;
  };
  if (Array.isArray(declaredType)) {
    if (!declaredType.some(typeMatches)) return false;
  } else if (declaredType !== undefined && !typeMatches(declaredType)) {
    return false;
  }

  if (typeof value === "string") {
    if (typeof schemaValue["minLength"] === "number" && value.length < schemaValue["minLength"])
      return false;
    if (typeof schemaValue["maxLength"] === "number" && value.length > schemaValue["maxLength"])
      return false;
    if (
      typeof schemaValue["pattern"] === "string" &&
      !new RegExp(schemaValue["pattern"], "u").test(value)
    )
      return false;
    if (
      schemaValue["format"] === "uuid" &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    )
      return false;
  }

  if (typeof value === "number") {
    if (typeof schemaValue["minimum"] === "number" && value < schemaValue["minimum"]) return false;
    if (typeof schemaValue["maximum"] === "number" && value > schemaValue["maximum"]) return false;
    if (
      typeof schemaValue["exclusiveMinimum"] === "number" &&
      value <= schemaValue["exclusiveMinimum"]
    )
      return false;
    if (
      typeof schemaValue["exclusiveMaximum"] === "number" &&
      value >= schemaValue["exclusiveMaximum"]
    )
      return false;
  }

  if (Array.isArray(value)) {
    if (typeof schemaValue["minItems"] === "number" && value.length < schemaValue["minItems"])
      return false;
    if (typeof schemaValue["maxItems"] === "number" && value.length > schemaValue["maxItems"])
      return false;
    if (
      schemaValue["uniqueItems"] === true &&
      new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length
    )
      return false;
    if (
      schemaValue["items"] !== undefined &&
      !value.every((entry) => acceptsSchema(schemaValue["items"], entry, root))
    )
      return false;
    if (Array.isArray(schemaValue["prefixItems"])) {
      for (const [index, itemSchema] of schemaValue["prefixItems"].entries()) {
        if (index < value.length && !acceptsSchema(itemSchema, value[index], root)) return false;
      }
    }
    if (schemaValue["contains"] !== undefined) {
      const matches = value.filter((entry) =>
        acceptsSchema(schemaValue["contains"], entry, root),
      ).length;
      const minimum =
        typeof schemaValue["minContains"] === "number" ? schemaValue["minContains"] : 1;
      const maximum =
        typeof schemaValue["maxContains"] === "number" ? schemaValue["maxContains"] : Infinity;
      if (matches < minimum || matches > maximum) return false;
    }
  }

  if (isObject(value)) {
    const required = Array.isArray(schemaValue["required"]) ? schemaValue["required"] : [];
    if (required.some((key) => typeof key !== "string" || !(key in value))) return false;
    const properties = isObject(schemaValue["properties"]) ? schemaValue["properties"] : {};
    for (const [key, propertyValue] of Object.entries(value)) {
      if (key in properties) {
        if (!acceptsSchema(properties[key], propertyValue, root)) return false;
      } else if (schemaValue["additionalProperties"] === false) {
        return false;
      } else if (
        schemaValue["additionalProperties"] !== undefined &&
        schemaValue["additionalProperties"] !== true &&
        !acceptsSchema(schemaValue["additionalProperties"], propertyValue, root)
      ) {
        return false;
      }
    }
  }
  return true;
};

const generatedSchema = createDevelopmentInstanceManifestJsonSchemaDocument() as JsonObject;
const jsonSchemaAccepts = (value: unknown): boolean =>
  acceptsSchema(generatedSchema, value, generatedSchema);
const runtimeAccepts = (value: unknown): boolean => {
  try {
    parseDevelopmentInstanceManifest(value);
    return true;
  } catch {
    return false;
  }
};
const listenersOf = (candidate: JsonObject): ListenerRecords => {
  const runtime = candidate["runtime"] as JsonObject;
  return runtime["listeners"] as ListenerRecords;
};

describe("development manifest JSON Schema and runtime conformance", () => {
  it("accepts the representative valid manifest in runtime and JSON Schema", () => {
    expect(runtimeAccepts(copyManifest())).toBe(true);
    expect(jsonSchemaAccepts(copyManifest())).toBe(true);
  });

  it("rejects unknown root and represented nested keys in runtime and JSON Schema", () => {
    const unknownRoot = copyManifest();
    unknownRoot["unexpected"] = true;
    const unknownNested = copyManifest();
    listenersOf(unknownNested)["adminApi"]["unexpected"] = true;
    for (const candidate of [unknownRoot, unknownNested]) {
      expect(runtimeAccepts(candidate)).toBe(false);
      expect(jsonSchemaAccepts(candidate)).toBe(false);
    }
  });

  it.each(["localhost", "0.0.0.0", "127.0.0.256", "127.00.0.1"])(
    "rejects invalid listener host %s consistently",
    (host) => {
      const candidate = copyManifest();
      listenersOf(candidate)["adminApi"]["host"] = host;
      expect(runtimeAccepts(candidate)).toBe(false);
      expect(jsonSchemaAccepts(candidate)).toBe(false);
    },
  );

  it("represents exact host surface cardinality", () => {
    const candidate = copyManifest();
    candidate["hostAllowlist"] = [
      { host: "admin.travelos.test", surface: "ADMIN" },
      { host: "portal.travelos.test", surface: "ADMIN" },
    ];
    expect(runtimeAccepts(candidate)).toBe(false);
    expect(jsonSchemaAccepts(candidate)).toBe(false);
  });

  it.each([1_023, 65_536, 3_101.5, "3101"])("represents invalid API port %s", (port) => {
    const candidate = copyManifest();
    listenersOf(candidate)["adminApi"]["port"] = port;
    expect(runtimeAccepts(candidate)).toBe(false);
    expect(jsonSchemaAccepts(candidate)).toBe(false);
  });

  it("identifies listener collision as runtime-only without weakening runtime validation", () => {
    const candidate = copyManifest();
    listenersOf(candidate)["portalApi"] = structuredClone(listenersOf(candidate)["adminApi"]);
    expect(jsonSchemaAccepts(candidate)).toBe(true);
    expect(runtimeAccepts(candidate)).toBe(false);
    expect(instanceManifestInvariantRegistry.runtimeOnly).toContainEqual(
      expect.objectContaining({ id: "TOS-CONFIG-RUNTIME-001" }),
    );
  });

  it("allows equal port numbers on clearly distinct loopback bind addresses", () => {
    const candidate = copyManifest();
    listenersOf(candidate)["portalApi"]["host"] = "127.0.0.2";
    listenersOf(candidate)["portalApi"]["port"] = listenersOf(candidate)["adminApi"]["port"];
    expect(jsonSchemaAccepts(candidate)).toBe(true);
    expect(runtimeAccepts(candidate)).toBe(true);
  });

  it("identifies host and allowlist relationships as runtime-only", () => {
    const candidate = copyManifest();
    candidate["hostAllowlist"] = [
      { host: "wrong.travelos.test", surface: "ADMIN" },
      { host: "portal.travelos.test", surface: "PORTAL" },
    ];
    expect(jsonSchemaAccepts(candidate)).toBe(true);
    expect(runtimeAccepts(candidate)).toBe(false);
    expect(instanceManifestInvariantRegistry.runtimeOnly).toContainEqual(
      expect.objectContaining({ id: "TOS-CONFIG-RUNTIME-003" }),
    );
  });

  it("keeps the generated schema and machine-readable invariant registry current", () => {
    const generated = `${JSON.stringify(generatedSchema, null, 2)}\n`;
    expect(readFileSync(generatedSchemaPath, "utf8")).toBe(generated);
    expect(generatedSchema["x-travelos-invariant-registry"]).toEqual(
      instanceManifestInvariantRegistry,
    );
    expect(generatedSchema["$comment"]).toMatch(/not fully semantically equivalent/i);
  });
});
