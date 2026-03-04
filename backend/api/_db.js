// backend/api/_db.js
// Shared PostgreSQL pool — module-level singleton so it survives warm invocations.
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { Pool } = require("pg");

let pool;

function getPool() {
    if (pool) return pool;

    if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            max: 5, // keep serverless connection count low
        });
    } else {
        pool = new Pool({
            user: process.env.DB_USER || "postgres",
            password: process.env.DB_PASSWORD || "postgres",
            host: process.env.DB_HOST || "localhost",
            port: parseInt(process.env.DB_PORT, 10) || 5432,
            database: process.env.DB_NAME || "f1_live_tracker",
            max: 5,
        });
    }

    return pool;
}

// Auto-create all required tables (idempotent).
async function initDatabase(client) {
    await client.query(`
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
    CREATE TABLE IF NOT EXISTS intervals (
      driver_number   INTEGER PRIMARY KEY,
      gap_to_leader   TEXT,
      interval        TEXT,
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
    CREATE TABLE IF NOT EXISTS stints (
      driver_number     INTEGER NOT NULL,
      stint_number      INTEGER NOT NULL,
      compound          VARCHAR(30),
      tyre_age_at_start INTEGER DEFAULT 0,
      lap_start         INTEGER,
      lap_end           INTEGER,
      updated_at        TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (driver_number, stint_number)
    );
    ALTER TABLE laps
      ADD COLUMN IF NOT EXISTS best_lap_number INTEGER,
      ADD COLUMN IF NOT EXISTS best_lap_duration NUMERIC(10,3);
    CREATE TABLE IF NOT EXISTS championship_drivers (
      driver_number      INTEGER PRIMARY KEY,
      points_current     NUMERIC(10,1),
      points_start       NUMERIC(10,1),
      position_current   INTEGER,
      position_start     INTEGER,
      updated_at         TIMESTAMP DEFAULT NOW()
    );
  `);
}

module.exports = { getPool, initDatabase };
