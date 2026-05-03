// ================= PRO RACE CONFIG =================
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

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
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
    const d = calculateDistanceKm(
      latitude,
      longitude,
      point[0],
      point[1]
    );

    if (d < minDistance) {
      minDistance = d;
      nearestIndex = index;
    }
  });

  return nearestIndex / (RACE_ROUTE.length - 1);
}

function getNextCheckpoint(progress) {
  return CHECKPOINTS.find((cp) => cp.km > progress) || CHECKPOINTS[CHECKPOINTS.length - 1];
}

// ================= PRO LEADERBOARD =================
app.get("/pro/leaderboard", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (athlete_name)
        athlete_id,
        athlete_name,
        latitude,
        longitude,
        speed,
        timestamp
      FROM tracking_logs
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY athlete_name, timestamp DESC
    `);

    const leaderboard = result.rows
      .map((item) => {
        const progress = getProgressByRoute(
          Number(item.latitude),
          Number(item.longitude)
        );

        const distanceKm = progress * ROUTE_DISTANCE_KM;
        const speedKmh = Number(item.speed || 0);
        const remainingKm = Math.max(ROUTE_DISTANCE_KM - distanceKm, 0);

        const etaMinutes =
          speedKmh > 0 ? (remainingKm / speedKmh) * 60 : 0;

        const nextCheckpoint = getNextCheckpoint(progress);

        return {
          athlete_id: item.athlete_id,
          athlete_name: item.athlete_name,
          latitude: item.latitude,
          longitude: item.longitude,
          speed_kmh: speedKmh,
          pace_min_km: speedKmh > 0 ? 60 / speedKmh : 0,
          progress_percent: Number((progress * 100).toFixed(1)),
          distance_km: Number(distanceKm.toFixed(2)),
          next_checkpoint: nextCheckpoint.name,
          eta_minutes: Number(etaMinutes.toFixed(1)),
          status: progress >= 1 ? "FINISHED" : speedKmh > 1 ? "MOVING" : "STOPPED",
          timestamp: item.timestamp,
        };
      })
      .sort((a, b) => b.progress_percent - a.progress_percent);

    res.json({
      success: true,
      routeDistanceKm: ROUTE_DISTANCE_KM,
      data: leaderboard,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================= CHECKPOINTS =================
app.get("/pro/checkpoints", (req, res) => {
  res.json({
    success: true,
    route: RACE_ROUTE,
    distanceKm: ROUTE_DISTANCE_KM,
    checkpoints: CHECKPOINTS,
  });
});

// ================= FINISH DETECTION =================
app.get("/pro/finishers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (athlete_name)
        athlete_id,
        athlete_name,
        latitude,
        longitude,
        speed,
        timestamp
      FROM tracking_logs
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY athlete_name, timestamp DESC
    `);

    const finishers = result.rows
      .map((item) => {
        const progress = getProgressByRoute(
          Number(item.latitude),
          Number(item.longitude)
        );

        return {
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
      totalFinishers: finishers.length,
      data: finishers,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});