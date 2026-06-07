//models/EmailLog.js
import mongoose from "mongoose";

const emailLogSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  tenantName: { type: String, required: true },
  email: { type: String, required: true },
  subject: { type: String, required: true },
  body: { type: String, required: true },
  messageId: { type: String, default: null },
  status: {
    type: String,
    default: "pending",
    enum: ["pending", "sent", "failed"],
  },
  error: { type: String, default: null },
  sentAt: { type: Date, default: Date.now },
  failedAt: { type: Date, default: null },
});

const EmailLog = mongoose.model("EmailLog", emailLogSchema);
export default EmailLog;
