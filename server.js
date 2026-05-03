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
const JWT_SECRET = process.env.JWT_SECRET || "icf-banyumas-secret-key";

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
      athlete_name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS races (
      id SERIAL PRIMARY KEY,
      race_name VARCHAR(150) NOT NULL,
      location VARCHAR(150),
      distance_km DOUBLE PRECISION DEFAULT 1,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS race_participants (
      id SERIAL PRIMARY KEY,
      race_id INTEGER NOT NULL,
      athlete_id INTEGER NOT NULL,
      athlete_name VARCHAR(100),
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(race_id, athlete_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracking_logs (
      id SERIAL PRIMARY KEY,
      race_id INTEGER DEFAULT 1,
      athlete_id INTEGER,
      athlete_name VARCHAR(100),
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      speed DOUBLE PRECISION DEFAULT 0,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`ALTER TABLE tracking_logs ADD COLUMN IF NOT EXISTS race_id INTEGER DEFAULT 1;`);
  await pool.query(`ALTER TABLE tracking_logs ADD COLUMN IF NOT EXISTS athlete_id INTEGER;`);
  await pool.query(`ALTER TABLE tracking_logs ADD COLUMN IF NOT EXISTS speed DOUBLE PRECISION DEFAULT 0;`);

  await pool.query(`
    INSERT INTO races (id, race_name, location, distance_km, is_active)
    VALUES (1, 'ICF Banyumas Training', 'Banyumas', 1, true)
    ON CONFLICT (id) DO NOTHING;
  `);

  console.log("DB READY");
}

function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({
      success: false,
      message: "Token tidak ditemukan",
    });
  }

  try {
    const token = header.split(" ")[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Token tidak valid",
    });
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
  console.log("Client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

app.post("/register", async (req, res) => {
  try {
    const { username, password, athleteName } = req.body;

    if (!username || !password || !athleteName) {
      return res.status(400).json({
        success: false,
        message: "username, password, dan athleteName wajib diisi",
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO athletes (username, password, athlete_name)
       VALUES ($1, $2, $3)
       RETURNING id, username, athlete_name`,
      [username, hash, athleteName]
    );

    res.json({
      success: true,
      message: "Register berhasil",
      athlete: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Register gagal",
      error: error.message,
    });
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

    const athlete = result.rows[0];
    const validPassword = await bcrypt.compare(password, athlete.password);

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: "Username atau password salah",
      });
    }

    const token = jwt.sign(
      {
        id: athlete.id,
        username: athlete.username,
        name: athlete.athlete_name,
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

app.get("/races", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM races WHERE is_active = true ORDER BY id ASC"
    );

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

app.post("/races/:raceId/join", auth, async (req, res) => {
  try {
    const raceId = Number(req.params.raceId);

    const race = await pool.query("SELECT * FROM races WHERE id = $1", [
      raceId,
    ]);

    if (race.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Race tidak ditemukan",
      });
    }

    const result = await pool.query(
      `INSERT INTO race_participants (race_id, athlete_id, athlete_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (race_id, athlete_id) DO NOTHING
       RETURNING *`,
      [raceId, req.user.id, req.user.name]
    );

    res.json({
      success: true,
      message: "Berhasil join race",
      data:
        result.rows[0] || {
          race_id: raceId,
          athlete_id: req.user.id,
          athlete_name: req.user.name,
          alreadyJoined: true,
        },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/my-races", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT rp.*, r.race_name, r.location, r.distance_km, r.is_active
       FROM race_participants rp
       JOIN races r ON rp.race_id = r.id
       WHERE rp.athlete_id = $1
       ORDER BY rp.joined_at DESC`,
      [req.user.id]
    );

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

app.post("/tracking", auth, async (req, res) => {
  try {
    const { raceId, latitude, longitude, speed } = req.body;

    if (!raceId) {
      return res.status(400).json({
        success: false,
        message: "raceId wajib dikirim",
      });
    }

    const joined = await pool.query(
      `SELECT * FROM race_participants
       WHERE race_id = $1 AND athlete_id = $2`,
      [raceId, req.user.id]
    );

    if (joined.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Atlet belum join race ini",
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
       (race_id, athlete_id, athlete_name, latitude, longitude, speed)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [raceId, req.user.id, req.user.name, lat, lng, spd]
    );

    const newData = result.rows[0];

    io.emit("location-update", newData);

    res.json({
      success: true,
      message: "Tracking saved",
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

app.get("/tracking", async (req, res) => {
  try {
    const raceId = req.query.raceId || 1;

    const result = await pool.query(
      `SELECT * FROM tracking_logs
       WHERE race_id = $1
       ORDER BY timestamp DESC
       LIMIT 500`,
      [raceId]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
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
    const raceId = req.query.raceId || 1;

    const result = await pool.query(
      `SELECT DISTINCT ON (athlete_name)
        race_id,
        athlete_id,
        athlete_name,
        latitude,
        longitude,
        speed,
        timestamp
       FROM tracking_logs
       WHERE race_id = $1
       AND latitude IS NOT NULL
       AND longitude IS NOT NULL
       ORDER BY athlete_name, timestamp DESC`,
      [raceId]
    );

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
          race_id: item.race_id,
          athlete_id: item.athlete_id,
          athlete_name: item.athlete_name,
          latitude: item.latitude,
          longitude: item.longitude,
          speed_kmh: Number(speed.toFixed(1)),
          pace_min_km: speed > 0 ? Number((60 / speed).toFixed(1)) : 0,
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
      raceId,
      routeDistanceKm: ROUTE_DISTANCE_KM,
      data: leaderboard,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/pro/finishers", async (req, res) => {
  try {
    const raceId = req.query.raceId || 1;

    const result = await pool.query(
      `SELECT DISTINCT ON (athlete_name)
        race_id,
        athlete_id,
        athlete_name,
        latitude,
        longitude,
        speed,
        timestamp
       FROM tracking_logs
       WHERE race_id = $1
       AND latitude IS NOT NULL
       AND longitude IS NOT NULL
       ORDER BY athlete_name, timestamp DESC`,
      [raceId]
    );

    const finishers = result.rows
      .map((item) => {
        const progress = getProgressByRoute(
          Number(item.latitude),
          Number(item.longitude)
        );

        return {
          race_id: item.race_id,
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
      raceId,
      totalFinishers: finishers.length,
      data: finishers,
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
    const raceId = req.query.raceId || 1;

    const totalAthletes = await pool.query("SELECT COUNT(*) FROM athletes");

    const totalParticipants = await pool.query(
      `SELECT COUNT(*) FROM race_participants WHERE race_id = $1`,
      [raceId]
    );

    const totalTracking = await pool.query(
      `SELECT COUNT(*) FROM tracking_logs WHERE race_id = $1`,
      [raceId]
    );

    const activeAthletes = await pool.query(
      `SELECT COUNT(DISTINCT athlete_name)
       FROM tracking_logs
       WHERE race_id = $1
       AND timestamp > NOW() - INTERVAL '5 minutes'`,
      [raceId]
    );

    res.json({
      success: true,
      raceId,
      data: {
        totalAthletes: Number(totalAthletes.rows[0].count),
        totalParticipants: Number(totalParticipants.rows[0].count),
        totalTracking: Number(totalTracking.rows[0].count),
        activeAthletes: Number(activeAthletes.rows[0].count),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

initDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log("RUNNING ON", PORT);
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
  });