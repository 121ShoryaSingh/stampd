#!/bin/sh
# Production twin of init.sql: roles and database, with passwords from the environment.
# Runs once, when the Postgres data volume is first created.
set -eu
: "${APP_DB_PASSWORD:?set APP_DB_PASSWORD}"
: "${MIGRATOR_DB_PASSWORD:?set MIGRATOR_DB_PASSWORD}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v app_pw="$APP_DB_PASSWORD" -v migrator_pw="$MIGRATOR_DB_PASSWORD" <<'SQL'
create role stampd_migrator login password :'migrator_pw' bypassrls createdb;
create role stampd_app login password :'app_pw';
create database stampd owner stampd_migrator;
SQL
