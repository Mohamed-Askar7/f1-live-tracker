-- ============================================================
-- F1 Live Tracker — Database Schema
-- Run this ONCE in your PostgreSQL to set up the database.
-- ============================================================

-- 1. Create the database (run from psql as superuser)
-- CREATE DATABASE f1_live_tracker;

-- 2. Connect to the database, then run the rest:

CREATE TABLE IF NOT EXISTS drivers (
    driver_number   INTEGER PRIMARY KEY,
    broadcast_name  VARCHAR(100),
    full_name       VARCHAR(200),
    name_acronym    VARCHAR(10),
    team_name       VARCHAR(100),
    team_colour     VARCHAR(10),
    headshot_url    TEXT,
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS positions (
    driver_number   INTEGER PRIMARY KEY,
    position        INTEGER NOT NULL,
    session_key     INTEGER,
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS laps (
    driver_number   INTEGER PRIMARY KEY,
    lap_number      INTEGER NOT NULL DEFAULT 0,
    lap_duration    NUMERIC(10,3),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    session_key     INTEGER PRIMARY KEY,
    session_name    VARCHAR(100),
    session_type    VARCHAR(50),
    circuit_short_name VARCHAR(50),
    country_name    VARCHAR(100),
    date_start      TIMESTAMP,
    date_end        TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT NOW()
);
