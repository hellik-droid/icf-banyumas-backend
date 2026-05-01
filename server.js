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
  cors: { origin: "*" },
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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

  console.log("Database ready");
}

app.get("/", (req, res) => {
  res.send("ICF Banyumas Backend Running 🚀");
});

app.post("/tracking", async (req, res) => {
  try {
    const { athleteName, latitude, longitude } = req.body;

    const result = await pool.query(
      `INSERT INTO tracking_logs (athlete_name, latitude, longitude)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [athleteName, latitude, longitude]
    );

    const data = result.rows[0];
    io.emit("location-update", data);

    res.json({
      success: true,
      message: "Location saved to database",
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to save location",
      error: error.message,
    });
  }
});

app.get("/tracking", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM tracking_logs ORDER BY timestamp DESC LIMIT 100"
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

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
});

const PORT = process.env.PORT || 3000;

initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log("Server running on port", PORT);
  });
});