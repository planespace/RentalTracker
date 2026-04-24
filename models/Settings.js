// models/settings.js
const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema({
  _id: { type: String, default: "global" },
  garbageFee: { type: Number, default: 0 },
  waterRatePerUnit: { type: Number, default: 0 },
  defaultDueDay: { type: Number, default: 1 },
});

module.exports = mongoose.model("Settings", settingsSchema);
