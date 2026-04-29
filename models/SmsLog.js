// models/SmsLog.js
import mongoose from "mongoose";

const smsLogSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  tenantId: { type: String, required: true, index: true },
  tenantName: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  message: { type: String, required: true },
  messageId: { type: String, default: null, index: true }, // Africa's Talking message ID
  status: {
    type: String,
    default: "pending",
    enum: ["pending", "sent", "delivered", "failed"],
  },
  error: { type: String, default: null },
  sentAt: { type: Date, default: Date.now },
  deliveredAt: { type: Date, default: null },
  failedAt: { type: Date, default: null },
});

const SmsLog = mongoose.model("SmsLog", smsLogSchema);
export default SmsLog;
