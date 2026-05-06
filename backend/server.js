const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "icf_banyumas_secret_key";

app.use(cors());
app.use(express.json());

const DB_FILE = path.join(__dirname, "users.json");

function readUsers() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([]));
  }

  const data = fs.readFileSync(DB_FILE, "utf-8");
  return JSON.parse(data || "[]");
}

function writeUsers(users) {
  fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: "Token tidak ada" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "Token tidak valid" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({ message: "Token tidak valid" });
  }
}

app.get("/", (req, res) => {
  res.send("ICF Banyumas Backend Running");
});

/* ================= AUTH REGISTER ================= */

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Nama, email, dan password wajib diisi",
      });
    }

    const users = readUsers();

    const existingUser = users.find(
      (user) => user.email.toLowerCase() === email.toLowerCase()
    );

    if (existingUser) {
      return res.status(400).json({
        message: "Email sudah terdaftar",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: Date.now(),
      name,
      email,
      password: hashedPassword,
      role: "member",
      biodata: {
        nama: name,
        email,
        alamat: "",
        tempatLahir: "",
        tanggalLahir: "",
        umur: "",
        jenisKelamin: "",
        beratBadan: "",
        tinggiBadan: "",
        sizeJersey: "",
        status: "",
        asal: "",
        noHp: "",
        noIcf: "",
        timBalap: "",
        komunitas: "",
        jenisSepeda: "",
        eventDiminati: "",
        fotoAtlet: "",
      },
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    writeUsers(users);

    const token = jwt.sign(
      {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Register berhasil",
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

/* ================= AUTH LOGIN ================= */

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const users = readUsers();

    const user = users.find(
      (item) => item.email.toLowerCase() === email.toLowerCase()
    );

    if (!user) {
      return res.status(400).json({
        message: "Email tidak ditemukan",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Password salah",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login berhasil",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

/* ================= AUTH ME ================= */

app.get("/api/auth/me", authMiddleware, (req, res) => {
  try {
    const users = readUsers();

    const user = users.find((item) => item.id === req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User tidak ditemukan",
      });
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

/* ================= GET BIODATA ================= */

app.get("/api/biodata", authMiddleware, (req, res) => {
  try {
    const users = readUsers();

    const user = users.find((item) => item.id === req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User tidak ditemukan",
      });
    }

    res.json({
      biodata: user.biodata || {},
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

/* ================= UPDATE BIODATA ================= */

app.post("/api/biodata", authMiddleware, (req, res) => {
  try {
    const users = readUsers();

    const index = users.findIndex((item) => item.id === req.user.id);

    if (index === -1) {
      return res.status(404).json({
        message: "User tidak ditemukan",
      });
    }

    const oldBiodata = users[index].biodata || {};

    users[index].biodata = {
      ...oldBiodata,
      ...req.body,
      updatedAt: new Date().toISOString(),
    };

    if (req.body.nama) {
      users[index].name = req.body.nama;
    }

    writeUsers(users);

    res.json({
      message: "Biodata berhasil disimpan",
      biodata: users[index].biodata,
      user: {
        id: users[index].id,
        name: users[index].name,
        email: users[index].email,
        role: users[index].role,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`ICF Banyumas backend running on port ${PORT}`);
});