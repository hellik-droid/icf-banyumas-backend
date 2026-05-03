require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "secret-key";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const RACE_ROUTE = [
  [-7.4564651, 109.2621908],
  [-7.4563547, 109.2626408],
  [-7.4554416, 109.262382],
  [-7.4553538, 109.261572],
  [-7.4564828, 109.2614795],
  [-7.456474, 109.2622385],
];

const ROUTE_DISTANCE_KM = 1;

const CHECKPOINTS = [
  { name: "START", km: 0 },
  { name: "CP 1", km: 0.25 },
  { name: "CP 2", km: 0.5 },
  { name: "CP 3", km: 0.75 },
  { name: "FINISH", km: 1 },
];

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS athletes (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      athlete_name VARCHAR(100) NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracking_logs (
      id SERIAL PRIMARY KEY,
      athlete_id INTEGER,
      athlete_name VARCHAR(100),
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      speed DOUBLE PRECISION,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("DB READY");
}

function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ success: false, message: "No token" });
  }

  try {
    const token = header.split(" ")[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getProgressByRoute(latitude, longitude) {
  let nearestIndex = 0;
  let minDistance = Infinity;

  RACE_ROUTE.forEach((point, index) => {
    const d = distanceKm(latitude, longitude, point[0], point[1]);

    if (d < minDistance) {
      minDistance = d;
      nearestIndex = index;
    }
  });

  return nearestIndex / (RACE_ROUTE.length - 1);
}

function getNextCheckpoint(progress) {
  return (
    CHECKPOINTS.find((cp) => cp.km > progress) ||
    CHECKPOINTS[CHECKPOINTS.length - 1]
  );
}

app.get("/", (req, res) => {
  res.send("Backend ICF Banyumas Running 🚀");
});

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);
});

app.post("/athletes", async (req, res) => {
  try {
    const { username, password, athleteName } = req.body;

    if (!username || !password || !athleteName) {
      return res.status(400).json({
        success: false,
        message: "username, password, athleteName wajib diisi",
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO athletes (username, password, athlete_name)
       VALUES ($1, $2, $3)
       RETURNING id, username, athlete_name`,
      [username, hash, athleteName]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM athletes WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Username atau password salah",
      });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Username atau password salah",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        name: user.athlete_name,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      athlete: {
        id: user.id,
        athleteName: user.athlete_name,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/tracking", auth, async (req, res) => {
  try {
    const { latitude, longitude, speed } = req.body;

    const result = await pool.query(
      `INSERT INTO tracking_logs 
       (athlete_id, athlete_name, latitude, longitude, speed)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.id, req.user.name, latitude, longitude, speed || 0]
    );

    io.emit("location-update", result.rows[0]);

    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/tracking", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM tracking_logs ORDER BY timestamp DESC LIMIT 500"
    );

    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/pro/checkpoints", (req, res) => {
  res.json({
    success: true,
    route: RACE_ROUTE,
    distanceKm: ROUTE_DISTANCE_KM,
    checkpoints: CHECKPOINTS,
  });
});

app.get("/pro/leaderboard", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (athlete_name)
        athlete_id,
        athlete_name,
        latitude,
        longitude,
        speed,
        timestamp
      FROM tracking_logs
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY athlete_name, timestamp DESC
    `);

    const leaderboard = result.rows
      .map((item) => {
        const progress = getProgressByRoute(
          Number(item.latitude),
          Number(item.longitude)
        );

        const distance = progress * ROUTE_DISTANCE_KM;
        const speed = Number(item.speed || 0);
        const remainingKm = Math.max(ROUTE_DISTANCE_KM - distance, 0);
        const eta = speed > 0 ? (remainingKm / speed) * 60 : 0;
        const nextCheckpoint = getNextCheckpoint(progress);

        return {
          athlete_id: item.athlete_id,
          athlete_name: item.athlete_name,
          latitude: item.latitude,
          longitude: item.longitude,
          speed_kmh: speed,
          pace_min_km: speed > 0 ? 60 / speed : 0,
          progress_percent: Number((progress * 100).toFixed(1)),
          distance_km: Number(distance.toFixed(2)),
          next_checkpoint: nextCheckpoint.name,
          eta_minutes: Number(eta.toFixed(1)),
          status:
            progress >= 1 ? "FINISHED" : speed > 1 ? "MOVING" : "STOPPED",
          timestamp: item.timestamp,
        };
      })
      .sort((a, b) => b.progress_percent - a.progress_percent);

    res.json({
      success: true,
      routeDistanceKm: ROUTE_DISTANCE_KM,
      data: leaderboard,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/pro/finishers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (athlete_name)
        athlete_id,
        athlete_name,
        latitude,
        longitude,
        speed,
        timestamp
      FROM tracking_logs
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY athlete_name, timestamp DESC
    `);

    const finishers = result.rows
      .map((item) => {
        const progress = getProgressByRoute(
          Number(item.latitude),
          Number(item.longitude)
        );

        return {
          athlete_id: item.athlete_id,
          athlete_name: item.athlete_name,
          progress_percent: Number((progress * 100).toFixed(1)),
          finished: progress >= 1,
          finish_time: progress >= 1 ? item.timestamp : null,
        };
      })
      .filter((item) => item.finished);

    res.json({
      success: true,
      totalFinishers: finishers.length,
      data: finishers,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

initDB().then(() => {
  server.listen(PORT, () => {
    console.log("RUNNING ON", PORT);
  });
});