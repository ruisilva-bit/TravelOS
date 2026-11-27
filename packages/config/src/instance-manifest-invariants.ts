export const instanceManifestInvariantRegistry = {
  schemaVersion: 1,
  jsonSchemaScope: "STRUCTURAL_WITH_DECLARED_RUNTIME_REFINEMENTS",
  authoritativeRuntimeValidator: "@travelos/config.parseDevelopmentInstanceManifest",
  generatedJsonSchema: "deploy/manifests/schema/instance-manifest.schema.json",
  jsonSchemaRepresentable: [
    {
      id: "TOS-CONFIG-SCHEMA-001",
      path: "$",
      summary: "All represented objects reject unknown properties.",
    },
    {
      id: "TOS-CONFIG-SCHEMA-002",
      path: "manifestSchemaVersion,environment,instanceId,compatibility",
      summary:
        "Manifest identity, release compatibility, database schema bounds, and PostgreSQL major are constrained.",
    },
    {
      id: "TOS-CONFIG-SCHEMA-003",
      path: "hosts.*,hostAllowlist[*].host",
      summary: "Host values use the exact normalized lowercase FQDN grammar.",
    },
    {
      id: "TOS-CONFIG-SCHEMA-004",
      path: "hostAllowlist",
      summary: "Exactly one ADMIN surface entry is required.",
    },
    {
      id: "TOS-CONFIG-SCHEMA-005",
      path: "runtime.listeners.*.host",
      summary: "DEVELOPMENT API listeners are explicit IPv4 loopback addresses in 127.0.0.0/8.",
    },
    {
      id: "TOS-CONFIG-SCHEMA-006",
      path: "runtime.listeners.*.port",
      summary: "Configured API ports are integers from 1024 through 65535.",
    },
    {
      id: "TOS-CONFIG-SCHEMA-007",
      path: "runtime.shutdownGracePeriodMs,safeLimits.maxRequestBodyBytes",
      summary: "Shutdown timing and request body limits are bounded integers.",
    },
    {
      id: "TOS-CONFIG-SCHEMA-008",
      path: "agencyBootstrap",
      summary: "Agency bootstrap references and slugs use bounded DEVELOPMENT-safe identifiers.",
    },
    {
      id: "TOS-CONFIG-SCHEMA-009",
      path: "database",
      summary:
        "Database name, exact Admin/Worker role identities, and exactly two opaque credential-reference identifiers are constrained.",
    },
    {
      id: "TOS-CONFIG-SCHEMA-010",
      path: "features.foundationHealthEndpoints",
      summary: "The Stage 2 foundation health endpoint feature is required and enabled.",
    },
    {
      id: "TOS-CONFIG-SCHEMA-011",
      path: "authentication",
      summary:
        "Staff realm key material is referenced only by a distinct opaque systemd credential identifier.",
    },
  ],
  runtimeOnly: [
    {
      id: "TOS-CONFIG-RUNTIME-001",
      path: "hostAllowlist[*].host,hosts.*",
      summary: "Each allowlist host must equal the canonical host declared for its surface.",
      reason:
        "Draft 2020-12 cannot compare values in array entries with sibling object properties.",
    },
    {
      id: "TOS-CONFIG-RUNTIME-002",
      path: "hostAllowlist[*].host",
      summary: "Host allowlist host values must be unique across surface objects.",
      reason: "Draft 2020-12 uniqueItems compares complete objects, not a projected host property.",
    },
    {
      id: "TOS-CONFIG-RUNTIME-003",
      path: "database.runtimeRoles.*.credentialReference,authentication.*CredentialReference",
      summary: "Admin, Worker, and Staff-realm credential references must be pairwise distinct.",
      reason: "Draft 2020-12 cannot compare three sibling string values for inequality.",
    },
  ],
} as const;
