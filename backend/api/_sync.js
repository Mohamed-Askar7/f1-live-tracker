// backend/api/_sync.js
// Fetches data from OpenF1 and upserts into PostgreSQL.
// Called by each serverless route handler to keep data fresh.
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const axios = require("axios");
const { getPool, initDatabase } = require("./_db");

const OPENF1 = process.env.OPENF1_BASE_URL || "https://api.openf1.org/v1";

// Module-level cache: avoid hammering OpenF1 if two requests arrive close together.
let lastSyncAt = 0;
const SYNC_COOLDOWN_MS = 25000; // 25 seconds

async function fetchJSON(url) {
    try {
        const { data } = await axios.get(url, { timeout: 15000 });
        return data;
    } catch (err) {
        const status = err?.response?.status;
        if (status !== 404) {
            console.error(`⚠️  Failed to fetch ${url}:`, err.message);
        }
        return [];
    }
}

function simulateCompoundFallback(driverNumber) {
    const dn = Number(driverNumber) || 0;
    const compounds = ["SOFT", "MEDIUM", "HARD"];
    return compounds[dn % compounds.length];
}

async function syncData() {
    const now = Date.now();

    // Skip if we synced recently (module stays warm between requests on Vercel)
    if (now - lastSyncAt < SYNC_COOLDOWN_MS) return;
    lastSyncAt = now;

    const pool = getPool();
    const client = await pool.connect();
    try {
        // Ensure tables exist
        await initDatabase(client);

        // 1) Sessions
        const sessions = await fetchJSON(`${OPENF1}/sessions?session_key=latest`);
        let latestSessionType = "";
        if (sessions.length > 0) {
            const s = sessions[0];
            latestSessionType = String(s.session_type || s.session_name || "").toLowerCase();
            await client.query(
                `INSERT INTO sessions (session_key, session_name, session_type, circuit_short_name, country_name, date_start, date_end, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (session_key) DO UPDATE SET
           session_name=$2, session_type=$3, circuit_short_name=$4,
           country_name=$5, date_start=$6, date_end=$7, updated_at=NOW()`,
                [s.session_key, s.session_name, s.session_type, s.circuit_short_name, s.country_name, s.date_start, s.date_end]
            );
        }

        // 2) Drivers
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

        // 3) Positions
        const positions = await fetchJSON(`${OPENF1}/position?session_key=latest`);
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

        // 4) Laps (latest + best)
        const laps = await fetchJSON(`${OPENF1}/laps?session_key=latest`);
        const latestLap = new Map();
        const bestLap = new Map();
        for (const l of laps) {
            const existing = latestLap.get(l.driver_number);
            if (!existing || l.lap_number > existing.lap_number) {
                latestLap.set(l.driver_number, l);
            }
            if (l.lap_duration && Number.isFinite(Number(l.lap_duration))) {
                const lapTime = Number(l.lap_duration);
                if (lapTime > 0 && !l.is_pit_out_lap) {
                    const currentBest = bestLap.get(l.driver_number);
                    if (!currentBest || lapTime < currentBest.lap_duration) {
                        bestLap.set(l.driver_number, { lap_duration: lapTime, lap_number: l.lap_number });
                    }
                }
            }
        }
        for (const [driverNum, l] of latestLap) {
            const best = bestLap.get(driverNum) || null;
            await client.query(
                `INSERT INTO laps (driver_number, lap_number, lap_duration, best_lap_number, best_lap_duration, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (driver_number) DO UPDATE SET
           lap_number=$2, lap_duration=$3, best_lap_number=$4, best_lap_duration=$5, updated_at=NOW()`,
                [driverNum, l.lap_number, l.lap_duration, best?.lap_number ?? null, best?.lap_duration ?? null]
            );
        }

        // 5) Stints (tyres)
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

        // 6) Championship (race sessions only)
        if (latestSessionType.includes("race")) {
            const championship = await fetchJSON(`${OPENF1}/championship_drivers?session_key=latest`);
            for (const row of championship) {
                await client.query(
                    `INSERT INTO championship_drivers (driver_number, points_current, points_start, position_current, position_start, updated_at)
           VALUES ($1,$2,$3,$4,$5,NOW())
           ON CONFLICT (driver_number) DO UPDATE SET
             points_current=$2, points_start=$3, position_current=$4, position_start=$5, updated_at=NOW()`,
                    [row.driver_number, row.points_current, row.points_start, row.position_current, row.position_start]
                );
            }
        }
    } catch (err) {
        console.error("❌ Sync error:", err.message);
    } finally {
        client.release();
    }
}

module.exports = { syncData, simulateCompoundFallback };
