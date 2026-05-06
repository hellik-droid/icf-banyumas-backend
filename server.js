const express = require("express");
const cors = require("cors");

const app = express();


app.use(cors());
app.use(express.json());

/* =========================
   STORAGE SEMENTARA (IN-MEMORY)
========================= */

let events = [];

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});