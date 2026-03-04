// backend/api/positions.js — GET /api/positions
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { syncData, simulateCompoundFallback } = require("./_sync");
const { getPool, initDatabase } = require("./_db");

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";

function setCors(req, res) {
    const origin = req.headers.origin;
    if (!origin || FRONTEND_ORIGIN === "*" || origin === FRONTEND_ORIGIN) {
        res.setHeader("Access-Control-Allow-Origin", origin || "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    try {
        // Ensure tables exist before querying
        const pool = getPool();
        const client = await pool.connect();
        try {
            await initDatabase(client);
        } finally {
            client.release();
        }

        // Sync fresh data from OpenF1 (throttled internally)
        await syncData();

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
        l.lap_duration AS last_lap_duration,
        l.best_lap_duration,
        cd.points_current AS championship_points,
        cd.position_current AS championship_position,
        s.compound        AS tyre_compound,
        p.updated_at
      FROM positions p
      JOIN drivers d ON d.driver_number = p.driver_number
      LEFT JOIN laps l ON l.driver_number = p.driver_number
      LEFT JOIN championship_drivers cd ON cd.driver_number = p.driver_number
      LEFT JOIN LATERAL (
        SELECT st.compound
        FROM stints st
        WHERE st.driver_number = p.driver_number
        ORDER BY st.stint_number DESC
        LIMIT 1
      ) s ON true
      ORDER BY p.position ASC
    `);

        const enriched = result.rows.map((row) => ({
            ...row,
            tyre_compound: row.tyre_compound || simulateCompoundFallback(row.driver_number),
        }));

        res.status(200).json(enriched);
    } catch (err) {
        console.error("❌ /api/positions error:", err.message);
        res.status(500).json({ error: "Failed to fetch positions" });
    }
};
