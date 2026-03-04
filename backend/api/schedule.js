// backend/api/schedule.js — GET /api/schedule
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const axios = require("axios");

const OPENF1 = process.env.OPENF1_BASE_URL || "https://api.openf1.org/v1";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";

// Module-level cache (keeps data warm for 6 hours on the same lambda instance)
let cachedSchedule = [];
let lastScheduleFetchAt = 0;

function setCors(req, res) {
    const origin = req.headers.origin;
    if (!origin || FRONTEND_ORIGIN === "*" || origin === FRONTEND_ORIGIN) {
        res.setHeader("Access-Control-Allow-Origin", origin || "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
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

async function fetchJSON(url) {
    try {
        const { data } = await axios.get(url, { timeout: 15000 });
        return data;
    } catch (err) {
        if (err?.response?.status !== 404) console.error(`⚠️  Failed to fetch ${url}:`, err.message);
        return [];
    }
}

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    try {
        const nowMs = Date.now();
        if (cachedSchedule.length > 0 && nowMs - lastScheduleFetchAt < 6 * 60 * 60 * 1000) {
            return res.status(200).json(cachedSchedule);
        }

        const now = new Date();
        const currentYear = now.getUTCFullYear();

        const [meetingsThisYear, meetingsNextYear] = await Promise.all([
            fetchJSON(`${OPENF1}/meetings?year=${currentYear}`),
            fetchJSON(`${OPENF1}/meetings?year=${currentYear + 1}`),
        ]);
        const meetings = [...meetingsThisYear, ...meetingsNextYear];

        const fromOpenF1 = meetings
            .filter((m) => /grand prix/i.test(String(m.meeting_official_name || m.meeting_name || "")))
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
            cachedSchedule = upcoming.length > 0 ? upcoming : fromOpenF1;
            lastScheduleFetchAt = nowMs;
            return res.status(200).json(cachedSchedule);
        }

        // Fallback static schedule
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
        cachedSchedule = upcoming;
        lastScheduleFetchAt = nowMs;
        res.status(200).json(cachedSchedule);
    } catch (err) {
        console.error("❌ /api/schedule error:", err.message);
        res.status(500).json({ error: "Failed to fetch schedule" });
    }
};
