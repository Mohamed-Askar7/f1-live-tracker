// ============================================================
//  F1 Live Tracker — Backend Server
//  Polls OpenF1 API every 5 seconds, stores in PostgreSQL,
//  and serves a REST API for the React frontend.
// ============================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const axios = require("axios");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const { Pool } = require("pg");

// ── Config ───────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const OPENF1 = process.env.OPENF1_BASE_URL || "https://api.openf1.org/v1";
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL, 10) || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

// ── PostgreSQL Pool ──────────────────────────────────────────
const pool =
  process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      })
    : new Pool({
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "postgres",
        host: process.env.DB_HOST || "localhost",
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        database: process.env.DB_NAME || "f1_live_tracker",
      });

// ── Express App ──────────────────────────────────────────────
const app = express();

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin === FRONTEND_ORIGIN) return callback(null, true);
      return callback(new Error("CORS not allowed from this origin"));
    },
    methods: ["GET"],
    allowedHeaders: ["Content-Type", "Accept"],
  })
);

if (NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

app.use(express.json());

// ── Auto-create Tables on Startup ────────────────────────────
async function initDatabase() {
  const client = await pool.connect();
  try {
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
    `);
    console.log("✅ Database tables ready");
  } catch (err) {
    console.error("❌ Database init error:", err.message);
  } finally {
    client.release();
  }
}

// ── Helpers: Fetch from OpenF1 ───────────────────────────────
async function fetchJSON(url) {
  try {
    const { data } = await axios.get(url, { timeout: 10000 });
    return data;
  } catch (err) {
    console.error(`⚠️  Failed to fetch ${url}:`, err.message);
    return [];
  }
}

function flagFromCountryCode(countryCode) {
  const cc = String(countryCode || "").trim().toUpperCase();
  if (cc.length !== 2) return "";
  const A = 65;
  const OFFSET = 127397;
  const first = cc.charCodeAt(0);
  const second = cc.charCodeAt(1);
  if (first < A || first > 90 || second < A || second > 90) return "";
  return String.fromCodePoint(OFFSET + first, OFFSET + second);
}

function simulateTyreFallback({ driverNumber, lapNumber }) {
  const lap = Math.max(0, Number(lapNumber) || 0);
  const dn = Number(driverNumber) || 0;

  // Deterministic, “reasonable” stint lengths and compound rotation.
  const stintLength = 14 + (dn % 11); // 14..24
  const stintNumber = Math.floor(lap / stintLength) + 1;
  const tyreAge = lap % stintLength;
  const compounds = ["SOFT", "MEDIUM", "HARD"];
  const compound = compounds[(stintNumber - 1) % compounds.length];

  return { compound, tyreAge, stintNumber };
}

function estimateFuel({ driverNumber, lapNumber }) {
  const lap = Math.max(0, Number(lapNumber) || 0);
  const dn = Number(driverNumber) || 0;
  const startingFuelKg = 110;
  const basePerLap = 1.55;
  const driverAdj = ((dn % 7) - 3) * 0.02; // small deterministic variation
  const fuelPerLap = basePerLap + driverAdj;
  const remaining = Math.max(0, startingFuelKg - lap * fuelPerLap);
  const percentage = (remaining / startingFuelKg) * 100;
  return {
    fuel_remaining_kg: Math.round(remaining * 10) / 10,
    fuel_percentage: Math.round(percentage),
  };
}

// ── Core: Poll OpenF1 & Store in DB ──────────────────────────
async function fetchAndStoreData() {
  const client = await pool.connect();
  try {
    // 1) Fetch session info
    const sessions = await fetchJSON(`${OPENF1}/sessions?session_key=latest`);
    if (sessions.length > 0) {
      const s = sessions[0];
      await client.query(
        `INSERT INTO sessions (session_key, session_name, session_type, circuit_short_name, country_name, date_start, date_end, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (session_key) DO UPDATE SET
           session_name=$2, session_type=$3, circuit_short_name=$4,
           country_name=$5, date_start=$6, date_end=$7, updated_at=NOW()`,
        [s.session_key, s.session_name, s.session_type, s.circuit_short_name, s.country_name, s.date_start, s.date_end]
      );
    }

    // 2) Fetch drivers
    const drivers = await fetchJSON(`${OPENF1}/drivers?session_key=latest`);
    for (const d of drivers) {
      await client.query(
        `INSERT INTO drivers (driver_number, broadcast_name, full_name, name_acronym, team_name, team_colour, headshot_url, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (driver_number) DO UPDATE SET
           broadcast_name=$2, full_name=$3, name_acronym=$4,
           team_name=$5, team_colour=$6, headshot_url=$7, updated_at=NOW()`,
        [d.driver_number, d.broadcast_name, d.full_name, d.name_acronym, d.team_name, d.team_colour, d.headshot_url]
      );
    }

    // 3) Fetch positions (get latest snapshot for each driver)
    const positions = await fetchJSON(`${OPENF1}/position?session_key=latest`);
    // Keep only the most recent position per driver
    const latestPos = new Map();
    for (const p of positions) {
      const existing = latestPos.get(p.driver_number);
      if (!existing || new Date(p.date) > new Date(existing.date)) {
        latestPos.set(p.driver_number, p);
      }
    }
    for (const [driverNum, p] of latestPos) {
      await client.query(
        `INSERT INTO positions (driver_number, position, session_key, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (driver_number) DO UPDATE SET
           position=$2, session_key=$3, updated_at=NOW()`,
        [driverNum, p.position, p.session_key]
      );
    }

    // 4) Fetch laps (latest lap per driver)
    const laps = await fetchJSON(`${OPENF1}/laps?session_key=latest`);
    const latestLap = new Map();
    for (const l of laps) {
      const existing = latestLap.get(l.driver_number);
      if (!existing || l.lap_number > existing.lap_number) {
        latestLap.set(l.driver_number, l);
      }
    }
    for (const [driverNum, l] of latestLap) {
      await client.query(
        `INSERT INTO laps (driver_number, lap_number, lap_duration, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (driver_number) DO UPDATE SET
           lap_number=$2, lap_duration=$3, updated_at=NOW()`,
        [driverNum, l.lap_number, l.lap_duration]
      );
    }

    // 5) Fetch stints (tyre compound + age data)
    const stints = await fetchJSON(`${OPENF1}/stints?session_key=latest`);
    for (const st of stints) {
      await client.query(
        `INSERT INTO stints (driver_number, stint_number, compound, tyre_age_at_start, lap_start, lap_end, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (driver_number, stint_number) DO UPDATE SET
           compound=$3, tyre_age_at_start=$4, lap_start=$5, lap_end=$6, updated_at=NOW()`,
        [st.driver_number, st.stint_number, st.compound, st.tyre_age_at_start, st.lap_start, st.lap_end]
      );
    }

    if (NODE_ENV !== "production") {
      const timestamp = new Date().toLocaleTimeString();
      console.log(
        `🏎️  [${timestamp}] Data synced — ${latestPos.size} drivers, ${latestLap.size} lap records, ${stints.length} stint records`
      );
    }
  } catch (err) {
    console.error("❌ Sync error:", err.message);
  } finally {
    client.release();
  }
}

// ── REST API Endpoints ───────────────────────────────────────

const rateLimiter = new RateLimiterMemory({
  points: 300,
  duration: 60,
});

async function rateLimitMiddleware(req, res, next) {
  try {
    const key = req.ip || "global";
    await rateLimiter.consume(key);
    return next();
  } catch (rejRes) {
    res.set("Retry-After", String(Math.ceil(rejRes.msBeforeNext / 1000)));
    return res.status(429).json({ error: "Too many requests" });
  }
}

app.use(rateLimitMiddleware);

// GET /api/positions — main endpoint for the frontend (enriched with tyre data)
app.get("/api/positions", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.position,
        d.full_name       AS driver_name,
        d.name_acronym    AS driver_code,
        d.broadcast_name,
        d.team_name,
        d.team_colour,
        d.driver_number,
        d.headshot_url,
        COALESCE(l.lap_number, 0) AS lap_number,
        l.lap_duration,
        s.compound        AS tyre_compound,
        COALESCE(s.tyre_age_at_start, 0) + COALESCE(l.lap_number, 0) - COALESCE(s.lap_start, 0) AS tyre_age,
        s.stint_number,
        s.lap_start       AS stint_lap_start,
        p.updated_at
      FROM positions p
      JOIN drivers d ON d.driver_number = p.driver_number
      LEFT JOIN laps l ON l.driver_number = p.driver_number
      LEFT JOIN LATERAL (
        SELECT st.compound, st.tyre_age_at_start, st.lap_start, st.stint_number
        FROM stints st
        WHERE st.driver_number = p.driver_number
        ORDER BY st.stint_number DESC
        LIMIT 1
      ) s ON true
      ORDER BY p.position ASC
    `);

    const enriched = result.rows.map((row) => {
      const lapNumber = Math.max(0, Number(row.lap_number) || 0);
      const driverNumber = row.driver_number;

      const fuel = estimateFuel({ driverNumber, lapNumber });

      // Clamp/normalize tyre age and provide fallback compound+age when OpenF1 stints aren't available.
      let tyreAge = Number(row.tyre_age);
      if (!Number.isFinite(tyreAge)) tyreAge = null;
      if (tyreAge !== null) tyreAge = Math.max(0, Math.floor(tyreAge));

      let tyreCompound = row.tyre_compound;
      let stintNumber = row.stint_number;
      let currentStintLaps = null;

      if (row.stint_lap_start !== null && row.stint_lap_start !== undefined) {
        const lapStart = Math.max(0, Number(row.stint_lap_start) || 0);
        currentStintLaps = Math.max(0, lapNumber - lapStart + 1);
      }

      if (!tyreCompound) {
        const sim = simulateTyreFallback({ driverNumber, lapNumber });
        tyreCompound = sim.compound;
        tyreAge = sim.tyreAge;
        stintNumber = sim.stintNumber;
        currentStintLaps = tyreAge + 1;
      }

      return {
        ...row,
        tyre_compound: tyreCompound,
        tyre_age: tyreAge,
        stint_number: stintNumber,
        current_stint_laps: currentStintLaps,
        ...fuel,
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("❌ /api/positions error:", err.message);
    res.status(500).json({ error: "Failed to fetch positions" });
  }
});

// GET /api/session — current session info
app.get("/api/session", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 1`
    );
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error("❌ /api/session error:", err.message);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

// GET /api/schedule — upcoming F1 race calendar (auto from OpenF1, fallback to static)
app.get("/api/schedule", async (req, res) => {
  try {
    const now = new Date();
    const currentYear = now.getUTCFullYear();

    const meetingsThisYear = await fetchJSON(`${OPENF1}/meetings?year=${currentYear}`);
    const meetingsNextYear = await fetchJSON(`${OPENF1}/meetings?year=${currentYear + 1}`);
    const meetings = [...meetingsThisYear, ...meetingsNextYear];

    const fromOpenF1 = meetings
      .filter((m) => {
        const name = String(m.meeting_official_name || m.meeting_name || "");
        return /grand prix/i.test(name);
      })
      .map((m, idx) => {
        const dateStart = m.date_start || null;
        const dateEnd = m.date_end || null;
        const dateForCompare = new Date(dateEnd || dateStart || 0);
        const dateForDisplay = (dateEnd || dateStart || "").slice(0, 10);
        return {
          round: m.round_number ?? m.meeting_number ?? idx + 1,
          name: m.meeting_official_name || m.meeting_name || "Grand Prix",
          circuit: m.circuit_short_name || m.circuit_name || m.location || "—",
          country: m.country_name || "",
          flag: flagFromCountryCode(m.country_code),
          date: dateForDisplay,
          date_start: dateStart,
          date_end: dateEnd,
          _dateForCompare: Number.isFinite(dateForCompare.getTime()) ? dateForCompare.getTime() : 0,
        };
      })
      .filter((r) => r._dateForCompare > 0)
      .sort((a, b) => a._dateForCompare - b._dateForCompare)
      .map(({ _dateForCompare, ...rest }) => rest);

    if (fromOpenF1.length > 0) {
      const upcoming = fromOpenF1.filter((r) => new Date(r.date_end || r.date_start || r.date) >= now);
      return res.json(upcoming.length > 0 ? upcoming : fromOpenF1);
    }

    // Fallback: static schedule (legacy)
    const schedule = [
      { round: 1, name: "Australian Grand Prix", circuit: "Albert Park", country: "Australia", flag: "🇦🇺", date: "2025-03-16" },
      { round: 2, name: "Chinese Grand Prix", circuit: "Shanghai", country: "China", flag: "🇨🇳", date: "2025-03-23" },
      { round: 3, name: "Japanese Grand Prix", circuit: "Suzuka", country: "Japan", flag: "🇯🇵", date: "2025-04-06" },
      { round: 4, name: "Bahrain Grand Prix", circuit: "Bahrain Intl.", country: "Bahrain", flag: "🇧🇭", date: "2025-04-13" },
      { round: 5, name: "Saudi Arabian Grand Prix", circuit: "Jeddah", country: "Saudi Arabia", flag: "🇸🇦", date: "2025-04-20" },
      { round: 6, name: "Miami Grand Prix", circuit: "Miami Intl.", country: "United States", flag: "🇺🇸", date: "2025-05-04" },
      { round: 7, name: "Emilia Romagna Grand Prix", circuit: "Imola", country: "Italy", flag: "🇮🇹", date: "2025-05-18" },
      { round: 8, name: "Monaco Grand Prix", circuit: "Monte Carlo", country: "Monaco", flag: "🇲🇨", date: "2025-05-25" },
      { round: 9, name: "Spanish Grand Prix", circuit: "Barcelona", country: "Spain", flag: "🇪🇸", date: "2025-06-01" },
      { round: 10, name: "Canadian Grand Prix", circuit: "Montréal", country: "Canada", flag: "🇨🇦", date: "2025-06-15" },
      { round: 11, name: "Austrian Grand Prix", circuit: "Spielberg", country: "Austria", flag: "🇦🇹", date: "2025-06-29" },
      { round: 12, name: "British Grand Prix", circuit: "Silverstone", country: "United Kingdom", flag: "🇬🇧", date: "2025-07-06" },
      { round: 13, name: "Belgian Grand Prix", circuit: "Spa-Francorchamps", country: "Belgium", flag: "🇧🇪", date: "2025-07-27" },
      { round: 14, name: "Hungarian Grand Prix", circuit: "Budapest", country: "Hungary", flag: "🇭🇺", date: "2025-08-03" },
      { round: 15, name: "Dutch Grand Prix", circuit: "Zandvoort", country: "Netherlands", flag: "🇳🇱", date: "2025-08-31" },
      { round: 16, name: "Italian Grand Prix", circuit: "Monza", country: "Italy", flag: "🇮🇹", date: "2025-09-07" },
      { round: 17, name: "Azerbaijan Grand Prix", circuit: "Baku", country: "Azerbaijan", flag: "🇦🇿", date: "2025-09-21" },
      { round: 18, name: "Singapore Grand Prix", circuit: "Marina Bay", country: "Singapore", flag: "🇸🇬", date: "2025-10-05" },
      { round: 19, name: "United States Grand Prix", circuit: "Austin (COTA)", country: "United States", flag: "🇺🇸", date: "2025-10-19" },
      { round: 20, name: "Mexico City Grand Prix", circuit: "Autodromo H. Rodriguez", country: "Mexico", flag: "🇲🇽", date: "2025-10-26" },
      { round: 21, name: "São Paulo Grand Prix", circuit: "Interlagos", country: "Brazil", flag: "🇧🇷", date: "2025-11-09" },
      { round: 22, name: "Las Vegas Grand Prix", circuit: "Las Vegas Strip", country: "United States", flag: "🇺🇸", date: "2025-11-22" },
      { round: 23, name: "Qatar Grand Prix", circuit: "Lusail", country: "Qatar", flag: "🇶🇦", date: "2025-11-30" },
      { round: 24, name: "Abu Dhabi Grand Prix", circuit: "Yas Marina", country: "UAE", flag: "🇦🇪", date: "2025-12-07" },
    ];

    const upcoming = schedule.filter((r) => new Date(r.date) >= now);
    res.json(upcoming.length > 0 ? upcoming : schedule);
  } catch (err) {
    console.error("❌ /api/schedule error:", err.message);
    res.status(500).json({ error: "Failed to fetch schedule" });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Start Server ─────────────────────────────────────────────
async function start() {
  await initDatabase();

  // Initial data fetch
  console.log("🔄 Fetching initial data from OpenF1...");
  await fetchAndStoreData();

  // Start polling every 5 seconds
  setInterval(fetchAndStoreData, POLL_INTERVAL);
  console.log(`⏱️  Polling OpenF1 every ${POLL_INTERVAL / 1000}s`);

  app.listen(PORT, () => {
    console.log(`\n🏁 F1 Live Tracker backend running at http://localhost:${PORT}`);
    console.log(`   📡 Positions API: http://localhost:${PORT}/api/positions`);
    console.log(`   📋 Session API:   http://localhost:${PORT}/api/session`);
    console.log(`   📅 Schedule API:  http://localhost:${PORT}/api/schedule`);
    console.log(`   ❤️  Health check:  http://localhost:${PORT}/api/health\n`);
  });
}

start();
