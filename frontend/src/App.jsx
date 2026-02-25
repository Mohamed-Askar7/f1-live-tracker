// ============================================================
//  F1 Live Tracker — React Frontend
//  Auto-refreshes every 5 seconds from the Express backend.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";
const REFRESH_INTERVAL = 5; // seconds

function normalizeCompound(compound) {
    const c = String(compound || "").trim().toUpperCase();
    if (!c) return { label: "Unknown", short: "—", className: "tyre-unknown" };
    if (c === "SOFT" || c === "S") return { label: "Soft", short: "S", className: "tyre-soft" };
    if (c === "MEDIUM" || c === "M") return { label: "Medium", short: "M", className: "tyre-medium" };
    if (c === "HARD" || c === "H") return { label: "Hard", short: "H", className: "tyre-hard" };
    if (c === "INTERMEDIATE" || c === "INTER" || c === "I")
        return { label: "Intermediate", short: "I", className: "tyre-intermediate" };
    if (c === "WET" || c === "W") return { label: "Wet", short: "W", className: "tyre-wet" };
    return { label: c.charAt(0) + c.slice(1).toLowerCase(), short: c.slice(0, 1), className: "tyre-unknown" };
}

function formatTyreAge(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.floor(n));
}

function formatRaceDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (!Number.isFinite(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function App() {
    // ── State ────────────────────────────────────────────────
    const [drivers, setDrivers] = useState([]);
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
    const [lastUpdated, setLastUpdated] = useState(null);
    const countdownRef = useRef(null);
    const [nextRace, setNextRace] = useState(null);

    // ── Fetch Data ───────────────────────────────────────────
    const fetchData = useCallback(async () => {
        try {
            const [posRes, sesRes] = await Promise.all([
                fetch(`${API_BASE}/positions`),
                fetch(`${API_BASE}/session`),
            ]);

            if (!posRes.ok) throw new Error(`Positions API error: ${posRes.status}`);

            const posData = await posRes.json();
            const sesData = await sesRes.json();

            setDrivers(posData);
            setSession(sesData);
            setError(null);
            setLastUpdated(new Date());
            setLoading(false);
            setCountdown(REFRESH_INTERVAL);
        } catch (err) {
            console.error("Fetch error:", err);
            setError(err.message);
            setLoading(false);
        }
    }, []);

    const fetchSchedule = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/schedule`);
            if (!res.ok) throw new Error(`Schedule API error: ${res.status}`);
            const data = await res.json();
            setNextRace(Array.isArray(data) && data.length > 0 ? data[0] : null);
        } catch (err) {
            console.warn("Schedule fetch error:", err);
            setNextRace(null);
        }
    }, []);

    // ── Polling ──────────────────────────────────────────────
    useEffect(() => {
        fetchData(); // initial fetch
        const interval = setInterval(fetchData, REFRESH_INTERVAL * 1000);
        return () => clearInterval(interval);
    }, [fetchData]);

    useEffect(() => {
        fetchSchedule();
        const interval = setInterval(fetchSchedule, 10 * 60 * 1000); // keep it fresh without being noisy
        return () => clearInterval(interval);
    }, [fetchSchedule]);

    // ── Countdown Timer ──────────────────────────────────────
    useEffect(() => {
        countdownRef.current = setInterval(() => {
            setCountdown((prev) => (prev <= 1 ? REFRESH_INTERVAL : prev - 1));
        }, 1000);
        return () => clearInterval(countdownRef.current);
    }, []);

    // ── Position Badge ───────────────────────────────────────
    const positionBadgeClass = (pos) => {
        if (pos === 1) return "position-badge position-badge--p1";
        if (pos === 2) return "position-badge position-badge--p2";
        if (pos === 3) return "position-badge position-badge--p3";
        return "position-badge position-badge--default";
    };

    // ── Session Description ──────────────────────────────────
    const sessionLabel = session
        ? `${session.country_name || ""} — ${session.session_name || session.session_type || "Session"}${session.circuit_short_name ? ` • ${session.circuit_short_name}` : ""}`
        : "Loading session…";

    // ── Loading State ────────────────────────────────────────
    if (loading) {
        return (
            <div className="app">
                <div className="state-screen">
                    <div className="state-screen__icon">🏎️</div>
                    <div className="state-screen__title">Connecting to Track…</div>
                    <div className="state-screen__sub">
                        Fetching live timing data from OpenF1 API
                    </div>
                </div>
            </div>
        );
    }

    // ── Error State ──────────────────────────────────────────
    if (error && drivers.length === 0) {
        return (
            <div className="app">
                <div className="state-screen">
                    <div className="state-screen__icon state-screen__icon--static">⚠️</div>
                    <div className="state-screen__title">Connection Lost</div>
                    <div className="state-screen__sub">
                        Could not reach the backend server. Make sure it is running on port 5000.
                    </div>
                    <button className="state-screen__retry" onClick={fetchData}>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    // ── Main View ────────────────────────────────────────────
    return (
        <div className="app">
            {/* Next Race Banner */}
            {nextRace && (
                <section className="next-race-banner" aria-label="Next race">
                    <div className="next-race-banner__left">
                        <div className="next-race-banner__kicker">Next Race</div>
                        <div className="next-race-banner__title">
                            {nextRace.flag ? <span className="next-race-banner__flag">{nextRace.flag}</span> : null}
                            {nextRace.name}
                        </div>
                    </div>
                    <div className="next-race-banner__right">
                        <div className="next-race-banner__meta">
                            <span className="next-race-banner__label">Date</span>
                            <span className="next-race-banner__value">{formatRaceDate(nextRace.date_end || nextRace.date_start || nextRace.date)}</span>
                        </div>
                        <div className="next-race-banner__meta">
                            <span className="next-race-banner__label">Circuit</span>
                            <span className="next-race-banner__value">{nextRace.circuit || "—"}</span>
                        </div>
                    </div>
                </section>
            )}

            {/* Header */}
            <header className="header">
                <div className="header__logo">
                    <span className="header__flag">🏁</span>
                    <h1 className="header__title">F1 LIVE TRACKER</h1>
                </div>
                <p className="header__session">{sessionLabel}</p>
            </header>

            {/* Status Bar */}
            <div className="status-bar">
                <div className="status-bar__live">
                    <span className="pulse" />
                    LIVE
                </div>
                <div className="status-bar__timer">
                    {lastUpdated && (
                        <span>
                            Updated {lastUpdated.toLocaleTimeString()} • Next in {countdown}s
                        </span>
                    )}
                </div>
            </div>

            {/* Telemetry Cards (leader) */}
            {drivers.length > 0 && (() => {
                const leader = drivers[0];
                const leaderTyre = normalizeCompound(leader.tyre_compound);
                const leaderTyreAge = formatTyreAge(leader.tyre_age);
                const fuelKg = Number(leader.fuel_remaining_kg);
                const fuelPct = Number(leader.fuel_percentage);
                const stintNo = leader.stint_number ?? "—";
                const stintLaps = Number(leader.current_stint_laps);
                return (
                    <section className="telemetry-panel" aria-label="Telemetry">
                        <div className="telemetry-card">
                            <div className="telemetry-card__label">Fuel remaining</div>
                            <div className="telemetry-card__value">
                                {Number.isFinite(fuelKg) ? `${fuelKg.toFixed(1)} kg` : "—"}
                                {Number.isFinite(fuelPct) ? <span className="telemetry-card__sub">{fuelPct}%</span> : null}
                            </div>
                        </div>

                        <div className="telemetry-card">
                            <div className="telemetry-card__label">Current stint</div>
                            <div className="telemetry-card__value">
                                {stintNo}
                                {Number.isFinite(stintLaps) ? <span className="telemetry-card__sub">{stintLaps} laps</span> : null}
                            </div>
                        </div>

                        <div className="telemetry-card">
                            <div className="telemetry-card__label">Tyre age</div>
                            <div className="telemetry-card__value telemetry-card__value--tyre">
                                <span className={`tyre-badge ${leaderTyre.className}`} title={leaderTyre.label}>
                                    {leaderTyre.short}
                                </span>
                                <span className="telemetry-tyre-text">
                                    {leaderTyreAge === null || leaderTyre.label === "Unknown"
                                        ? "—"
                                        : `${leaderTyre.label} – ${leaderTyreAge} laps`}
                                </span>
                            </div>
                        </div>
                    </section>
                );
            })()}

            {/* Standings Table */}
            {drivers.length === 0 ? (
                <div className="state-screen">
                    <div className="state-screen__icon state-screen__icon--static">📡</div>
                    <div className="state-screen__title">No Data Yet</div>
                    <div className="state-screen__sub">
                        Waiting for live timing data. Data appears when a session is active.
                    </div>
                </div>
            ) : (
                <table className="standings-table">
                    <thead>
                        <tr>
                            <th>POS</th>
                            <th>DRIVER</th>
                            <th>TEAM</th>
                            <th>TYRE</th>
                            <th>LAP</th>
                        </tr>
                    </thead>
                    <tbody>
                        {drivers.map((d, i) => {
                            const teamColor = d.team_colour ? `#${d.team_colour}` : "#e10600";
                            const tyre = normalizeCompound(d.tyre_compound);
                            const tyreAge = formatTyreAge(d.tyre_age);
                            return (
                                <tr
                                    key={d.driver_number}
                                    className="driver-row"
                                    style={{
                                        "--team-color": teamColor,
                                        animationDelay: `${i * 0.03}s`,
                                    }}
                                >
                                    {/* Position */}
                                    <td data-label="Position">
                                        <span className={positionBadgeClass(d.position)}>
                                            {d.position}
                                        </span>
                                    </td>

                                    {/* Driver Name */}
                                    <td data-label="Driver">
                                        <div className="driver-info">
                                            <img
                                                className="driver-info__avatar"
                                                src={d.headshot_url || ""}
                                                alt={d.driver_name}
                                                onError={(e) => {
                                                    e.target.style.display = "none";
                                                }}
                                            />
                                            <div>
                                                <div className="driver-info__name">
                                                    {d.driver_name || d.broadcast_name}
                                                </div>
                                                <div className="driver-info__code">
                                                    #{d.driver_number} · {d.driver_code}
                                                </div>
                                            </div>
                                        </div>
                                    </td>

                                    {/* Team */}
                                    <td data-label="Team">
                                        <div className="team-name">
                                            <span
                                                className="team-dot"
                                                style={{ background: teamColor }}
                                            />
                                            {d.team_name}
                                        </div>
                                    </td>

                                    {/* Tyre */}
                                    <td data-label="Tyre">
                                        <div className="tyre-cell">
                                            <span className={`tyre-badge ${tyre.className}`} title={tyre.label}>
                                                {tyre.short}
                                            </span>
                                            <span className="tyre-text">
                                                {tyreAge === null || tyre.label === "Unknown"
                                                    ? "—"
                                                    : `${tyre.label} – ${tyreAge} laps old`}
                                            </span>
                                        </div>
                                    </td>

                                    {/* Lap */}
                                    <td data-label="Lap">
                                        <span className="lap-number">{d.lap_number || "—"}</span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}

            {/* Footer */}
            <footer className="footer">
                Powered by{" "}
                <a href="https://openf1.org" target="_blank" rel="noreferrer">
                    OpenF1 API
                </a>{" "}
                • Data refreshes every {REFRESH_INTERVAL}s
            </footer>
        </div>
    );
}

export default App;
