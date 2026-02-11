################################################################################
# DuckDB-Wasm extension base config
################################################################################
#

duckdb_extension_load(json)
duckdb_extension_load(parquet)
duckdb_extension_load(autocomplete)
duckdb_extension_load(psql)

duckdb_extension_load(icu DONT_LINK)
duckdb_extension_load(tpcds DONT_LINK)
duckdb_extension_load(tpch DONT_LINK)

#duckdb_extension_load(httpfs DONT_LINK)
