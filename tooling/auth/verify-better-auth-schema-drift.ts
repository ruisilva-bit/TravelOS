import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

type AuthRealmKind = "STAFF";
type GeneratedField = {
  readonly type?: unknown;
  readonly fieldName?: unknown;
  readonly required?: unknown;
  readonly defaultValue?: unknown;
  readonly unique?: unknown;
  readonly index?: unknown;
  readonly references?: unknown;
};
type GeneratedTable = {
  readonly modelName?: unknown;
  readonly fields?: unknown;
};
type MigrationModule = {
  readonly up: (pgm: { sql(statement: string): void }) => void;
};

const repositoryRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const authAdaptersRequire = createRequire(
  path.join(repositoryRoot, "packages/auth-adapters/package.json"),
);
const migrationRequire = createRequire(import.meta.url);
const { kyselyAdapter } = authAdaptersRequire("@better-auth/kysely-adapter");
const { betterAuth } = authAdaptersRequire("better-auth");
const { getAuthTables } = authAdaptersRequire("better-auth/db");
const { twoFactor } = authAdaptersRequire("better-auth/plugins");
const verifierKeyMaterial = createHash("sha512")
  .update("travelos-stage-4-better-auth-schema-verifier")
  .digest("base64url");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Better Auth schema did not provide ${label}`);
  }
  return value;
};

const tableEntries = (generated: unknown): readonly [string, GeneratedTable][] => {
  if (!isRecord(generated)) throw new Error("Better Auth did not generate a table schema");
  return Object.entries(generated).map(([name, value]) => {
    if (!isRecord(value)) throw new Error(`Better Auth generated invalid table ${name}`);
    return [name, value];
  });
};

const fieldEntries = (table: GeneratedTable): readonly [string, GeneratedField][] => {
  if (!isRecord(table.fields)) throw new Error("Better Auth generated a table without fields");
  return Object.entries(table.fields).map(([name, value]) => {
    if (!isRecord(value)) throw new Error(`Better Auth generated invalid field ${name}`);
    return [name, value];
  });
};

const escapeExpression = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const generatedRealm = (kind: AuthRealmKind): unknown => {
  const schema = "staff_access";
  const prefix = "staff";
  const database = new Kysely<Record<string, never>>({
    dialect: new PostgresDialect({ pool: new Pool({ host: "127.0.0.1", port: 1, max: 1 }) }),
  });
  const realm = betterAuth({
    appName: `TravelOS ${kind}`,
    baseURL: "http://admin.travelos.test",
    basePath: `/api/auth/${prefix}`,
    database: kyselyAdapter(database.withSchema(schema), { type: "postgres", transaction: true }),
    secret: verifierKeyMaterial,
    trustedOrigins: ["http://admin.travelos.test"],
    emailAndPassword: { enabled: true, disableSignUp: true, requireEmailVerification: true },
    user: { modelName: `${prefix}_user` },
    session: { modelName: `${prefix}_session` },
    account: { modelName: `${prefix}_account` },
    verification: { modelName: `${prefix}_verification` },
    plugins: [twoFactor({ issuer: "TravelOS Staff", twoFactorTable: "staff_two_factor" })],
  });
  const generated = getAuthTables(realm.options);
  void database.destroy();
  return generated;
};

const migrationStatements = (): readonly string[] => {
  const migration = migrationRequire(
    path.resolve("migrations/0004_authentication_realms.cjs"),
  ) as MigrationModule;
  const statements: string[] = [];
  migration.up({ sql: (statement) => statements.push(statement) });
  return statements;
};

const tableStatement = (
  statements: readonly string[],
  schema: string,
  tableName: string,
): string => {
  const marker = `CREATE TABLE "${schema}"."${tableName}"`;
  const statement = statements.find((candidate) => candidate.includes(marker));
  if (statement === undefined)
    throw new Error(`Migration 0004 does not create ${schema}.${tableName}`);
  return statement;
};

const databaseTypeFor = (generatedType: string): string => {
  switch (generatedType) {
    case "string":
      return "text";
    case "boolean":
      return "boolean";
    case "date":
      return "timestamptz";
    case "number":
      return "integer";
    default:
      throw new Error(`Unsupported Better Auth schema type: ${generatedType}`);
  }
};

const columnClause = (statement: string, columnName: string): string => {
  const expression = new RegExp(`"${escapeExpression(columnName)}"\\s+[^,\\n]+`, "u");
  const match = statement.match(expression);
  if (match === null) throw new Error(`Migration column is missing: ${columnName}`);
  return match[0];
};

const actualColumnNames = (statement: string): readonly string[] =>
  [...statement.matchAll(/^\s*"([^"]+)"\s+[^,\n]+(?:,|$)/gmu)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
    .toSorted();

const expectedColumnNames = (table: GeneratedTable): readonly string[] =>
  [
    "id",
    ...fieldEntries(table).map(([fieldName, field]) =>
      typeof field.fieldName === "string" ? field.fieldName : fieldName,
    ),
  ].toSorted();

const assertExactColumnSet = (
  statement: string,
  table: GeneratedTable,
  tableName: string,
): void => {
  const expected = expectedColumnNames(table);
  const actual = actualColumnNames(statement);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Migration column set drift for ${tableName}: expected ${expected.join(", ")}; received ${actual.join(", ")}`,
    );
  }
};

