const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const gpxDir = path.join(__dirname, "uploads", "routes");

if (!fs.existsSync(gpxDir)) {
  fs.mkdirSync(gpxDir, { recursive: true });
}
const gpxStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, gpxDir);
  },
  filename: function (req, file, cb) {
    const originalName = file.originalname.replace(/\s+/g, "_");
    cb(null, originalName);
  },
});

const uploadGpx = multer({ storage: gpxStorage });

app.post("/api/upload-gpx", uploadGpx.single("gpx"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "File GPX tidak ada" });
  }

  res.json({
    message: "GPX berhasil diupload",
    filename: req.file.filename,
    gpxUrl: `/uploads/routes/${req.file.filename}`,
  });
});
const flyerDir = path.join(__dirname, "uploads", "flyers");

if (!fs.existsSync(flyerDir)) {
  fs.mkdirSync(flyerDir, { recursive: true });
}

const flyerStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, flyerDir);
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/\s+/g, "_");
    cb(null, Date.now() + "-" + safeName);
  },
});

const uploadFlyer = multer({ storage: flyerStorage });

app.post("/api/upload-flyer", uploadFlyer.single("flyer"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "File flyer tidak ada" });
  }

  res.json({
    message: "Flyer berhasil diupload",
    filename: req.file.filename,
    flyerUrl: `/uploads/flyers/${req.file.filename}`,
  });
});
/* =========================
   STORAGE SEMENTARA (IN-MEMORY)
========================= */

let events = [
  {
    id: "17780270791655ee4f82b15eda8",
    title: "ICF Banyumas Training",
    name: "ICF Banyumas Training",
    gpxUrl: "/uploads/routes/contoh.gpx"
  }
];
console.log("JUMLAH EVENTS:", events.length);
console.log("DATA EVENTS:", events);

/* =========================
   EVENT API
========================= */

// GET ALL EVENTS
app.get("/api/events", (req, res) => {
  res.json(events);
});

// GET EVENT BY ID
app.get("/api/events/:id", (req, res) => {
  const event = events.find(e => e.id === req.params.id);
  if (!event) return res.status(404).json({ message: "Event tidak ditemukan" });
  res.json(event);
});

// CREATE EVENT
app.post("/api/events", (req, res) => {
  const newEvent = {
    id: Date.now().toString(),
    ...req.body
  };

  events.push(newEvent);

  res.json({
    message: "Event berhasil ditambahkan",
    data: newEvent
  });
});

// UPDATE EVENT
app.put("/api/events/:id", (req, res) => {
  const index = events.findIndex(e => e.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ message: "Event tidak ditemukan" });
  }

  events[index] = {
    ...events[index],
    ...req.body
  };

  res.json({
    message: "Event berhasil diupdate",
    data: events[index]
  });
});

// DELETE EVENT
app.delete("/api/events/:id", (req, res) => {
  events = events.filter(e => e.id !== req.params.id);

  res.json({ message: "Event berhasil dihapus" });
});

/* =========================
   TEST API
========================= */

app.get("/", (req, res) => {
  res.send("ICF Backend Running 🚴");
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 5000;
app.get("/api/test-events", (req, res) => {
  res.json({
    jumlah: events.length,
    data: events
  });
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
