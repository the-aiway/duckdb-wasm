#ifndef INCLUDE_DUCKDB_WEB_EXTENSIONS_PSQL_EXTENSION_H_
#define INCLUDE_DUCKDB_WEB_EXTENSIONS_PSQL_EXTENSION_H_

#include "duckdb/main/database.hpp"

extern "C" void duckdb_web_psql_init(duckdb::DuckDB* db);

#endif
