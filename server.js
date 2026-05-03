require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const http = require("http");
const { Server } = require("socket.io");

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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});


// ================= DATABASE INIT =================
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracking_logs (
        id SERIAL PRIMARY KEY,
        athlete_name VARCHAR(100),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        speed DOUBLE PRECISION,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS athletes (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(100) NOT NULL,
        athlete_name VARCHAR(100) NOT NULL
      );
    `);

    console.log("Database ready");
  } catch (err) {
    console.error("DB init error:", err);
  }
}


// ================= SOCKET.IO =================
io.on("connection", (socket) => {
  console.log("Client connected");

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});


// ================= LOGIN =================
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM athletes WHERE username = $1 AND password = $2",
      [username, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Username atau password salah",
      });
    }

    const athlete = result.rows[0];

    res.json({
      success: true,
      athlete: {
        id: athlete.id,
        athleteName: athlete.athlete_name,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ================= CREATE ATHLETE =================
app.post("/athletes", async (req, res) => {
  try {
    const { username, password, athleteName } = req.body;

    const result = await pool.query(
      `INSERT INTO athletes (username, password, athlete_name)
       VALUES ($1, $2, $3)
       RETURNING id, username, athlete_name`,
      [username, password, athleteName]
    );

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ================= TRACKING =================
app.post("/tracking", async (req, res) => {
  try {
    const { athleteName, latitude, longitude, speed } = req.body;

    await pool.query(
      `INSERT INTO tracking_logs (athlete_name, latitude, longitude, speed)
       VALUES ($1, $2, $3, $4)`,
      [athleteName, latitude, longitude, speed || 0]
    );

    // realtime emit ke frontend
    io.emit("tracking-update", {
      athleteName,
      latitude,
      longitude,
      speed,
      timestamp: new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ================= GET TRACKING =================
app.get("/tracking", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM tracking_logs ORDER BY timestamp DESC LIMIT 200"
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ================= START SERVER =================
initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log("Server running on port", PORT);
  });
});
