# 🏎️ F1 Live Driver Position Tracker

Real-time Formula 1 position tracking website powered by the **OpenF1 API**.

![Stack](https://img.shields.io/badge/Node.js-Express-green) ![Stack](https://img.shields.io/badge/React-Vite-blue) ![Stack](https://img.shields.io/badge/PostgreSQL-15-blue)

---

## 📐 Architecture

```
OpenF1 API  ──(polled every 5s)──►  Node.js/Express Backend
                                         │
                                    PostgreSQL DB
                                         │
                                    REST API  /api/positions
                                         │
                                    React Frontend  (auto-refreshes every 5s)
```

**Data flow:**
1. Backend polls 4 OpenF1 endpoints (`/sessions`, `/drivers`, `/position`, `/laps`) every 5 seconds.
2. Data is upserted into PostgreSQL tables (`sessions`, `drivers`, `positions`, `laps`).
3. Frontend calls `GET /api/positions` every 5 seconds, which joins all tables and returns a sorted driver list.
4. UI displays: **Position • Driver Name • Team • Lap Number**, with team-colour accents and driver headshots.

---

## ✅ Prerequisites

Make sure the following are installed on your Windows machine:

| Tool | Download |
|------|----------|
| **Node.js** (v18+) | https://nodejs.org |
| **PostgreSQL** (v14+) | https://www.postgresql.org/download/windows/ |
| **VS Code** | https://code.visualstudio.com |

> After installing PostgreSQL, remember the **password** you set for the `postgres` user.

---

## 🗄️ Step 1 — Set Up the Database

1. Open **pgAdmin** or a terminal (`psql`).
2. Create the database:

```sql
CREATE DATABASE f1_live_tracker;
```

That's it! The backend auto-creates the tables on first run.

> (Optional) You can also run `backend/db/init.sql` manually if you prefer.

---

## ⚙️ Step 2 — Configure the Backend

1. Open `backend/.env` in VS Code.
2. Update these values to match your PostgreSQL setup:

```env
DB_USER=postgres
DB_PASSWORD=your_password_here   ← change this!
DB_HOST=localhost
DB_PORT=5432
DB_NAME=f1_live_tracker
```

---

## 🚀 Step 3 — Run the Backend

Open a **terminal** in VS Code (`Ctrl + ~`):

```bash
cd backend
npm install
npm start
```

You should see:
```
✅ Database tables ready
🔄 Fetching initial data from OpenF1...
🏎️  Data synced — 22 drivers, 22 lap records
⏱️  Polling OpenF1 every 5s
🏁 F1 Live Tracker backend running at http://localhost:5000
```

Test it: open http://localhost:5000/api/positions in your browser — you should see JSON data.

---

## 🎨 Step 4 — Run the Frontend

Open a **second terminal** in VS Code:

```bash
cd frontend
npm install
npm run dev
```

You should see:
```
  VITE v6.x.x  ready in Xms

  ➜  Local:   http://localhost:5173/
```

Open **http://localhost:5173** in your browser. 🎉

---

## 📦 NPM Packages Used

### Backend
| Package | Purpose |
|---------|---------|
| `express` | Web server & REST API |
| `pg` | PostgreSQL client |
| `axios` | HTTP client to call OpenF1 API |
| `cors` | Enable cross-origin requests from React |
| `dotenv` | Load `.env` config file |

### Frontend
| Package | Purpose |
|---------|---------|
| `react` | UI library |
| `react-dom` | React DOM renderer |
| `vite` | Dev server & bundler |

---

## 📁 Project Structure

```
f1-live-tracker/
├── backend/
│   ├── server.js          # Express server — polling, DB, REST API
│   ├── package.json       # Backend dependencies
│   ├── .env               # PostgreSQL connection config
│   └── db/
│       └── init.sql       # Database schema (auto-runs on startup)
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # Main React component
│   │   ├── App.css        # Component styles (F1 theme)
│   │   └── index.css      # Global design tokens
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── README.md              # ← You are here
```

---

## ❓ Troubleshooting

| Problem | Solution |
|---------|----------|
| `ECONNREFUSED` on port 5432 | Make sure PostgreSQL is running |
| Backend shows `password authentication failed` | Update `DB_PASSWORD` in `backend/.env` |
| Frontend shows "Connection Lost" | Make sure the backend is running on port 5000 |
| No data showing | OpenF1 data is available during/after race weekends. Between race weekends the latest test/practice data is shown. |

---

## 📄 License

MIT — Built with ❤️ using [OpenF1 API](https://openf1.org)
