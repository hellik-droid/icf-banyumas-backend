require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

let trackingData = [];

app.get("/", (req, res) => {
  res.send("ICF Banyumas Backend Running 🚀");
});

app.post("/tracking", (req, res) => {
  const { athleteName, latitude, longitude } = req.body;

  const data = {
    athleteName,
    latitude,
    longitude,
    timestamp: new Date(),
  };

  trackingData.push(data);

  io.emit("location-update", data);

  res.json({
    success: true,
    data,
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});