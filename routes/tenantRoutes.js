//routes/TenantRoutes.js
import authMiddleware from "../middleware/auth.js";
import express from "express";
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
  setDeposit,
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
} from "../controllers/tenantController.js";

// ----- STATIC ROUTES (no parameters) -----
router.get("/", getAllTenants);
router.get("/current-date", getCurrentDate);
router.get("/settings", getGlobalSettingsEndpoint);
router.get("/export/statement", getExportStatement);
router.patch("/:id/restore", restoreTenant);
router.delete("/:id/permanent", permanentlyDeleteTenant);
// ----- PARAMETERIZED ROUTES (specific patterns) -----
router.get("/payment-status/:month", getPaymentStatusByMonth);
router.get("/:id/statement", getTenantStatement);

// ----- DYNAMIC ID ROUTES (must come last) -----
router.get("/:id", getTenantById);
router.get("/archived/count", getArchivedCount);

// POST, PUT, DELETE, PATCH (order less critical but keep similar pattern)
router.post("/import", importTenants);
router.post("/", createTenant);
router.post("/sync", manualSync);
router.put("/:id", updateTenant);
router.patch("/:id/archive", archiveTenant);
router.delete("/:id/payment-history/:entryId", deletePaymentRecord);
router.delete("/:id/meter-reading/:readingId", deleteMeterReading);
router.patch("/bulk-mark-paid", bulkMarkPaid);

router.patch("/settings", updateGlobalSettings); // 👈 before /:id routes

router.patch("/:id/payment-history", updatePaymentHistory);
router.patch("/:id/set-deposit", setDeposit);
router.patch("/:id/payment-history/:entryId", updatePaymentEntry);
router.patch("/:id/meter-reading/:readingId", updateMeterReading);
router.patch("/:id/meter-reading", addMeterReading);
router.patch("/bulk-change-due-day", bulkChangeDueDay);
export default router;
