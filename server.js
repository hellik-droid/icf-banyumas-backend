require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "icf-banyumas-secret-key";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

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

function createTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendVerificationEmail(email, token) {
  const verificationUrl = `${APP_URL}/member/verify?token=${token}`;
  const transporter = createTransporter();

  if (!transporter) {
    console.log("SMTP belum diset. Link verifikasi:", verificationUrl);
    return { sent: false, verificationUrl };
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: "ICF Banyumas - Verifikasi Akun Member",
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
        <h2>Verifikasi Akun ICF Banyumas</h2>
        <p>Terima kasih sudah mendaftar sebagai member ICF Banyumas.</p>
        <p>Klik tombol berikut untuk aktivasi akun:</p>
        <p>
          <a href="${verificationUrl}" style="background:#2563eb;color:white;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:bold">
            Aktivasi Akun
          </a>
        </p>
        <p>Jika tombol tidak bisa diklik, buka link ini:</p>
        <p>${verificationUrl}</p>
      </div>
    `,
  });

  return { sent: true, verificationUrl };
}

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

  await pool.query(`ALTER TABLE athletes ADD COLUMN IF NOT EXISTS email VARCHAR(150);`);
  await pool.query(`ALTER TABLE athletes ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT true;`);
  await pool.query(`ALTER TABLE athletes ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255);`);
  await pool.query(`ALTER TABLE athletes ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMP;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_profiles (
      id SERIAL PRIMARY KEY,
      athlete_id INTEGER UNIQUE NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
      full_name VARCHAR(150),
      address TEXT,
      birth_place VARCHAR(150),
      birth_date DATE,
      gender VARCHAR(30),
      weight DOUBLE PRECISION,
      height DOUBLE PRECISION,
      jersey_size VARCHAR(20),
      member_status VARCHAR(50),
      origin_name VARCHAR(150),
      phone VARCHAR(50),
      icf_number VARCHAR(100),
      race_team VARCHAR(150),
      cycling_community VARCHAR(150),
      bike_type VARCHAR(100),
      interested_events VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

app.post("/member/register", async (req, res) => {
  try {
    const { email, username, password, athleteName } = req.body;

    if (!email || !username || !password || !athleteName) {
      return res.status(400).json({
        success: false,
        message: "email, username, password, dan athleteName wajib diisi",
      });
    }

    const existing = await pool.query(
      `SELECT id FROM athletes WHERE username = $1 OR email = $2`,
      [username, email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Username atau email sudah terdaftar",
      });
    }

    const hash = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(32).toString("hex");

    const result = await pool.query(
      `INSERT INTO athletes
       (username, password, athlete_name, email, email_verified, verification_token, verification_expires)
       VALUES ($1, $2, $3, $4, false, $5, NOW() + INTERVAL '24 hours')
       RETURNING id, username, athlete_name, email, email_verified`,
      [username, hash, athleteName, email, token]
    );

    const emailResult = await sendVerificationEmail(email, token);

    res.json({
      success: true,
      message: emailResult.sent
        ? "Register berhasil. Link verifikasi sudah dikirim ke email."
        : "Register berhasil. SMTP belum diset, gunakan verificationUrl untuk testing.",
      athlete: result.rows[0],
      verificationUrl: emailResult.verificationUrl,
      emailSent: emailResult.sent,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Register member gagal",
      error: error.message,
    });
  }
});

app.get("/member/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send("Token verifikasi tidak ditemukan");
    }

    const result = await pool.query(
      `SELECT * FROM athletes
       WHERE verification_token = $1
       AND verification_expires > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).send("Token tidak valid atau sudah expired");
    }

    await pool.query(
      `UPDATE athletes
       SET email_verified = true,
           verification_token = NULL,
           verification_expires = NULL
       WHERE id = $1`,
      [result.rows[0].id]
    );

    res.send(`
      <div style="font-family:Arial;padding:40px">
        <h1>Akun berhasil diverifikasi ✅</h1>
        <p>Silakan kembali ke halaman member ICF Banyumas untuk login dan melengkapi biodata.</p>
        <a href="${APP_URL}/member" style="background:#2563eb;color:white;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:bold">
          Buka Halaman Member
        </a>
      </div>
    `);
  } catch (error) {
    res.status(500).send(error.message);
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

    if (athlete.email && athlete.email_verified === false) {
      return res.status(403).json({
        success: false,
        message: "Akun belum diverifikasi melalui email",
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
        email: athlete.email,
        emailVerified: athlete.email_verified,
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

app.post("/member/profile", auth, async (req, res) => {
  try {
    const {
      fullName,
      address,
      birthPlace,
      birthDate,
      gender,
      weight,
      height,
      jerseySize,
      status,
      originName,
      phone,
      icfNumber,
      raceTeam,
      cyclingCommunity,
      bikeType,
      interestedEvents,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO member_profiles
       (
        athlete_id, full_name, address, birth_place, birth_date, gender,
        weight, height, jersey_size, member_status, origin_name, phone,
        icf_number, race_team, cycling_community, bike_type, interested_events,
        updated_at
       )
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
       ON CONFLICT (athlete_id)
       DO UPDATE SET
        full_name = EXCLUDED.full_name,
        address = EXCLUDED.address,
        birth_place = EXCLUDED.birth_place,
        birth_date = EXCLUDED.birth_date,
        gender = EXCLUDED.gender,
        weight = EXCLUDED.weight,
        height = EXCLUDED.height,
        jersey_size = EXCLUDED.jersey_size,
        member_status = EXCLUDED.member_status,
        origin_name = EXCLUDED.origin_name,
        phone = EXCLUDED.phone,
        icf_number = EXCLUDED.icf_number,
        race_team = EXCLUDED.race_team,
        cycling_community = EXCLUDED.cycling_community,
        bike_type = EXCLUDED.bike_type,
        interested_events = EXCLUDED.interested_events,
        updated_at = NOW()
       RETURNING *`,
      [
        req.user.id,
        fullName,
        address,
        birthPlace,
        birthDate || null,
        gender,
        Number(weight) || null,
        Number(height) || null,
        jerseySize,
        status,
        originName,
        phone,
        icfNumber,
        raceTeam,
        cyclingCommunity,
        bikeType,
        interestedEvents,
      ]
    );

    await pool.query(
      `UPDATE athletes SET athlete_name = $1 WHERE id = $2`,
      [fullName || req.user.name, req.user.id]
    );

    res.json({
      success: true,
      message: "Profile member berhasil disimpan",
      data: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Gagal menyimpan profile member",
      error: error.message,
    });
  }
});

app.get("/member/profile", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.username, a.athlete_name, a.email, a.email_verified, mp.*
       FROM athletes a
       LEFT JOIN member_profiles mp ON mp.athlete_id = a.id
       WHERE a.id = $1`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: result.rows[0] || null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Gagal mengambil profile member",
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