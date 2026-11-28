// Quotes (orcamentos): lead-to-customer link, quote aggregate with lines and days, immutable
// customer-safe versions, revocable share links, acceptance records, protected compare-and-swap
// functions, number sequence and the worker expiry function.
//
// Money is bigint minor units in the currency registry scale. Quote lines and days are writable only
// while the parent quote is DRAFT (trigger-enforced; the functions return NOT_DRAFT first). Versions,
// acceptances and share-link tokens are append-only; the only link mutation is a one-time revocation.
//
// Applied migrations are never edited: this file is only ever applied once, after 0003.
exports.up = (pgm) => {
  // Fail closed unless this runs as the migrator login with the owner role assumed (the runner does
  // both), and unless the CRM and lead baseline plus the 0003 CRM details are present.
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '120s';

    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
      IF to_regclass('travelos_meta.schema_migrations') IS NULL
        OR to_regclass('crm.customer') IS NULL
        OR to_regclass('sales.lead') IS NULL
        OR to_regclass('finance.currency_registry') IS NULL
        OR to_regclass('staff_access.role_permission') IS NULL
        OR to_regclass('crm.customer_idempotency') IS NULL THEN
        RAISE EXCEPTION '0004 applies only to a database at the 0003 head';
      END IF;
    END
    $migration_context$;
  `);

  // 1. Lead belongs to a Customer. Qualification keeps qualifiedCustomerId; customerId is the general
  //    link and is backfilled from it. The lead transition trigger freezes non-OPEN leads, so the
  //    backfill disables that trigger for the one statement and re-enables it in the same transaction.
  pgm.sql(String.raw`
    ALTER TABLE sales.lead ADD COLUMN "customerId" uuid NULL;
    ALTER TABLE sales.lead ADD CONSTRAINT lead_customer_agency_fk
      FOREIGN KEY ("customerId", "agencyId") REFERENCES crm.customer(id, "agencyId") ON DELETE RESTRICT;
    ALTER TABLE sales.lead DISABLE TRIGGER lead_transition_trigger;
    UPDATE sales.lead SET "customerId" = "qualifiedCustomerId" WHERE "qualifiedCustomerId" IS NOT NULL;
    ALTER TABLE sales.lead ENABLE TRIGGER lead_transition_trigger;
    CREATE INDEX lead_agency_customer_idx ON sales.lead ("agencyId", "customerId");
    COMMENT ON COLUMN sales.lead."customerId" IS 'Customer this Lead belongs to; set while OPEN (see sales.set_lead_customer) and kept equal to qualifiedCustomerId once qualified.';
  `);

  // 2. Quote numbers: ORC-YYYY-NNNN per Agency and year, allocated under a row lock.
  pgm.sql(String.raw`
    CREATE TABLE sales.quote_number_sequence (
      "agencyId" uuid NOT NULL,
      year integer NOT NULL,
      "lastNumber" bigint NOT NULL,
      CONSTRAINT quote_number_sequence_pkey PRIMARY KEY ("agencyId", year),
      CONSTRAINT quote_number_sequence_agency_fk FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT,
      CONSTRAINT quote_number_sequence_year_check CHECK (year BETWEEN 2000 AND 9999),
      CONSTRAINT quote_number_sequence_last_check CHECK ("lastNumber" >= 1)
    );
  `);

  // 3. Quote aggregate header.
  pgm.sql(String.raw`
    CREATE TABLE sales.quote (
      id uuid NOT NULL,
      "agencyId" uuid NOT NULL,
      "customerId" uuid NOT NULL,
      "leadId" uuid NOT NULL,
      number text NOT NULL,
      title text NOT NULL,
      destination text NULL,
      "startDate" date NULL,
      "endDate" date NULL,
      adults integer DEFAULT 2 NOT NULL,
      children integer DEFAULT 0 NOT NULL,
      state text DEFAULT 'DRAFT' NOT NULL,
      "validUntil" date DEFAULT ((clock_timestamp() AT TIME ZONE 'UTC')::date + 14) NOT NULL,
      "currencyCode" character varying(3) DEFAULT 'EUR' NOT NULL,
      "pvpOverrideMinor" bigint NULL,
      "targetMarginBp" integer DEFAULT 1500 NOT NULL,
      "agencyNetShareBp" integer DEFAULT 2000 NOT NULL,
      "depositBp" integer DEFAULT 3000 NOT NULL,
      "balanceDueDays" integer DEFAULT 45 NOT NULL,
      "heroImageUrl" text NULL,
      intro text NULL,
      "internalNotes" text NULL,
      "excludedItems" text[] DEFAULT ARRAY['Despesas pessoais', 'Gorjetas', 'Taxas turísticas locais', 'Seguro de cancelamento (salvo indicação)']::text[] NOT NULL,
      "lockVersion" bigint DEFAULT 0 NOT NULL,
      "createdAt" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
      "updatedAt" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
      "createdByStaffPrincipalId" text NOT NULL,
      "convertedTripId" uuid NULL,
      CONSTRAINT quote_id_agency_unique UNIQUE (id, "agencyId"),
      CONSTRAINT quote_id_agency_customer_unique UNIQUE (id, "agencyId", "customerId"),
      CONSTRAINT quote_number_agency_unique UNIQUE ("agencyId", number),
      CONSTRAINT quote_pkey PRIMARY KEY (id),
      CONSTRAINT quote_agency_fk FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT,
      CONSTRAINT quote_customer_agency_fk FOREIGN KEY ("customerId", "agencyId") REFERENCES crm.customer(id, "agencyId") ON DELETE RESTRICT,
      CONSTRAINT quote_lead_agency_fk FOREIGN KEY ("leadId", "agencyId") REFERENCES sales.lead(id, "agencyId") ON DELETE RESTRICT,
      CONSTRAINT quote_currency_fk FOREIGN KEY ("currencyCode") REFERENCES finance.currency_registry("currencyCode"),
      CONSTRAINT quote_converted_trip_agency_fk FOREIGN KEY ("convertedTripId", "agencyId") REFERENCES trip_ops.trip(id, "agencyId") ON DELETE RESTRICT,
      CONSTRAINT quote_actor_agency_fk FOREIGN KEY ("agencyId", "createdByStaffPrincipalId") REFERENCES staff_access.staff_membership("agencyId", "staffPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT quote_number_shape CHECK (number ~ '^ORC-[0-9]{4}-[0-9]{4,}$'),
      CONSTRAINT quote_title_shape CHECK (length(btrim(title)) BETWEEN 1 AND 200),
      CONSTRAINT quote_destination_shape CHECK (destination IS NULL OR length(destination) <= 200),
      CONSTRAINT quote_dates_order CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate"),
      CONSTRAINT quote_adults_check CHECK (adults >= 1 AND adults <= 50),
      CONSTRAINT quote_children_check CHECK (children >= 0 AND children <= 50),
      CONSTRAINT quote_state_domain CHECK (state IN ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'ARCHIVED')),
      CONSTRAINT quote_pvp_override_check CHECK ("pvpOverrideMinor" IS NULL OR "pvpOverrideMinor" >= 0),
      CONSTRAINT quote_target_margin_check CHECK ("targetMarginBp" BETWEEN 0 AND 9000),
      CONSTRAINT quote_agency_net_share_check CHECK ("agencyNetShareBp" BETWEEN 0 AND 10000),
      CONSTRAINT quote_deposit_check CHECK ("depositBp" BETWEEN 0 AND 10000),
      CONSTRAINT quote_balance_days_check CHECK ("balanceDueDays" BETWEEN 0 AND 365),
      CONSTRAINT quote_hero_image_shape CHECK ("heroImageUrl" IS NULL OR ("heroImageUrl" LIKE 'https://%' AND length("heroImageUrl") <= 1000)),
      CONSTRAINT quote_intro_length CHECK (intro IS NULL OR length(intro) <= 2000),
      CONSTRAINT quote_internal_notes_length CHECK ("internalNotes" IS NULL OR length("internalNotes") <= 8000),
      CONSTRAINT quote_excluded_items_shape CHECK (cardinality("excludedItems") <= 50),
      CONSTRAINT quote_lock_version_check CHECK ("lockVersion" >= 0),
      CONSTRAINT quote_updated_not_before_created CHECK ("updatedAt" >= "createdAt")
    );

    CREATE INDEX quote_agency_customer_idx ON sales.quote ("agencyId", "customerId", "createdAt" DESC);
    CREATE INDEX quote_agency_lead_idx ON sales.quote ("agencyId", "leadId");
    CREATE INDEX quote_agency_state_validity_idx ON sales.quote ("agencyId", state, "validUntil");
  `);

  // 4. Lines. Flight and accommodation details are only allowed on their own category.
  pgm.sql(String.raw`
    CREATE TABLE sales.quote_line (
      id uuid NOT NULL,
      "agencyId" uuid NOT NULL,
      "quoteId" uuid NOT NULL,
      section text NOT NULL,
      position integer NOT NULL,
      category text NOT NULL,
      service text NOT NULL,
      supplier text NULL,
      description text NULL,
      "startDate" date NULL,
      "endDate" date NULL,
      quantity integer DEFAULT 1 NOT NULL,
      "netSupplierMinor" bigint DEFAULT 0 NOT NULL,
      "recommendedMinor" bigint DEFAULT 0 NOT NULL,
      "pvpMinor" bigint DEFAULT 0 NOT NULL,
      "customerVisible" boolean DEFAULT true NOT NULL,
      "imageUrl" text NULL,
      "internalNote" text NULL,
      "fromIata" character(3) NULL,
      "toIata" character(3) NULL,
      "departTime" time without time zone NULL,
      "arriveTime" time without time zone NULL,
      carrier text NULL,
      "flightNumber" text NULL,
      baggage text NULL,
      "roomType" text NULL,
      "boardBasis" text NULL,
      location text NULL,
      "lockVersion" bigint DEFAULT 0 NOT NULL,
      "createdAt" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
      "updatedAt" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
      CONSTRAINT quote_line_pkey PRIMARY KEY (id),
      CONSTRAINT quote_line_quote_agency_fk FOREIGN KEY ("quoteId", "agencyId") REFERENCES sales.quote(id, "agencyId") ON DELETE RESTRICT,
      CONSTRAINT quote_line_agency_fk FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT,
      CONSTRAINT quote_line_section_domain CHECK (section IN ('BASE', 'OPTION')),
      CONSTRAINT quote_line_position_check CHECK (position >= 0),
      CONSTRAINT quote_line_category_domain CHECK (category IN ('FLIGHT', 'ACCOMMODATION', 'TRANSFER', 'ACTIVITY', 'INSURANCE', 'CAR', 'OTHER')),
      CONSTRAINT quote_line_service_shape CHECK (length(btrim(service)) BETWEEN 1 AND 200),
      CONSTRAINT quote_line_supplier_shape CHECK (supplier IS NULL OR length(supplier) <= 200),
      CONSTRAINT quote_line_description_shape CHECK (description IS NULL OR length(description) <= 2000),
      CONSTRAINT quote_line_dates_order CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate"),
      CONSTRAINT quote_line_quantity_check CHECK (quantity >= 1 AND quantity <= 1000),
      CONSTRAINT quote_line_net_check CHECK ("netSupplierMinor" >= 0),
      CONSTRAINT quote_line_recommended_check CHECK ("recommendedMinor" >= 0),
      CONSTRAINT quote_line_pvp_check CHECK ("pvpMinor" >= 0),
      CONSTRAINT quote_line_image_shape CHECK ("imageUrl" IS NULL OR ("imageUrl" LIKE 'https://%' AND length("imageUrl") <= 1000)),
      CONSTRAINT quote_line_internal_note_shape CHECK ("internalNote" IS NULL OR length("internalNote") <= 2000),
      CONSTRAINT quote_line_iata_shape CHECK (
        ("fromIata" IS NULL OR "fromIata" ~ '^[A-Z]{3}$') AND ("toIata" IS NULL OR "toIata" ~ '^[A-Z]{3}$')
      ),
      CONSTRAINT quote_line_flight_fields_scope CHECK (
        category = 'FLIGHT' OR (
          "fromIata" IS NULL AND "toIata" IS NULL AND "departTime" IS NULL AND "arriveTime" IS NULL
          AND carrier IS NULL AND "flightNumber" IS NULL AND baggage IS NULL
        )
      ),
      CONSTRAINT quote_line_flight_text_shape CHECK (
        (carrier IS NULL OR length(carrier) <= 80) AND ("flightNumber" IS NULL OR length("flightNumber") <= 12)
        AND (baggage IS NULL OR length(baggage) <= 120)
      ),
      CONSTRAINT quote_line_accommodation_fields_scope CHECK (
        category = 'ACCOMMODATION' OR ("roomType" IS NULL AND "boardBasis" IS NULL AND location IS NULL)
      ),
      CONSTRAINT quote_line_accommodation_text_shape CHECK (
        ("roomType" IS NULL OR length("roomType") <= 120) AND ("boardBasis" IS NULL OR length("boardBasis") <= 80)
        AND (location IS NULL OR length(location) <= 200)
      ),
      CONSTRAINT quote_line_lock_version_check CHECK ("lockVersion" >= 0)
    );

    CREATE INDEX quote_line_order_idx ON sales.quote_line ("quoteId", section, position);
  `);

  // 5. Day programme, editorial and generated from lines; DRAFT-only like the lines.
  pgm.sql(String.raw`
    CREATE TABLE sales.quote_day (
      "agencyId" uuid NOT NULL,
      "quoteId" uuid NOT NULL,
      "dayIndex" integer NOT NULL,
      title text NOT NULL,
      description text NULL,
      CONSTRAINT quote_day_pkey PRIMARY KEY ("quoteId", "dayIndex"),
      CONSTRAINT quote_day_quote_agency_fk FOREIGN KEY ("quoteId", "agencyId") REFERENCES sales.quote(id, "agencyId") ON DELETE RESTRICT,
      CONSTRAINT quote_day_agency_fk FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT,
      CONSTRAINT quote_day_index_check CHECK ("dayIndex" >= 0),
      CONSTRAINT quote_day_title_shape CHECK (length(btrim(title)) BETWEEN 1 AND 120),
      CONSTRAINT quote_day_description_shape CHECK (description IS NULL OR length(description) <= 2000)
    );
  `);

  // 6. Immutable customer-safe versions. canonicalPayload is an explicit allowlist built by the
  //    application; it never contains INTERNAL_ONLY fields.
  pgm.sql(String.raw`
    CREATE TABLE sales.quote_version (
      id uuid NOT NULL,
      "agencyId" uuid NOT NULL,
      "quoteId" uuid NOT NULL,
      "versionNumber" integer NOT NULL,
      "sentAt" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
      "sentByStaffPrincipalId" text NOT NULL,
      "canonicalPayload" jsonb NOT NULL,
      "payloadSha256" bytea NOT NULL,
      "pvpFinalMinor" bigint NOT NULL,
      "currencyCode" character varying(3) NOT NULL,
      CONSTRAINT quote_version_pkey PRIMARY KEY (id),
      CONSTRAINT quote_version_id_agency_unique UNIQUE (id, "agencyId"),
      CONSTRAINT quote_version_id_agency_quote_unique UNIQUE (id, "agencyId", "quoteId"),
      CONSTRAINT quote_version_number_unique UNIQUE ("quoteId", "versionNumber"),
      CONSTRAINT quote_version_quote_agency_fk FOREIGN KEY ("quoteId", "agencyId") REFERENCES sales.quote(id, "agencyId") ON DELETE RESTRICT,
      CONSTRAINT quote_version_agency_fk FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT,
      CONSTRAINT quote_version_actor_agency_fk FOREIGN KEY ("agencyId", "sentByStaffPrincipalId") REFERENCES staff_access.staff_membership("agencyId", "staffPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT quote_version_number_check CHECK ("versionNumber" >= 1),
      CONSTRAINT quote_version_sha256_check CHECK (octet_length("payloadSha256") = 32),
      CONSTRAINT quote_version_pvp_check CHECK ("pvpFinalMinor" >= 0),
      CONSTRAINT quote_version_currency_fk FOREIGN KEY ("currencyCode") REFERENCES finance.currency_registry("currencyCode")
    );
  `);

  // 7. Share links for a quote version: SHA-256 of the token only, expiring, revocable once.
  pgm.sql(String.raw`
    CREATE TABLE sales.quote_share_link (
      "shareLinkId" uuid NOT NULL,
      "agencyId" uuid NOT NULL,
      "quoteId" uuid NOT NULL,
      "versionId" uuid NOT NULL,
      "tokenHash" bytea NOT NULL,
      "createdByStaffPrincipalId" text NOT NULL,
      "idempotencyKey" text NOT NULL,
      "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
      "expiresAt" timestamp with time zone NOT NULL,
      "revokedAt" timestamp with time zone NULL,
      CONSTRAINT quote_share_link_pkey PRIMARY KEY ("shareLinkId"),
      CONSTRAINT "quote_share_link_tokenHash_key" UNIQUE ("tokenHash"),
      CONSTRAINT quote_share_link_idempotency_unique UNIQUE ("agencyId", "createdByStaffPrincipalId", "idempotencyKey"),
      CONSTRAINT quote_share_link_version_fk FOREIGN KEY ("versionId", "agencyId", "quoteId") REFERENCES sales.quote_version(id, "agencyId", "quoteId") ON DELETE RESTRICT,
      CONSTRAINT quote_share_link_quote_agency_fk FOREIGN KEY ("quoteId", "agencyId") REFERENCES sales.quote(id, "agencyId") ON DELETE RESTRICT,
      CONSTRAINT quote_share_link_agency_fk FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT,
      CONSTRAINT quote_share_link_actor_agency_fk FOREIGN KEY ("agencyId", "createdByStaffPrincipalId") REFERENCES staff_access.staff_membership("agencyId", "staffPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT "quote_share_link_tokenHash_check" CHECK (octet_length("tokenHash") = 32),
      CONSTRAINT "quote_share_link_idempotencyKey_check" CHECK (length("idempotencyKey") BETWEEN 1 AND 128),
      CONSTRAINT quote_share_link_expiry_check CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '366 days')
    );

    CREATE INDEX quote_share_link_quote_idx ON sales.quote_share_link ("agencyId", "quoteId", "createdAt" DESC);
  `);

  // 8. Acceptance: one per version, insert-only, identified by the accepted name (no IP address).
  pgm.sql(String.raw`
    CREATE TABLE sales.quote_acceptance (
      "versionId" uuid NOT NULL,
      "agencyId" uuid NOT NULL,
      "acceptedAt" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
      "acceptedName" text NOT NULL,
      CONSTRAINT quote_acceptance_pkey PRIMARY KEY ("versionId"),
      CONSTRAINT quote_acceptance_version_fk FOREIGN KEY ("versionId", "agencyId") REFERENCES sales.quote_version(id, "agencyId") ON DELETE RESTRICT,
      CONSTRAINT quote_acceptance_name_shape CHECK (length(btrim("acceptedName")) BETWEEN 1 AND 120)
    );
  `);

  // 9. Triggers. Immutability and DRAFT-only writes are enforced in the database, not only in the
  //    functions. Trigger functions run as the owner with a pinned search_path.
  pgm.sql(String.raw`
    CREATE FUNCTION sales.enforce_quote_lead_customer() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        lead_customer uuid;
      BEGIN
        -- A qualified Lead keeps its customer in qualifiedCustomerId (its customerId is frozen with
        -- the rest of the terminal Lead), so the quote customer is the explicit link or that one.
        SELECT COALESCE(lead."customerId", lead."qualifiedCustomerId") INTO lead_customer
          FROM "sales"."lead" AS lead
         WHERE lead."id" = NEW."leadId" AND lead."agencyId" = NEW."agencyId";
        IF NOT FOUND OR lead_customer IS DISTINCT FROM NEW."customerId" THEN
          RAISE EXCEPTION 'The quote lead must belong to the quote customer'
            USING ERRCODE = '23514', CONSTRAINT = 'quote_lead_customer_mismatch';
        END IF;
        RETURN NEW;
      END
      $$;

    CREATE FUNCTION sales.require_quote_draft() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        parent_state text;
      BEGIN
        SELECT quote."state" INTO parent_state
          FROM "sales"."quote" AS quote
         WHERE quote."id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."quoteId" ELSE NEW."quoteId" END;
        IF parent_state IS DISTINCT FROM 'DRAFT' THEN
          RAISE EXCEPTION 'Quote lines and days are frozen once the quote leaves DRAFT'
            USING ERRCODE = '55000', CONSTRAINT = 'quote_not_draft';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END
      $$;

    CREATE FUNCTION sales.reject_quote_history_mutation() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      BEGIN
        RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME
          USING ERRCODE = '55000', CONSTRAINT = TG_TABLE_NAME || '_immutable';
      END
      $$;

    CREATE FUNCTION sales.guard_quote_share_link_mutation() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog', 'pg_temp'
      AS $$
      BEGIN
        IF TG_OP = 'UPDATE'
           AND OLD."revokedAt" IS NULL AND NEW."revokedAt" IS NOT NULL
           AND (pg_catalog.to_jsonb(NEW) - 'revokedAt') = (pg_catalog.to_jsonb(OLD) - 'revokedAt') THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Quote share links are append-only; only revocation is permitted'
          USING ERRCODE = '55000', CONSTRAINT = 'quote_share_link_immutable';
      END
      $$;

    CREATE TRIGGER quote_lead_customer_trigger BEFORE INSERT OR UPDATE OF "customerId", "leadId", "agencyId" ON sales.quote
      FOR EACH ROW EXECUTE FUNCTION sales.enforce_quote_lead_customer();
    CREATE TRIGGER quote_line_draft_trigger BEFORE INSERT OR UPDATE OR DELETE ON sales.quote_line
      FOR EACH ROW EXECUTE FUNCTION sales.require_quote_draft();
    CREATE TRIGGER quote_day_draft_trigger BEFORE INSERT OR UPDATE OR DELETE ON sales.quote_day
      FOR EACH ROW EXECUTE FUNCTION sales.require_quote_draft();
    CREATE TRIGGER quote_version_immutable_trigger BEFORE UPDATE OR DELETE ON sales.quote_version
      FOR EACH ROW EXECUTE FUNCTION sales.reject_quote_history_mutation();
    CREATE TRIGGER quote_version_truncate_guard_trigger BEFORE TRUNCATE ON sales.quote_version
      FOR EACH STATEMENT EXECUTE FUNCTION sales.reject_quote_history_mutation();
    CREATE TRIGGER quote_acceptance_immutable_trigger BEFORE UPDATE OR DELETE ON sales.quote_acceptance
      FOR EACH ROW EXECUTE FUNCTION sales.reject_quote_history_mutation();
    CREATE TRIGGER quote_acceptance_truncate_guard_trigger BEFORE TRUNCATE ON sales.quote_acceptance
      FOR EACH STATEMENT EXECUTE FUNCTION sales.reject_quote_history_mutation();
    CREATE TRIGGER quote_share_link_row_guard_trigger BEFORE DELETE OR UPDATE ON sales.quote_share_link
      FOR EACH ROW EXECUTE FUNCTION sales.guard_quote_share_link_mutation();
    CREATE TRIGGER quote_share_link_truncate_guard_trigger BEFORE TRUNCATE ON sales.quote_share_link
      FOR EACH STATEMENT EXECUTE FUNCTION sales.guard_quote_share_link_mutation();
  `);

  // 10. Protected functions. Outcomes: 'UPDATED', 'STALE', 'NOT_FOUND', 'NOT_DRAFT', 'DELETED',
  //     'INVALID_STATE', 'NOT_OPEN', 'CUSTOMER_MISMATCH', 'ACCEPTED', 'ALREADY_ACCEPTED', 'UNAVAILABLE'.
  pgm.sql(String.raw`
    CREATE FUNCTION sales.next_quote_number(p_agency_id uuid, p_year integer) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        allocated bigint;
      BEGIN
        IF p_agency_id IS NULL OR p_year IS NULL OR p_year < 2000 OR p_year > 9999 THEN
          RAISE EXCEPTION 'Quote number inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_number_input';
        END IF;
        INSERT INTO "sales"."quote_number_sequence" AS sequence ("agencyId", year, "lastNumber")
        VALUES (p_agency_id, p_year, 1)
        ON CONFLICT ("agencyId", year)
        DO UPDATE SET "lastNumber" = sequence."lastNumber" + 1
        RETURNING sequence."lastNumber" INTO allocated;
        RETURN 'ORC-' || p_year::text || '-' || lpad(allocated::text, 4, '0');
      END
      $$;

    CREATE FUNCTION sales.set_lead_customer(
      p_agency_id uuid, p_lead_id uuid, p_expected_lock_version bigint, p_customer_id uuid
    ) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        lead_state text;
        lead_version bigint;
      BEGIN
        IF p_agency_id IS NULL OR p_lead_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 1 THEN
          RAISE EXCEPTION 'Lead customer inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_lead_customer_input';
        END IF;
        SELECT lead."state", lead."lockVersion" INTO lead_state, lead_version
          FROM "sales"."lead" AS lead
         WHERE lead."agencyId" = p_agency_id AND lead."id" = p_lead_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RETURN 'NOT_FOUND';
        END IF;
        IF lead_version <> p_expected_lock_version THEN
          RETURN 'STALE';
        END IF;
        IF lead_state <> 'OPEN' THEN
          RETURN 'NOT_OPEN';
        END IF;
        IF EXISTS (
          SELECT 1 FROM "sales"."quote" AS quote
           WHERE quote."agencyId" = p_agency_id AND quote."leadId" = p_lead_id
             AND quote."customerId" IS DISTINCT FROM p_customer_id
        ) THEN
          RETURN 'CUSTOMER_MISMATCH';
        END IF;
        UPDATE "sales"."lead" AS lead
           SET "customerId" = p_customer_id,
               "lockVersion" = lead."lockVersion" + 1,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
         WHERE lead."agencyId" = p_agency_id AND lead."id" = p_lead_id;
        RETURN 'UPDATED';
      END
      $$;

    CREATE FUNCTION sales.update_quote(
      p_agency_id uuid, p_quote_id uuid, p_expected_lock_version bigint,
      p_title text, p_destination text, p_start_date date, p_end_date date,
      p_adults integer, p_children integer, p_valid_until date,
      p_pvp_override_minor bigint, p_target_margin_bp integer, p_agency_net_share_bp integer,
      p_deposit_bp integer, p_balance_due_days integer, p_hero_image_url text, p_intro text,
      p_internal_notes text, p_excluded_items text[]
    ) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        quote_state text;
        quote_version bigint;
      BEGIN
        IF p_agency_id IS NULL OR p_quote_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
           p_title IS NULL OR p_excluded_items IS NULL THEN
          RAISE EXCEPTION 'Quote update inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_update_input';
        END IF;
        SELECT quote."state", quote."lockVersion" INTO quote_state, quote_version
          FROM "sales"."quote" AS quote
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RETURN 'NOT_FOUND';
        END IF;
        IF quote_version <> p_expected_lock_version THEN
          RETURN 'STALE';
        END IF;
        IF quote_state <> 'DRAFT' THEN
          RETURN 'NOT_DRAFT';
        END IF;
        UPDATE "sales"."quote" AS quote
           SET "title" = p_title,
               "destination" = p_destination,
               "startDate" = p_start_date,
               "endDate" = p_end_date,
               "adults" = p_adults,
               "children" = p_children,
               "validUntil" = p_valid_until,
               "pvpOverrideMinor" = p_pvp_override_minor,
               "targetMarginBp" = p_target_margin_bp,
               "agencyNetShareBp" = p_agency_net_share_bp,
               "depositBp" = p_deposit_bp,
               "balanceDueDays" = p_balance_due_days,
               "heroImageUrl" = p_hero_image_url,
               "intro" = p_intro,
               "internalNotes" = p_internal_notes,
               "excludedItems" = p_excluded_items,
               "lockVersion" = quote."lockVersion" + 1,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id;
        RETURN 'UPDATED';
      END
      $$;

    CREATE FUNCTION sales.update_quote_line(
      p_agency_id uuid, p_line_id uuid, p_expected_lock_version bigint,
      p_category text, p_service text, p_supplier text, p_description text,
      p_start_date date, p_end_date date, p_quantity integer,
      p_net_supplier_minor bigint, p_recommended_minor bigint, p_pvp_minor bigint,
      p_customer_visible boolean, p_image_url text, p_internal_note text,
      p_from_iata text, p_to_iata text, p_depart_time time without time zone, p_arrive_time time without time zone,
      p_carrier text, p_flight_number text, p_baggage text,
      p_room_type text, p_board_basis text, p_location text
    ) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        quote_state text;
        line_version bigint;
      BEGIN
        IF p_agency_id IS NULL OR p_line_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
           p_category IS NULL OR p_service IS NULL OR p_customer_visible IS NULL THEN
          RAISE EXCEPTION 'Quote line update inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_line_update_input';
        END IF;
        -- Lock the parent quote first: every line write serializes on it, so a concurrent send or
        -- reorder cannot interleave with this edit.
        SELECT quote."state", line."lockVersion" INTO quote_state, line_version
          FROM "sales"."quote_line" AS line
          JOIN "sales"."quote" AS quote
            ON quote."id" = line."quoteId" AND quote."agencyId" = line."agencyId"
         WHERE line."agencyId" = p_agency_id AND line."id" = p_line_id
         FOR UPDATE OF quote;
        IF NOT FOUND THEN
          RETURN 'NOT_FOUND';
        END IF;
        IF line_version <> p_expected_lock_version THEN
          RETURN 'STALE';
        END IF;
        IF quote_state <> 'DRAFT' THEN
          RETURN 'NOT_DRAFT';
        END IF;
        UPDATE "sales"."quote_line" AS line
           SET "category" = p_category,
               "service" = p_service,
               "supplier" = p_supplier,
               "description" = p_description,
               "startDate" = p_start_date,
               "endDate" = p_end_date,
               "quantity" = p_quantity,
               "netSupplierMinor" = p_net_supplier_minor,
               "recommendedMinor" = p_recommended_minor,
               "pvpMinor" = p_pvp_minor,
               "customerVisible" = p_customer_visible,
               "imageUrl" = p_image_url,
               "internalNote" = p_internal_note,
               "fromIata" = p_from_iata,
               "toIata" = p_to_iata,
               "departTime" = p_depart_time,
               "arriveTime" = p_arrive_time,
               "carrier" = p_carrier,
               "flightNumber" = p_flight_number,
               "baggage" = p_baggage,
               "roomType" = p_room_type,
               "boardBasis" = p_board_basis,
               "location" = p_location,
               "lockVersion" = line."lockVersion" + 1,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
         WHERE line."agencyId" = p_agency_id AND line."id" = p_line_id;
        RETURN 'UPDATED';
      END
      $$;

    CREATE FUNCTION sales.delete_quote_line(p_agency_id uuid, p_line_id uuid, p_expected_lock_version bigint)
      RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        quote_state text;
        line_version bigint;
      BEGIN
        IF p_agency_id IS NULL OR p_line_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 0 THEN
          RAISE EXCEPTION 'Quote line delete inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_line_delete_input';
        END IF;
        SELECT quote."state", line."lockVersion" INTO quote_state, line_version
          FROM "sales"."quote_line" AS line
          JOIN "sales"."quote" AS quote
            ON quote."id" = line."quoteId" AND quote."agencyId" = line."agencyId"
         WHERE line."agencyId" = p_agency_id AND line."id" = p_line_id
         FOR UPDATE OF quote;
        IF NOT FOUND THEN
          RETURN 'NOT_FOUND';
        END IF;
        IF line_version <> p_expected_lock_version THEN
          RETURN 'STALE';
        END IF;
        IF quote_state <> 'DRAFT' THEN
          RETURN 'NOT_DRAFT';
        END IF;
        DELETE FROM "sales"."quote_line" AS line
         WHERE line."agencyId" = p_agency_id AND line."id" = p_line_id;
        RETURN 'DELETED';
      END
      $$;

    CREATE FUNCTION sales.reorder_quote_lines(
      p_agency_id uuid, p_quote_id uuid, p_expected_quote_lock_version bigint,
      p_line_ids uuid[], p_sections text[]
    ) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        quote_state text;
        quote_version bigint;
        total_lines integer;
      BEGIN
        IF p_agency_id IS NULL OR p_quote_id IS NULL OR p_expected_quote_lock_version IS NULL OR
           p_line_ids IS NULL OR p_sections IS NULL OR cardinality(p_line_ids) <> cardinality(p_sections) THEN
          RAISE EXCEPTION 'Quote line order inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_reorder_input';
        END IF;
        SELECT quote."state", quote."lockVersion" INTO quote_state, quote_version
          FROM "sales"."quote" AS quote
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RETURN 'NOT_FOUND';
        END IF;
        IF quote_version <> p_expected_quote_lock_version THEN
          RETURN 'STALE';
        END IF;
        IF quote_state <> 'DRAFT' THEN
          RETURN 'NOT_DRAFT';
        END IF;
        -- The submitted order must name every line of the quote exactly once.
        SELECT count(*)::integer INTO total_lines FROM "sales"."quote_line" AS line
         WHERE line."agencyId" = p_agency_id AND line."quoteId" = p_quote_id;
        IF total_lines <> cardinality(p_line_ids) OR
           (SELECT count(DISTINCT submitted) FROM unnest(p_line_ids) AS submitted) <> cardinality(p_line_ids) OR
           EXISTS (
             SELECT 1 FROM unnest(p_line_ids) AS submitted
              WHERE NOT EXISTS (
                SELECT 1 FROM "sales"."quote_line" AS line
                 WHERE line."id" = submitted AND line."agencyId" = p_agency_id AND line."quoteId" = p_quote_id
              )
           ) THEN
          RAISE EXCEPTION 'Quote line order must name every line of the quote exactly once'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_reorder_membership';
        END IF;
        WITH ordered AS (
          SELECT submitted.line_id,
                 submitted.section,
                 (row_number() OVER (PARTITION BY submitted.section ORDER BY submitted.ordinality) - 1)::integer AS new_position
            FROM unnest(p_line_ids, p_sections) WITH ORDINALITY AS submitted(line_id, section, ordinality)
        )
        UPDATE "sales"."quote_line" AS line
           SET "section" = ordered.section,
               "position" = ordered.new_position,
               "lockVersion" = line."lockVersion" + 1,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
          FROM ordered
         WHERE line."id" = ordered.line_id AND line."agencyId" = p_agency_id AND line."quoteId" = p_quote_id;
        UPDATE "sales"."quote" AS quote
           SET "lockVersion" = quote."lockVersion" + 1,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id;
        RETURN 'UPDATED';
      END
      $$;

    CREATE FUNCTION sales.set_quote_state(
      p_agency_id uuid, p_quote_id uuid, p_expected_lock_version bigint,
      p_from_states text[], p_to_state text
    ) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        quote_state text;
        quote_version bigint;
      BEGIN
        IF p_agency_id IS NULL OR p_quote_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
           p_from_states IS NULL OR cardinality(p_from_states) = 0 OR p_to_state IS NULL OR
           NOT (p_from_states <@ ARRAY['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'ARCHIVED']::text[]) OR
           NOT (p_to_state = ANY (ARRAY['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'ARCHIVED']::text[])) THEN
          RAISE EXCEPTION 'Quote state inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_state_input';
        END IF;
        SELECT quote."state", quote."lockVersion" INTO quote_state, quote_version
          FROM "sales"."quote" AS quote
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RETURN 'NOT_FOUND';
        END IF;
        IF quote_version <> p_expected_lock_version THEN
          RETURN 'STALE';
        END IF;
        IF NOT (quote_state = ANY (p_from_states)) THEN
          RETURN 'INVALID_STATE';
        END IF;
        UPDATE "sales"."quote" AS quote
           SET "state" = p_to_state,
               "lockVersion" = quote."lockVersion" + 1,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id;
        RETURN 'UPDATED';
      END
      $$;

    CREATE FUNCTION sales.read_quote_share(p_token_hash bytea) RETURNS TABLE(
      "versionId" uuid, "canonicalPayload" jsonb, "expiresAt" timestamp with time zone,
      "quoteState" text, "validUntil" date, "acceptedAt" timestamp with time zone, "acceptedName" text,
      "isLatest" boolean, "versionNumber" integer
    )
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path TO 'pg_catalog', 'pg_temp'
      AS $$
        SELECT version."id", version."canonicalPayload", link."expiresAt",
               quote."state", quote."validUntil", acceptance."acceptedAt", acceptance."acceptedName",
               NOT EXISTS (
                 SELECT 1 FROM "sales"."quote_version" AS newer
                  WHERE newer."quoteId" = version."quoteId" AND newer."versionNumber" > version."versionNumber"
               ) AS "isLatest", version."versionNumber"
          FROM "sales"."quote_share_link" AS link
          JOIN "sales"."quote_version" AS version
            ON version."id" = link."versionId" AND version."agencyId" = link."agencyId"
          JOIN "sales"."quote" AS quote
            ON quote."id" = link."quoteId" AND quote."agencyId" = link."agencyId"
          LEFT JOIN "sales"."quote_acceptance" AS acceptance
            ON acceptance."versionId" = version."id"
         WHERE link."tokenHash" = p_token_hash
           AND link."revokedAt" IS NULL
           AND link."expiresAt" > pg_catalog.clock_timestamp()
    $$;

    CREATE FUNCTION sales.accept_quote_share(p_token_hash bytea, p_accepted_name text) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        share_agency uuid;
        share_quote uuid;
        share_version uuid;
        share_version_number integer;
        share_state text;
        share_valid_until date;
        today date := (clock_timestamp() AT TIME ZONE 'UTC')::date;
      BEGIN
        IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 OR p_accepted_name IS NULL OR
           length(btrim(p_accepted_name)) NOT BETWEEN 1 AND 120 THEN
          RAISE EXCEPTION 'Quote acceptance inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_accept_input';
        END IF;
        SELECT link."agencyId", link."quoteId", version."id", version."versionNumber", quote."state", quote."validUntil"
          INTO share_agency, share_quote, share_version, share_version_number, share_state, share_valid_until
          FROM "sales"."quote_share_link" AS link
          JOIN "sales"."quote_version" AS version
            ON version."id" = link."versionId" AND version."agencyId" = link."agencyId"
          JOIN "sales"."quote" AS quote
            ON quote."id" = link."quoteId" AND quote."agencyId" = link."agencyId"
         WHERE link."tokenHash" = p_token_hash
           AND link."revokedAt" IS NULL
           AND link."expiresAt" > clock_timestamp()
         FOR UPDATE OF quote;
        IF NOT FOUND THEN
          RETURN 'UNAVAILABLE';
        END IF;
        IF EXISTS (
          SELECT 1 FROM "sales"."quote_version" AS newer
           WHERE newer."quoteId" = share_quote AND newer."versionNumber" > share_version_number
        ) THEN
          RETURN 'SUPERSEDED';
        END IF;
        IF EXISTS (SELECT 1 FROM "sales"."quote_acceptance" AS acceptance WHERE acceptance."versionId" = share_version) THEN
          RETURN 'ALREADY_ACCEPTED';
        END IF;
        IF share_state <> 'SENT' OR share_valid_until < today THEN
          RETURN 'UNAVAILABLE';
        END IF;
        INSERT INTO "sales"."quote_acceptance" ("versionId", "agencyId", "acceptedName")
        VALUES (share_version, share_agency, btrim(p_accepted_name));
        UPDATE "sales"."quote" AS quote
           SET "state" = 'ACCEPTED',
               "lockVersion" = quote."lockVersion" + 1,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
         WHERE quote."id" = share_quote AND quote."agencyId" = share_agency;
        RETURN 'ACCEPTED';
      END
      $$;

    CREATE FUNCTION sales.upsert_quote_day(
      p_agency_id uuid, p_quote_id uuid, p_expected_lock_version bigint,
      p_day_index integer, p_title text, p_description text
    ) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        quote_state text;
        quote_version bigint;
      BEGIN
        IF p_agency_id IS NULL OR p_quote_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
           p_day_index IS NULL OR p_day_index < 0 OR p_title IS NULL THEN
          RAISE EXCEPTION 'Quote day inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_day_input';
        END IF;
        SELECT quote."state", quote."lockVersion" INTO quote_state, quote_version
          FROM "sales"."quote" AS quote
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RETURN 'NOT_FOUND';
        END IF;
        IF quote_version <> p_expected_lock_version THEN
          RETURN 'STALE';
        END IF;
        IF quote_state <> 'DRAFT' THEN
          RETURN 'NOT_DRAFT';
        END IF;
        INSERT INTO "sales"."quote_day" ("agencyId", "quoteId", "dayIndex", title, description)
        VALUES (p_agency_id, p_quote_id, p_day_index, p_title, p_description)
        ON CONFLICT ("quoteId", "dayIndex")
        DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description;
        UPDATE "sales"."quote" AS quote
           SET "lockVersion" = quote."lockVersion" + 1,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id;
        RETURN 'UPDATED';
      END
      $$;

    CREATE FUNCTION sales.delete_quote_day(
      p_agency_id uuid, p_quote_id uuid, p_expected_lock_version bigint, p_day_index integer
    ) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        quote_state text;
        quote_version bigint;
      BEGIN
        IF p_agency_id IS NULL OR p_quote_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
           p_day_index IS NULL OR p_day_index < 0 THEN
          RAISE EXCEPTION 'Quote day inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_day_delete_input';
        END IF;
        SELECT quote."state", quote."lockVersion" INTO quote_state, quote_version
          FROM "sales"."quote" AS quote
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RETURN 'NOT_FOUND';
        END IF;
        IF quote_version <> p_expected_lock_version THEN
          RETURN 'STALE';
        END IF;
        IF quote_state <> 'DRAFT' THEN
          RETURN 'NOT_DRAFT';
        END IF;
        DELETE FROM "sales"."quote_day" AS day
         WHERE day."agencyId" = p_agency_id AND day."quoteId" = p_quote_id AND day."dayIndex" = p_day_index;
        UPDATE "sales"."quote" AS quote
           SET "lockVersion" = quote."lockVersion" + 1,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id;
        RETURN 'DELETED';
      END
      $$;

    CREATE FUNCTION sales.reset_quote_days(p_agency_id uuid, p_quote_id uuid, p_expected_lock_version bigint)
      RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        quote_state text;
        quote_version bigint;
      BEGIN
        IF p_agency_id IS NULL OR p_quote_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 0 THEN
          RAISE EXCEPTION 'Quote day reset inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_day_reset_input';
        END IF;
        SELECT quote."state", quote."lockVersion" INTO quote_state, quote_version
          FROM "sales"."quote" AS quote
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RETURN 'NOT_FOUND';
        END IF;
        IF quote_version <> p_expected_lock_version THEN
          RETURN 'STALE';
        END IF;
        IF quote_state <> 'DRAFT' THEN
          RETURN 'NOT_DRAFT';
        END IF;
        DELETE FROM "sales"."quote_day" AS day
         WHERE day."agencyId" = p_agency_id AND day."quoteId" = p_quote_id;
        UPDATE "sales"."quote" AS quote
           SET "lockVersion" = quote."lockVersion" + 1,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id;
        RETURN 'UPDATED';
      END
      $$;

    CREATE FUNCTION sales.link_quote_trip(p_agency_id uuid, p_quote_id uuid, p_trip_id uuid) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        quote_state text;
        existing_trip uuid;
      BEGIN
        IF p_agency_id IS NULL OR p_quote_id IS NULL OR p_trip_id IS NULL THEN
          RAISE EXCEPTION 'Quote trip link inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_trip_input';
        END IF;
        SELECT quote."state", quote."convertedTripId" INTO quote_state, existing_trip
          FROM "sales"."quote" AS quote
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RETURN 'NOT_FOUND';
        END IF;
        IF existing_trip IS NOT NULL THEN
          RETURN 'ALREADY_CONVERTED';
        END IF;
        IF quote_state <> 'ACCEPTED' THEN
          RETURN 'INVALID_STATE';
        END IF;
        UPDATE "sales"."quote" AS quote
           SET "convertedTripId" = p_trip_id,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
         WHERE quote."agencyId" = p_agency_id AND quote."id" = p_quote_id;
        RETURN 'UPDATED';
      END
      $$;

    CREATE FUNCTION job_runtime.expire_quotes(p_now timestamp with time zone) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        expired_count integer;
      BEGIN
        IF p_now IS NULL THEN
          RAISE EXCEPTION 'Quote expiry time is required'
            USING ERRCODE = '22023', CONSTRAINT = 'sales_quote_expire_input';
        END IF;
        WITH expired AS (
          UPDATE "sales"."quote" AS quote
             SET "state" = 'EXPIRED',
                 "lockVersion" = quote."lockVersion" + 1,
                 "updatedAt" = date_trunc('milliseconds', clock_timestamp())
           WHERE quote."state" = 'SENT'
             AND quote."validUntil" < (p_now AT TIME ZONE 'UTC')::date
          RETURNING 1
        )
        SELECT count(*)::integer INTO expired_count FROM expired;
        RETURN expired_count;
      END
      $$;
  `);

  // 11. Privileges. Admin runtime: SELECT and column-level INSERT only, plus the protected functions.
  //     No UPDATE or DELETE on quote tables; the single exception is the one-time share revocation.
  //     Worker runtime: EXECUTE on job_runtime.expire_quotes only. The worker holds no privilege on the
  //     sales schema; the SECURITY DEFINER function performs the one state change it needs.
  pgm.sql(String.raw`
    GRANT SELECT, INSERT ("id", "agencyId", "customerId", "leadId", number, title, destination, "startDate", "endDate",
      adults, children, "validUntil", "currencyCode", "pvpOverrideMinor", "targetMarginBp", "agencyNetShareBp",
      "depositBp", "balanceDueDays", "heroImageUrl", intro, "internalNotes", "excludedItems", "createdByStaffPrincipalId")
      ON TABLE sales.quote TO travelos_admin_runtime;
    GRANT SELECT, INSERT ("id", "agencyId", "quoteId", section, position, category, service, supplier, description,
      "startDate", "endDate", quantity, "netSupplierMinor", "recommendedMinor", "pvpMinor", "customerVisible",
      "imageUrl", "internalNote", "fromIata", "toIata", "departTime", "arriveTime", carrier, "flightNumber", baggage,
      "roomType", "boardBasis", location)
      ON TABLE sales.quote_line TO travelos_admin_runtime;
    GRANT SELECT, INSERT ON TABLE sales.quote_day TO travelos_admin_runtime;
    GRANT SELECT, INSERT ON TABLE sales.quote_version TO travelos_admin_runtime;
    GRANT SELECT, INSERT ON TABLE sales.quote_share_link TO travelos_admin_runtime;
    GRANT UPDATE ("revokedAt") ON TABLE sales.quote_share_link TO travelos_admin_runtime;
    GRANT SELECT ON TABLE sales.quote_acceptance TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.next_quote_number(uuid, integer) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.set_lead_customer(uuid, uuid, bigint, uuid) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.update_quote(uuid, uuid, bigint, text, text, date, date, integer, integer, date,
      bigint, integer, integer, integer, integer, text, text, text, text[]) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.update_quote_line(uuid, uuid, bigint, text, text, text, text, date, date, integer,
      bigint, bigint, bigint, boolean, text, text, text, text, time without time zone, time without time zone,
      text, text, text, text, text, text) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.delete_quote_line(uuid, uuid, bigint) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.reorder_quote_lines(uuid, uuid, bigint, uuid[], text[]) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.set_quote_state(uuid, uuid, bigint, text[], text) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.upsert_quote_day(uuid, uuid, bigint, integer, text, text) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.delete_quote_day(uuid, uuid, bigint, integer) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.reset_quote_days(uuid, uuid, bigint) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.link_quote_trip(uuid, uuid, uuid) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.read_quote_share(bytea) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION sales.accept_quote_share(bytea, text) TO travelos_admin_runtime;

    GRANT EXECUTE ON FUNCTION job_runtime.expire_quotes(timestamp with time zone) TO travelos_worker_runtime;
  `);

  // 12. Permissions. Registry additions are seeded into every existing Owner role template (the
  //     Owner template receives every registry permission at ALL access).
  pgm.sql(String.raw`
    INSERT INTO staff_access.role_permission ("roleId", "permissionId", "scopeKind", "accessLevel")
    SELECT role.id, permission.id, 'AGENCY', 'ALL'
      FROM staff_access.role AS role
      CROSS JOIN (VALUES ('quote.view'), ('quote.edit'), ('quote.send')) AS permission(id)
     WHERE role."templateKey" = 'agency-owner-v1'
    ON CONFLICT DO NOTHING;
  `);

  pgm.sql(String.raw`
    COMMENT ON TABLE sales.quote IS 'Commercial quote (orcamento) for a Customer, linked to a Lead. Money is bigint minor units. internalNotes is INTERNAL_ONLY; excludedItems and intro are customer-facing text. Header edits and lines are DRAFT-only.';
    COMMENT ON COLUMN sales.quote."internalNotes" IS 'INTERNAL_ONLY staff notes; never in quote versions, share links or customer-facing contracts.';
    COMMENT ON COLUMN sales.quote_line."internalNote" IS 'INTERNAL_ONLY staff note; never in quote versions, share links or customer-facing contracts.';
    COMMENT ON COLUMN sales.quote_line."netSupplierMinor" IS 'INTERNAL_ONLY supplier net cost in minor units; never in quote versions, share links or customer-facing contracts.';
    COMMENT ON COLUMN sales.quote_line."recommendedMinor" IS 'INTERNAL_ONLY recommended agency price in minor units; never in quote versions or customer-facing contracts.';
    COMMENT ON TABLE sales.quote_line IS 'Quote line in BASE or OPTION section. Writable only while the parent quote is DRAFT (trigger and CAS functions).';
    COMMENT ON TABLE sales.quote_day IS 'Day programme for a quote; DRAFT-only like the lines.';
    COMMENT ON TABLE sales.quote_version IS 'Append-only customer-safe frozen quote snapshot; canonicalPayload is an explicit allowlist.';
    COMMENT ON TABLE sales.quote_share_link IS 'Revocable, expiring read-only quote version link. Stores SHA-256 of the token only; never the token. Only revocation may change a row.';
    COMMENT ON TABLE sales.quote_acceptance IS 'Insert-once customer acceptance of one quote version; identified by the accepted name only.';
    COMMENT ON FUNCTION job_runtime.expire_quotes(timestamp with time zone) IS 'Worker-scoped SENT to EXPIRED sweep for quotes past validUntil; returns the count changed.';
    COMMENT ON TABLE sales.quote_number_sequence IS 'Per-Agency, per-year quote number counter; advanced only by sales.next_quote_number.';
  `);
};

exports.down = () => {
  throw new Error(
    "0004_quotes is forward-only: restore a backup or roll forward with a new migration",
  );
};
