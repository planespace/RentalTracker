//routes/TenantRoutes.js
import authMiddleware from "../middleware/auth.js";
import express from "express";
import rateLimit from "express-rate-limit";

const smsEmailLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
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
router.post("/send-emails", smsEmailLimiter, sendManualEmails);
router.post("/trigger-reminders", smsEmailLimiter, triggerAutomaticReminders);
router.post("/trigger-email-reminders", smsEmailLimiter, triggerEmailReminders);
router.post("/remove-current-garbage", async (req, res) => {
  try {
    const userId = req.userId;
    const today = new Date();
    const todayUTC = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    );

    const tenants = await Tenant.find({ userId, active: true });
    let updated = 0;

    for (const tenant of tenants) {
      // Find the current billing month (same logic as sync / statements)
      const months = [
        ...new Set(tenant.paymentHistory.map((e) => e.month)),
      ].sort();
      let currentMonth = null;
      for (const month of months) {
        const entry = tenant.paymentHistory.find((e) => e.month === month);
        if (entry?.dueDate) {
          const due = new Date(entry.dueDate);
          if (due >= todayUTC) {
            currentMonth = month;
            break;
          }
        }
      }
      if (!currentMonth) currentMonth = months[months.length - 1];
      if (!currentMonth) continue;

      const chargeEntry = tenant.paymentHistory.find(
        (e) =>
          e.month === currentMonth && (e.amountPaid || 0) === 0 && !e.datePaid
      );
      if (chargeEntry && chargeEntry.garbageCharge > 0) {
        chargeEntry.garbageCharge = 0;
        // Recalculate this month's total due and future months
        await recalcFutureMonths(tenant, currentMonth);
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

router.delete("/delete-all", deleteAllTenants);

router.patch("/:id/restore", restoreTenant);

router.delete("/:id/permanent", permanentlyDeleteTenant);
// ----- PARAMETERIZED ROUTES (specific patterns) -----
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
// POST, PUT, DELETE, PATCH (order less critical but keep similar pattern)
router.post(
  "/sms-webhook",
  express.raw({ type: "application/json" }),
  handleSmsWebhook
);
router.post("/send-sms", sendManualSms);
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
router.patch("/settings", updateGlobalSettings); // 👈 before /:id routes

router.patch("/:id/payment-history", updatePaymentHistory);

router.patch("/:id/payment-history/:entryId", updatePaymentEntry);
router.patch("/:id/meter-reading/:readingId", updateMeterReading);
router.patch("/:id/meter-reading", addMeterReading);
router.patch("/bulk-change-due-day", bulkChangeDueDay);
export default router;
