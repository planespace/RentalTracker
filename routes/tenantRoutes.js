//routes/TenantRoutes.js
import authMiddleware from "../middleware/auth.js";
import express from "express";
import rateLimit from "express-rate-limit";
import { Tenant } from "../models/Tenant.js";
import { recalcFutureMonths } from "../controllers/tenantController.js";

const smsEmailLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { message: "Too many requests. Please wait a minute." },
});

const router = express.Router();
router.use(authMiddleware);

import {
  getAllTenants,
  getTenantById,
  createTenant,
  updateTenant,
  archiveTenant,
  updatePaymentHistory,
  getPaymentStatusByMonth,
  deletePaymentRecord,
  bulkMarkPaid,
  getCurrentDate,
  updatePaymentEntry,
  addMeterReading,
  getTenantStatement,
  getGlobalSettingsEndpoint,
  updateGlobalSettings,
  updateMeterReading,
  restoreTenant,
  permanentlyDeleteTenant,
  importTenants,
  getArchivedCount,
  deleteMeterReading,
  getExportStatement,
  manualSync,
  bulkChangeDueDay,
  bulkChangeRent,
  sendManualSms,
  triggerAutomaticReminders,
  getOverdueCount,
  getSmsBalance,
  handleSmsWebhook,
  getSmsLogs,
  clearSmsLogs,
  sendManualEmails,
  getEmailLogs,
  clearEmailLogs,
  triggerEmailReminders,
  getEmailUsage,
  bulkAddMeterReadings,
  bulkAddTenants,
  updateExtraCharge,
  deleteAllTenants,
} from "../controllers/tenantController.js";

// ──────────────────────────────────────────────
//  STATIC ROUTES (no parameters)
// ──────────────────────────────────────────────
router.get("/", getAllTenants);
router.get("/overdue-count", getOverdueCount);
router.get("/current-date", getCurrentDate);
router.get("/settings", getGlobalSettingsEndpoint);
router.get("/export/statement", getExportStatement);
router.get("/sms-balance", getSmsBalance);
router.get("/sms-logs", getSmsLogs);
router.delete("/sms-logs", clearSmsLogs);
router.get("/email-usage", getEmailUsage);
router.get("/email-logs", getEmailLogs);
router.delete("/email-logs", clearEmailLogs);
router.get("/archived/count", getArchivedCount);

// Bulk operations
router.patch("/bulk-meter-reading", bulkAddMeterReadings);
router.patch("/bulk-mark-paid", bulkMarkPaid);
router.patch("/bulk-change-rent", bulkChangeRent);
router.patch("/bulk-change-due-day", bulkChangeDueDay);
router.post("/bulk-add", bulkAddTenants);
router.delete("/delete-all", deleteAllTenants);

// SMS / Email manual triggers (rate limited)
router.post("/send-sms", smsEmailLimiter, sendManualSms);
router.post("/send-emails", smsEmailLimiter, sendManualEmails);
router.post("/trigger-reminders", smsEmailLimiter, triggerAutomaticReminders);
router.post("/trigger-email-reminders", smsEmailLimiter, triggerEmailReminders);

// Webhook (raw body parser) – only once
router.post(
  "/sms-webhook",
  express.raw({ type: "application/json" }),
  handleSmsWebhook
);

// Settings
router.patch("/settings", updateGlobalSettings);

// Manual sync
router.post("/sync", manualSync);

// Import tenants
router.post("/import", importTenants);

// Remove all garbage fees
router.post("/remove-all-garbage", async (req, res) => {
  try {
    const userId = req.userId;
    const tenants = await Tenant.find({ userId, active: true });
    let updated = 0;

    for (const tenant of tenants) {
      let changed = false;
      let earliestMonth = null;

      for (const entry of tenant.paymentHistory) {
        if (
          (entry.amountPaid || 0) === 0 &&
          !entry.datePaid &&
          entry.garbageCharge > 0
        ) {
          entry.garbageCharge = 0;
          changed = true;
          if (!earliestMonth || entry.month < earliestMonth) {
            earliestMonth = entry.month;
          }
        }
      }

      if (changed) {
        await recalcFutureMonths(tenant, earliestMonth);
        tenant.markModified("paymentHistory");
        await tenant.save();
        updated++;
      }
    }

    res.json({ success: true, updated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ──────────────────────────────────────────────
//  PARAMETERISED ROUTES (specific patterns)
// ──────────────────────────────────────────────
router.patch("/:id/restore", restoreTenant);
router.delete("/:id/permanent", permanentlyDeleteTenant);
router.get("/payment-status/:month", getPaymentStatusByMonth);
router.get("/:id/statement", getTenantStatement);

// ──────────────────────────────────────────────
//  DYNAMIC ID ROUTES (must come last)
// ──────────────────────────────────────────────
router.post("/", createTenant);
router.get("/:id", getTenantById);
router.put("/:id", updateTenant);
router.patch("/:id/archive", archiveTenant);
router.patch("/:id/payment-history", updatePaymentHistory);
router.patch("/:id/payment-history/:entryId", updatePaymentEntry);
router.patch("/:id/payment-history/:entryId/extra-charge", updateExtraCharge);
router.delete("/:id/payment-history/:entryId", deletePaymentRecord);
router.patch("/:id/meter-reading", addMeterReading);
router.patch("/:id/meter-reading/:readingId", updateMeterReading);
router.delete("/:id/meter-reading/:readingId", deleteMeterReading);

export default router;
