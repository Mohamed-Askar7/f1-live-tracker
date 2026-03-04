// backend/api/session.js — GET /api/session
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { syncData } = require("./_sync");
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
        const pool = getPool();
        const client = await pool.connect();
        try {
            await initDatabase(client);
        } finally {
            client.release();
        }

        await syncData();

        const result = await pool.query(
            `SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 1`
        );
        res.status(200).json(result.rows[0] || {});
    } catch (err) {
        console.error("❌ /api/session error:", err.message);
        res.status(500).json({ error: "Failed to fetch session" });
    }
};
