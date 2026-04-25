// models/settings.js
import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema({
  _id: { type: String, default: "global" },
  garbageFee: { type: Number, default: 0 },
  waterRatePerUnit: { type: Number, default: 0 },
  defaultDueDay: { type: Number, default: 1 },
});

const Settings = mongoose.model("Settings", settingsSchema);
export default Settings;
