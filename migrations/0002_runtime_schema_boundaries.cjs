const allApplicationSchemas = [
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

exports.up = (pgm) => {
  for (const schema of allApplicationSchemas) {
    pgm.sql(
      `REVOKE CREATE ON SCHEMA "${schema}" FROM "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";`,
    );
  }

  pgm.sql('GRANT USAGE ON SCHEMA "staff_access", "trip_ops" TO "travelos_admin_runtime";');
  pgm.sql('GRANT USAGE ON SCHEMA "portal_access", "presentation" TO "travelos_portal_runtime";');
  pgm.sql('GRANT USAGE ON SCHEMA "integration", "job_runtime" TO "travelos_worker_runtime";');
};

exports.down = false;
