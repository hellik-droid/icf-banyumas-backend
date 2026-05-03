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
  cors: {
    origin: "*",
  },
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "icf-banyumas-secret-key";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ================= DATABASE INIT =================
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS athletes (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      athlete_name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracking_logs (
      id SERIAL PRIMARY KEY,
      athlete_id INTEGER,
      athlete_name VARCHAR(100),
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      speed DOUBLE PRECISION DEFAULT 0,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS race_settings (
      id SERIAL PRIMARY KEY,
      race_name VARCHAR(150) DEFAULT 'ICF Banyumas Training',
      is_started BOOLEAN DEFAULT false,
      started_at TIMESTAMP,
      stopped_at TIMESTAMP
    );
  `);

  await pool.query(`
    INSERT INTO race_settings (id, race_name, is_started)
    VALUES (1, 'ICF Banyumas Training', false)
    ON CONFLICT (id) DO NOTHING;
  `);

  console.log("Database ready");
}

// ================= MIDDLEWARE =================
function authAthlete(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: "Token tidak ditemukan",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.athlete = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Token tidak valid",
    });
  }
}

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("ICF Banyumas Backend Running 🚀");
});

// ================= SOCKET =================
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// ================= REGISTER ATHLETE =================
app.post("/athletes", async (req, res) => {
  try {
    const { username, password, athleteName } = req.body;

    if (!username || !password || !athleteName) {
      return res.status(400).json({
        success: false,
        message: "username, password, dan athleteName wajib diisi",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO athletes (username, password, athlete_name)
       VALUES ($1, $2, $3)
       RETURNING id, username, athlete_name`,
      [username, hashedPassword, athleteName]
    );

    res.json({
      success: true,
      message: "Athlete created",
      data: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Gagal membuat atlet",
      error: error.message,
    });
  }
});

// ================= LOGIN JWT =================
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

    const athlete = result.rows[0];
    const isValid = await bcrypt.compare(password, athlete.password);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: "Username atau password salah",
      });
    }

    const token = jwt.sign(
      {
        id: athlete.id,
        username: athlete.username,
        athleteName: athlete.athlete_name,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      message: "Login berhasil",
      token,
      athlete: {
        id: athlete.id,
        username: athlete.username,
        athleteName: athlete.athlete_name,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Login error",
      error: error.message,
    });
  }
});

// ================= POST TRACKING WITH JWT =================
app.post("/tracking", authAthlete, async (req, res) => {
  try {
    const { latitude, longitude, speed } = req.body;

    if (latitude === null || longitude === null) {
      return res.status(400).json({
        success: false,
        message: "Latitude dan longitude wajib diisi",
      });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    const spd = Number(speed || 0);

    if (
      Number.isNaN(lat) ||
      Number.isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "Koordinat GPS tidak valid",
      });
    }

    const result = await pool.query(
      `INSERT INTO tracking_logs
       (athlete_id, athlete_name, latitude, longitude, speed)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.athlete.id, req.athlete.athleteName, lat, lng, spd]
    );

    const newData = result.rows[0];

    io.emit("location-update", newData);

    res.json({
      success: true,
      message: "Location saved",
      data: newData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Gagal menyimpan tracking",
      error: error.message,
    });
  }
});

// ================= PUBLIC TRACKING DATA =================
app.get("/tracking", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM tracking_logs ORDER BY timestamp DESC LIMIT 500"
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================= LEADERBOARD BACKEND =================
app.get("/leaderboard", async (req, res) => {
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
      ORDER BY athlete_name, timestamp DESC;
    `);

    const startLat = -7.4564651;
    const startLng = 109.2621908;

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

    const leaderboard = result.rows
      .map((item) => {
        const distance = distanceKm(
          startLat,
          startLng,
          Number(item.latitude),
          Number(item.longitude)
        );

        const speed = Number(item.speed || 0);

        return {
          athlete_id: item.athlete_id,
          athlete_name: item.athlete_name,
          latitude: item.latitude,
          longitude: item.longitude,
          speed_kmh: speed,
          distance_km: distance,
          pace_min_km: speed > 0 ? 60 / speed : 0,
          timestamp: item.timestamp,
          status: speed > 1 ? "MOVING" : "STOPPED",
        };
      })
      .sort((a, b) => b.distance_km - a.distance_km);

    res.json({
      success: true,
      data: leaderboard,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================= ADMIN ENDPOINTS =================
app.get("/admin/athletes", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, username, athlete_name, created_at
      FROM athletes
      ORDER BY id ASC
    `);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/admin/tracking", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM tracking_logs
      ORDER BY timestamp DESC
      LIMIT 1000
    `);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/admin/summary", async (req, res) => {
  try {
    const totalAthletes = await pool.query(
      "SELECT COUNT(*) FROM athletes"
    );

    const totalTracking = await pool.query(
      "SELECT COUNT(*) FROM tracking_logs"
    );

    const activeAthletes = await pool.query(`
      SELECT COUNT(DISTINCT athlete_name)
      FROM tracking_logs
      WHERE timestamp > NOW() - INTERVAL '5 minutes'
    `);

    const race = await pool.query(
      "SELECT * FROM race_settings WHERE id = 1"
    );

    res.json({
      success: true,
      data: {
        totalAthletes: Number(totalAthletes.rows[0].count),
        totalTracking: Number(totalTracking.rows[0].count),
        activeAthletes: Number(activeAthletes.rows[0].count),
        race: race.rows[0],
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/admin/race/start", async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE race_settings
      SET is_started = true,
          started_at = CURRENT_TIMESTAMP,
          stopped_at = NULL
      WHERE id = 1
      RETURNING *
    `);

    io.emit("race-status", result.rows[0]);

    res.json({
      success: true,
      message: "Race started",
      data: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/admin/race/stop", async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE race_settings
      SET is_started = false,
          stopped_at = CURRENT_TIMESTAMP
      WHERE id = 1
      RETURNING *
    `);

    io.emit("race-status", result.rows[0]);

    res.json({
      success: true,
      message: "Race stopped",
      data: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================= START SERVER =================
initDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log("Server running on port", PORT);
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
  });