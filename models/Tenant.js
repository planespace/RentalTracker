// models/Tenant.js

import mongoose from "mongoose";

function getCorrectMonthFormat() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const yyyyMm = `${year}-${month}`;
  return yyyyMm;
}

const paymentEntrySchema = new mongoose.Schema({
  // Existing fields
  amountPaid: { type: Number, default: 0 },
  remainingBalance: { type: Number, default: 0 },
  month: { type: String, required: true },
  paid: { type: Boolean, default: false },
  datePaid: { type: Date, default: null },
  dueDate: { type: Date },

  // NEW: Charge breakdown
  baseRent: { type: Number, required: true },
  waterCharge: { type: Number, default: 0 },
  garbageCharge: { type: Number, default: 0 },
  totalDue: { type: Number, required: true },

  // NEW: M‑Pesa reference (optional)
  mpesaRef: { type: String, default: "" },
});

const tenantSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
  rent: { type: Number, required: true }, // base rent
  phoneNumber: { type: String, required: true },
  houseNumber: { type: String, required: true },
  paymentHistory: [paymentEntrySchema],
  notes: { type: String, default: "" },
  active: { type: Boolean, default: true },
  reminderSentMonths: { type: [String], default: [] },
  entryDate: { type: Date, default: Date.now },
  dueDay: { type: Number, required: true, min: 1, max: 31 },
  deposit: { type: Boolean, default: false },
  depositPeriod: { type: Number, default: 1 },
  waterMeterReadings: {
    type: [
      {
        month: { type: String, required: true },
        reading: { type: Number, required: true },
        unitsUsed: { type: Number, default: 0 },
        cost: { type: Number, default: 0 },
        rate: { type: Number, required: true },
      },
    ],
    default: [],
  },
});

let Tenant = mongoose.model("Tenant", tenantSchema);

export { Tenant };
