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

// ================= INIT DB =================
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

// ================= AUTH =================
function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) return res.status(401).json({ message: "No token" });

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("Backend ICF Banyumas Running 🚀");
});

// ================= SOCKET =================
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);
});

// ================= REGISTER =================
app.post("/athletes", async (req, res) => {
  try {
    const { username, password, athleteName } = req.body;

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO athletes (username, password, athlete_name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [username, hash, athleteName]
    );

    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= LOGIN =================
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM athletes WHERE username=$1",
      [username]
    );

    if (result.rows.length === 0)
      return res.status(401).json({ message: "User not found" });

    const user = result.rows[0];

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: "Wrong password" });

    const token = jwt.sign(
      {
        id: user.id,
        name: user.athlete_name,
      },
      JWT_SECRET
    );

    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= TRACKING =================
app.post("/tracking", auth, async (req, res) => {
  try {
    const { latitude, longitude, speed } = req.body;

    const result = await pool.query(
      `INSERT INTO tracking_logs 
       (athlete_id, athlete_name, latitude, longitude, speed)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [req.user.id, req.user.name, latitude, longitude, speed]
    );

    io.emit("update", result.rows[0]);

    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= GET TRACKING =================
app.get("/tracking", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM tracking_logs ORDER BY timestamp DESC LIMIT 500"
  );
  res.json(result.rows);
});

// ================= LEADERBOARD =================
app.get("/leaderboard", async (req, res) => {
  const result = await pool.query(`
    SELECT DISTINCT ON (athlete_name)
    athlete_name, latitude, longitude, speed, timestamp
    FROM tracking_logs
    ORDER BY athlete_name, timestamp DESC
  `);

  res.json(result.rows);
});

// ================= START =================
initDB().then(() => {
  server.listen(PORT, () => {
    console.log("RUNNING ON", PORT);
  });
});