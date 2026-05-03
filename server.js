require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracking_logs (
      id SERIAL PRIMARY KEY,
      athlete_name VARCHAR(100),
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
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
}

app.get("/", (req, res) => {
  res.send("ICF Banyumas Backend Running 🚀");
});

app.get("/tracking", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM tracking_logs ORDER BY timestamp DESC LIMIT 200"
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get tracking data",
      error: error.message,
    });
  }
});
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
      message: "Login berhasil",
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
      message: "Athlete created",
      data: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to create athlete",
      error: error.message,
    });
  }
});

app.post("/tracking", async (req, res) => {
  try {
    const { athleteName, latitude, longitude } = req.body;

    if (!athleteName || latitude === null || longitude === null) {
      return res.status(400).json({
        success: false,
        message: "athleteName, latitude, and longitude are required",
      });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

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
        message: "Invalid GPS coordinate",
      });
    }

    const result = await pool.query(
      `INSERT INTO tracking_logs (athlete_name, latitude, longitude)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [athleteName, lat, lng]
    );

    const data = result.rows[0];

    io.emit("location-update", data);

    res.json({
      success: true,
      message: "Location saved and broadcasted",
      data,
    });
  } catch (error) {
    console.error("Tracking error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to save location",
      error: error.message,
    });
  }
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.emit("connected", {
    message: "Connected to ICF Banyumas realtime server",
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log("Server running on port", PORT);
  });
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS athletes (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL,
    athlete_name VARCHAR(100) NOT NULL
  );
`);
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
      message: "Athlete created",
      data: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to create athlete",
      error: error.message,
    });
  }
});
0fb509d (add athlete login)
