@echo off
SET PGPASSWORD=password
SET PSQL=C:\Program Files\PostgreSQL\17\bin\psql.exe

echo === Recreating Database job_scheduler ===
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='job_scheduler' AND pid<>pg_backend_pid();" > nul 2>&1
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d postgres -c "DROP DATABASE IF EXISTS job_scheduler;"
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d postgres -c "CREATE DATABASE job_scheduler;"

echo.
echo === Applying Migration 002 (Complete Schema) ===
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d job_scheduler -v ON_ERROR_STOP=1 -f "database\migrations\002_complete_schema.sql"

echo.
echo === Applying Seed 001 (Dev Seed Data) ===
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d job_scheduler -v ON_ERROR_STOP=1 -f "database\seeds\001_dev_seed.sql"

echo.
echo === Database Reset Complete ===
