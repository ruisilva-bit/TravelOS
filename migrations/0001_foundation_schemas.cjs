const applicationSchemas = [
  "organization",
  "staff_access",
  "portal_access",
  "crm",
  "sales",
  "trip_ops",
  "presentation",
  "finance",
  "documents",
  "work_service",
  "communications",
  "activity",
  "audit",
  "integration",
  "job_runtime",
];

const schemaDescriptions = {
  organization: "Root-Agency and organization capability boundary",
  staff_access: "Physically separate Staff identity and access realm",
  portal_access: "Physically separate Portal identity and access realm",
  crm: "Customer relationship capability boundary",
  sales: "Commercial sales capability boundary",
  trip_ops: "Mutable internal trip-workspace capability boundary",
  presentation: "Customer-safe immutable presentation/read-model boundary",
  finance: "Finance capability boundary",
  documents: "Private document metadata and grant-safe capability boundary",
  work_service: "Internal work-service capability boundary",
  communications: "Communications capability boundary",
  activity: "Customer-visible operational activity boundary",
  audit: "Security and compliance audit boundary",
  integration: "Transactional integration and outbox boundary",
  job_runtime: "PostgreSQL-backed job-runtime boundary",
};

exports.up = (pgm) => {
  pgm.sql('ALTER SCHEMA "travelos_meta" OWNER TO "travelos_owner";');
  pgm.sql('ALTER TABLE "travelos_meta"."schema_migrations" OWNER TO "travelos_owner";');
  pgm.sql('REVOKE ALL PRIVILEGES ON SCHEMA "travelos_meta" FROM PUBLIC;');
  pgm.sql('REVOKE ALL PRIVILEGES ON TABLE "travelos_meta"."schema_migrations" FROM PUBLIC;');
  pgm.sql('REVOKE ALL PRIVILEGES ON SCHEMA "public" FROM PUBLIC;');
  pgm.sql('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA "public" FROM PUBLIC;');

  for (const schema of applicationSchemas) {
    pgm.sql(`CREATE SCHEMA "${schema}" AUTHORIZATION "travelos_owner";`);
    pgm.sql(`COMMENT ON SCHEMA "${schema}" IS '${schemaDescriptions[schema]}';`);
    pgm.sql(`REVOKE ALL PRIVILEGES ON SCHEMA "${schema}" FROM PUBLIC;`);
    pgm.sql(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "${schema}" FROM PUBLIC;`);
    pgm.sql(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "${schema}" FROM PUBLIC;`);
    pgm.sql(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA "${schema}" FROM PUBLIC;`);
    pgm.sql(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "travelos_owner" IN SCHEMA "${schema}" REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;`,
    );
    pgm.sql(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "travelos_owner" IN SCHEMA "${schema}" REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;`,
    );
    pgm.sql(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "travelos_owner" IN SCHEMA "${schema}" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`,
    );
    pgm.sql(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "travelos_owner" IN SCHEMA "${schema}" REVOKE USAGE ON TYPES FROM PUBLIC;`,
    );
  }
};

exports.down = false;
