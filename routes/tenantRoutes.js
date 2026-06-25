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

// ----- STATIC ROUTES (no parameters) -----
router.get("/", getAllTenants);
router.get("/overdue-count", getOverdueCount);
router.get("/current-date", getCurrentDate);
router.get("/settings", getGlobalSettingsEndpoint);
router.get("/export/statement", getExportStatement);
router.get("/sms-balance", getSmsBalance);
router.get("/sms-logs", getSmsLogs);
router.delete("/sms-logs", clearSmsLogs);
router.get("/email-usage", getEmailUsage);
router.patch("/bulk-meter-reading", bulkAddMeterReadings);
router.post("/trigger-email-reminders", triggerEmailReminders);
router.post("/send-emails", sendManualEmails);
router.get("/email-logs", getEmailLogs);
router.delete("/email-logs", clearEmailLogs);
router.post("/bulk-add", bulkAddTenants);
router.post("/send-sms", smsEmailLimiter, sendManualSms);

router.post("/trigger-email-reminders", smsEmailLimiter, triggerEmailReminders);
router.delete("/delete-all", deleteAllTenants);

// ✅ Remove garbage fee from ALL billing months for every active tenant
router.post("/remove-all-garbage", async (req, res) => {
  try {
    const userId = req.userId;
    const tenants = await Tenant.find({ userId, active: true });
    let updated = 0;

    for (const tenant of tenants) {
      let changed = false;
      let earliestMonth = null;

      for (const entry of tenant.paymentHistory) {
        // Only process charge entries (not payment entries)
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
        // Recalculate from the earliest affected month onwards
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

// ----- PARAMETERIZED ROUTES (specific patterns) -----
router.patch("/:id/restore", restoreTenant);
router.delete("/:id/permanent", permanentlyDeleteTenant);
router.get("/payment-status/:month", getPaymentStatusByMonth);
router.get("/:id/statement", getTenantStatement);

// ----- DYNAMIC ID ROUTES (must come last) -----
router.get("/:id", getTenantById);
router.patch("/:id/payment-history/:entryId/extra-charge", updateExtraCharge);
router.get("/archived/count", getArchivedCount);
router.post(
  "/sms-webhook",
  express.raw({ type: "application/json" }),
  handleSmsWebhook
);
router.post(
  "/sms-webhook",
  express.raw({ type: "application/json" }),
  handleSmsWebhook
);

router.post("/trigger-reminders", triggerAutomaticReminders);
router.post("/import", importTenants);
router.post("/", createTenant);
router.post("/sync", manualSync);
router.put("/:id", updateTenant);
router.patch("/:id/archive", archiveTenant);
router.delete("/:id/payment-history/:entryId", deletePaymentRecord);
router.delete("/:id/meter-reading/:readingId", deleteMeterReading);
router.patch("/bulk-mark-paid", bulkMarkPaid);
router.patch("/bulk-change-rent", bulkChangeRent);
router.patch("/settings", updateGlobalSettings);
router.patch("/:id/payment-history", updatePaymentHistory);
router.patch("/:id/payment-history/:entryId", updatePaymentEntry);
router.patch("/:id/meter-reading/:readingId", updateMeterReading);
router.patch("/:id/meter-reading", addMeterReading);
router.patch("/bulk-change-due-day", bulkChangeDueDay);

export default router;
