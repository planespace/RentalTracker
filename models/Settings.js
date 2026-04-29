// models/Settings.js
import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema({
  _id: { type: String },
  garbageFee: { type: Number, default: 0 },
  waterRatePerUnit: { type: Number, default: 0 },
  defaultDueDay: { type: Number, default: 1 },
  totalHouses: { type: Number, default: 0 },
  autoRemindersEnabled: { type: Boolean, default: true },
  reminderTemplate: {
    type: String,
    default:
      "Dear {name}, your rent of KES {amount} was due on {dueDate}. Please pay to avoid penalties. Thank you.",
  },
});

const Settings = mongoose.model("Settings", settingsSchema);
export default Settings;
