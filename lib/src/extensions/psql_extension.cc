#include "duckdb/web/extensions/psql_extension.h"

#include "psql_extension.hpp"

extern "C" void duckdb_web_psql_init(duckdb::DuckDB* db) { db->LoadStaticExtension<duckdb::PsqlExtension>(); }
