import { currentCorrelationContext } from "@travelos/observability";
import { sql, type Kysely } from "kysely";

/** Transaction-local identifiers only; the outbox trigger captures them atomically. */
export const bindEventCorrelation = async (
  database: Kysely<Record<string, never>>,
): Promise<void> => {
  const context = currentCorrelationContext();
  await sql`SELECT set_config('travelos.correlation_id', ${context.correlationId}, true),
    set_config('travelos.traceparent', ${context.traceparent ?? ""}, true)`.execute(database);
};
