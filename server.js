//server.js

import "dotenv/config"; // ← changed from require("dotenv").config()
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import connectTOMongoDB from "./config/db.js";
import tenantRoutes from "./routes/tenantRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import devDateMiddleware from "./middleware/devDate.js";

const app = express();

app.use(devDateMiddleware);
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.use("/tenants", tenantRoutes);
app.use("/auth", authRoutes);

connectTOMongoDB().then(async () => {
  const { syncAllTenantsToCurrentMonth } = await import("./controllers/tenantController.js");
  // Pass UTC midnight of the current real date
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  await syncAllTenantsToCurrentMonth(todayUTC);
  setInterval(async () => {
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    await syncAllTenantsToCurrentMonth(todayUTC);
  }, 60 * 60 * 1000);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server successfully started on port ${PORT}`);
});
