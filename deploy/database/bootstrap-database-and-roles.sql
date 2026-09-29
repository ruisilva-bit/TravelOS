\set ON_ERROR_STOP on

\if :{?database_name}
\else
  \echo 'database_name psql variable is required'
  \quit 2
\endif

SELECT format('CREATE ROLE %I', role_name)
FROM (
  VALUES
    ('travelos_owner'),
    ('travelos_migrator'),
    ('travelos_admin_runtime'),
    ('travelos_portal_runtime'),
    ('travelos_worker_runtime'),
    ('travelos_admin_api'),
    ('travelos_portal_api'),
    ('travelos_worker')
) AS required_roles(role_name)
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name)
\gexec

ALTER ROLE travelos_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE travelos_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
ALTER ROLE travelos_admin_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE travelos_portal_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE travelos_worker_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE travelos_admin_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;
ALTER ROLE travelos_portal_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;
ALTER ROLE travelos_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10;

REVOKE travelos_owner, travelos_migrator FROM travelos_admin_api, travelos_portal_api, travelos_worker;
REVOKE travelos_admin_runtime, travelos_portal_runtime, travelos_worker_runtime FROM travelos_migrator;
GRANT travelos_owner TO travelos_migrator WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT travelos_admin_runtime TO travelos_admin_api WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
GRANT travelos_portal_runtime TO travelos_portal_api WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
GRANT travelos_worker_runtime TO travelos_worker WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;

ALTER ROLE travelos_owner SET search_path TO pg_catalog;
ALTER ROLE travelos_migrator SET search_path TO pg_catalog;
ALTER ROLE travelos_admin_api SET search_path TO pg_catalog;
ALTER ROLE travelos_portal_api SET search_path TO pg_catalog;
ALTER ROLE travelos_worker SET search_path TO pg_catalog;
ALTER ROLE travelos_migrator SET lock_timeout TO '5s';
ALTER ROLE travelos_migrator SET statement_timeout TO '5min';
ALTER ROLE travelos_admin_api SET lock_timeout TO '5s';
ALTER ROLE travelos_admin_api SET statement_timeout TO '30s';
ALTER ROLE travelos_admin_api SET idle_in_transaction_session_timeout TO '30s';
ALTER ROLE travelos_portal_api SET lock_timeout TO '5s';
ALTER ROLE travelos_portal_api SET statement_timeout TO '30s';
ALTER ROLE travelos_portal_api SET idle_in_transaction_session_timeout TO '30s';
ALTER ROLE travelos_worker SET lock_timeout TO '5s';
ALTER ROLE travelos_worker SET statement_timeout TO '60s';
ALTER ROLE travelos_worker SET idle_in_transaction_session_timeout TO '30s';

SELECT format('CREATE DATABASE %I OWNER travelos_owner TEMPLATE template0 ENCODING %L', :'database_name', 'UTF8')
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = :'database_name')
\gexec

ALTER DATABASE :"database_name" OWNER TO travelos_owner;
REVOKE ALL PRIVILEGES ON DATABASE :"database_name" FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE :"database_name" FROM travelos_migrator, travelos_admin_api, travelos_portal_api, travelos_worker;
GRANT CONNECT ON DATABASE :"database_name" TO travelos_migrator, travelos_admin_api, travelos_portal_api, travelos_worker;

ALTER ROLE travelos_migrator IN DATABASE :"database_name" SET search_path TO pg_catalog;
ALTER ROLE travelos_admin_api IN DATABASE :"database_name" SET search_path TO pg_catalog;
ALTER ROLE travelos_portal_api IN DATABASE :"database_name" SET search_path TO pg_catalog;
ALTER ROLE travelos_worker IN DATABASE :"database_name" SET search_path TO pg_catalog;

\connect :"database_name"
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM travelos_migrator, travelos_admin_runtime, travelos_portal_runtime, travelos_worker_runtime;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $travelos_role_topology$
DECLARE
  topology_difference text;
BEGIN
  WITH expected(member, granted_role, admin_option, inherit_option, set_option) AS (
    -- travelos-role-graph-parity:start
    VALUES
      ('travelos_admin_api', 'travelos_admin_runtime', false, true, false),
      ('travelos_migrator', 'travelos_owner', false, false, true),
      ('travelos_portal_api', 'travelos_portal_runtime', false, true, false),
      ('travelos_worker', 'travelos_worker_runtime', false, true, false)
    -- travelos-role-graph-parity:end
  ),
  protected_roles(role_name) AS (
    SELECT member FROM expected
    UNION
    SELECT granted_role FROM expected
  ),
  actual AS (
    SELECT member_role.rolname AS member,
           granted_role.rolname AS granted_role,
           membership.admin_option,
           membership.inherit_option,
           membership.set_option
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
     WHERE member_role.rolname IN (SELECT role_name FROM protected_roles)
        OR granted_role.rolname IN (SELECT role_name FROM protected_roles)
  ),
  differences AS (
    (SELECT 'UNEXPECTED'::text AS difference, actual.* FROM actual
     EXCEPT
     SELECT 'UNEXPECTED'::text AS difference, expected.* FROM expected)
    UNION ALL
    (SELECT 'MISSING'::text AS difference, expected.* FROM expected
     EXCEPT
     SELECT 'MISSING'::text AS difference, actual.* FROM actual)
  )
  SELECT string_agg(
           format(
             '%s %I -> %I [ADMIN %s, INHERIT %s, SET %s]',
             difference, member, granted_role, admin_option, inherit_option, set_option
           ),
           ', ' ORDER BY difference, member, granted_role
         )
    INTO topology_difference
    FROM differences;

  IF topology_difference IS NOT NULL THEN
    RAISE EXCEPTION 'TravelOS role membership graph mismatch: %', topology_difference;
  END IF;
END
$travelos_role_topology$;
