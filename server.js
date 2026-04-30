//server.js
import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import Settings from "./models/Settings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import connectTOMongoDB from "./config/db.js";
import tenantRoutes from "./routes/tenantRoutes.js";
import authRoutes from "./routes/authRoutes.js";

import { startScheduler } from "./services/scheduler.js";

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.use("/tenants", tenantRoutes);
app.use("/auth", authRoutes);

connectTOMongoDB().then(async () => {
  const { syncAllTenantsToCurrentMonth } = await import(
    "./controllers/tenantController.js"
  );
  const User = (await import("./models/User.js")).default;

  async function runSync() {
    const now = new Date();
    const todayUTC = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    );
    const users = await User.find({}, "_id");
    for (const user of users) {
      await syncAllTenantsToCurrentMonth(todayUTC, user._id.toString());
    }
  }

  await runSync();
  setInterval(runSync, 10 * 60 * 1000);
});

startScheduler();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server successfully started on port ${PORT}`);
});