const assertFieldParity = (statement: string, fieldName: string, field: GeneratedField): void => {
  const columnName = typeof field.fieldName === "string" ? field.fieldName : fieldName;
  const clause = columnClause(statement, columnName);
  const generatedType = requiredString(field.type, `${fieldName}.type`);
  if (!new RegExp(`\\b${databaseTypeFor(generatedType)}\\b`, "u").test(clause)) {
    throw new Error(`Migration type drift for ${columnName}`);
  }
  const requiresNotNull = field.required === true || field.defaultValue !== undefined;
  if (requiresNotNull && !/\bNOT NULL\b/u.test(clause)) {
    throw new Error(`Migration nullability drift for ${columnName}`);
  }
  if (field.defaultValue !== undefined) {
    const exactDefault =
      typeof field.defaultValue === "boolean" || typeof field.defaultValue === "number"
        ? new RegExp(`\\bDEFAULT\\s+${escapeExpression(String(field.defaultValue))}\\b`, "iu")
        : /\bDEFAULT\b/u;
    if (!exactDefault.test(clause)) {
      throw new Error(`Migration default drift for ${columnName}`);
    }
  }
  if (field.unique === true && !/\bUNIQUE\b/u.test(clause)) {
    throw new Error(`Migration uniqueness drift for ${columnName}`);
  }
};

const assertReferenceParity = (
  statement: string,
  schema: string,
  tableName: string,
  fieldName: string,
  field: GeneratedField,
): void => {
  if (!isRecord(field.references)) return;
  const model = requiredString(field.references.model, `${fieldName}.references.model`);
  const targetField = requiredString(field.references.field, `${fieldName}.references.field`);
  if (model !== "user" || targetField !== "id") {
    throw new Error(`Unsupported Better Auth reference for ${tableName}.${fieldName}`);
  }
  const columnName = typeof field.fieldName === "string" ? field.fieldName : fieldName;
  const clause = columnClause(statement, columnName);
  const [realmPrefix] = tableName.split("_", 1);
  if (realmPrefix !== "staff") {
    throw new Error(`Unsupported Better Auth table prefix for ${tableName}`);
  }
  const expectedTarget = `REFERENCES "${schema}"."${realmPrefix}_user" ("id")`;
  if (!clause.includes(expectedTarget)) {
    throw new Error(`Migration reference target drift for ${tableName}.${columnName}`);
  }
  const onDelete = field.references.onDelete;
  const allowsStrongerCascade = tableName === "staff_two_factor" && columnName === "userId";
  if (onDelete === "cascade" || allowsStrongerCascade) {
    if (!/\bON DELETE CASCADE\b/u.test(clause)) {
      throw new Error(`Migration deletion-policy drift for ${tableName}.${columnName}`);
    }
  } else if (/\bON DELETE\b/u.test(clause)) {
    throw new Error(`Unexpected migration deletion policy for ${tableName}.${columnName}`);
  }
};

const indexColumnsFor = (statements: readonly string[], tableName: string): readonly string[] => {
  const allSql = statements.join("\n");
  return [
    ...allSql.matchAll(
      new RegExp(
        `CREATE INDEX[^\\n]+ON\\s+"staff_access"\\."${escapeExpression(tableName)}"\\s+\\("([^"]+)"\\)`,
        "gu",
      ),
    ),
  ]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
    .toSorted();
};

const assertRealmParity = (
  kind: AuthRealmKind,
  statements: readonly string[],
): readonly string[] => {
  const schema = "staff_access";
  const tables = tableEntries(generatedRealm(kind));
  const expectedTableNames = tables
    .map(([, table]) => requiredString(table.modelName, "modelName"))
    .toSorted();
  const actualTableNames = statements
    .flatMap((statement) => [
      ...statement.matchAll(new RegExp(`CREATE TABLE "${schema}"\\."([^"]+)"`, "gu")),
    ])
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
    .toSorted();
  if (JSON.stringify(expectedTableNames) !== JSON.stringify(actualTableNames)) {
    throw new Error(`${kind} Better Auth table model names drift from migration 0004`);
  }
  for (const [, table] of tables) {
    const modelName = requiredString(table.modelName, "modelName");
    const statement = tableStatement(statements, schema, modelName);
    assertExactColumnSet(statement, table, modelName);
    for (const [fieldName, field] of fieldEntries(table)) {
      assertFieldParity(statement, fieldName, field);
      assertReferenceParity(statement, schema, modelName, fieldName, field);
    }
    const expectedIndexes = fieldEntries(table)
      .flatMap(([fieldName, field]) =>
        field.index === true
          ? [typeof field.fieldName === "string" ? field.fieldName : fieldName]
          : [],
      )
      .toSorted();
    const actualIndexes = indexColumnsFor(statements, modelName);
    if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
      throw new Error(
        `Migration index set drift for ${modelName}: expected ${expectedIndexes.join(", ")}; received ${actualIndexes.join(", ")}`,
      );
    }
  }
  return expectedTableNames;
};

const statements = migrationStatements();
const staffTables = assertRealmParity("STAFF", statements);
process.stdout.write(
  `${JSON.stringify({ schemaVersion: 1, result: "PASS", staffTables }, null, 2)}\n`,
);
