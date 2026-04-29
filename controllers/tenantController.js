// ========================
//   controllers/tenantController.js – FULLY FIXED (only the necessary changes)
// ========================
import { Tenant } from "../models/Tenant.js";
import Settings from "../models/Settings.js"; // ✅ FIXED: default import only
import User from "../models/User.js"; // ✅ FIXED: default import only
import {
  sendBulkSms,
  sendOverdueRemindersForUser,
  getOverdueTenants,
} from "../services/smsService.js";
import africastalking from "africastalking";
import SmsLog from "../models/SmsLog.js";
// ========================
//   HELPER FUNCTIONS
// ========================
function getCorrectMonthFormat() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

async function syncAllTenantsToCurrentMonth(todayOverride) {
  // todayOverride is expected to be a Date object set to UTC midnight
  const today =
    todayOverride ||
    (() => {
      const now = new Date();
      return new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
      );
    })();

  const todayTime = today.getTime(); // UTC midnight timestamp
  const currentMonthStr = `${today.getUTCFullYear()}-${String(
    today.getUTCMonth() + 1
  ).padStart(2, "0")}`;

  const allTenants = await Tenant.find({ active: true });

  for (let tenant of allTenants) {
    const settings = await getGlobalSettings(tenant.userId);

    // --- First month creation ---
    if (tenant.paymentHistory.length === 0) {
      const { dueDate, month: firstMonth } = getNextDueDateAndMonth(
        tenant,
        today
      );
      const entryDate = tenant.entryDate
        ? new Date(tenant.entryDate)
        : new Date();
      entryDate.setHours(0, 0, 0, 0);

      tenant.paymentHistory.push({
        month: firstMonth,
        baseRent: tenant.rent,
        waterCharge: 0,
        garbageCharge: settings.garbageFee,
        totalDue: tenant.rent + settings.garbageFee,
        amountPaid: 0,
        remainingBalance: 0,
        paid: false,
        datePaid: null,
        dueDate: dueDate,
        mpesaRef: "",
      });
      await recalcFutureMonths(tenant, firstMonth);
      await tenant.save();
      continue;
    }

    // --- Existing tenants: find latest month ---
    const sortedMonths = [...tenant.paymentHistory.map((e) => e.month)].sort();
    const lastMonth = sortedMonths[sortedMonths.length - 1];
    const lastEntry = tenant.paymentHistory.find((e) => e.month === lastMonth);
    let lastDueDate = lastEntry.dueDate
      ? new Date(lastEntry.dueDate)
      : getDueDateForMonth(tenant, lastMonth);
    // Ensure lastDueDate is compared as UTC midnight (it should already be UTC)
    const lastDueTime = lastDueDate.getTime();

    // Only create next month if the last due date is strictly before today (in UTC)
    if (lastDueTime < todayTime) {
      // Use the reference-date rule to get the correct due date AND month
      const { dueDate: nextDueDate, month: newMonth } = getNextDueDateAndMonth(
        tenant,
        today
      );
      // Only add if that exact month doesn't already exist
      if (!tenant.paymentHistory.some((e) => e.month === newMonth)) {
        tenant.paymentHistory.push({
          month: newMonth,
          baseRent: tenant.rent,
          waterCharge: 0,
          garbageCharge: settings.garbageFee,
          totalDue: tenant.rent + settings.garbageFee,
          amountPaid: 0,
          remainingBalance: 0,
          paid: false,
          datePaid: null,
          dueDate: nextDueDate,
          mpesaRef: "",
        });
        await recalcFutureMonths(tenant, newMonth);
        await tenant.save();
      }
    }
  }
  console.log(`✅ Sync finished up to ${currentMonthStr} (UTC)`);
}

function getDueDateForMonth(tenantOrDueDay, yearMonth, referenceDate) {
  let dueDay;
  if (typeof tenantOrDueDay === "object") {
    dueDay = tenantOrDueDay.dueDay;
  } else {
    dueDay = tenantOrDueDay;
  }
  const [year, month] = yearMonth.split("-").map(Number);

  // If a reference date is provided, decide same‑month vs next‑month
  if (referenceDate) {
    const refDay = referenceDate.getUTCDate();
    // Before due day → same calendar month
    if (refDay < dueDay) {
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const day = Math.min(dueDay, lastDay);
      return new Date(Date.UTC(year, month - 1, day));
    }
  }

  // Default (no reference, or on/after due day): due date in the NEXT month
  let dueYear = year;
  let dueMonth = month + 1;
  if (dueMonth > 12) {
    dueMonth = 1;
    dueYear++;
  }
  const lastDay = new Date(Date.UTC(dueYear, dueMonth, 0)).getUTCDate();
  const day = Math.min(dueDay, lastDay);
  return new Date(Date.UTC(dueYear, dueMonth - 1, day));
}

async function getCurrentDate(req, res) {
  res.json({ currentDate: new Date().toISOString() });
}

function getCurrentMonthString(today) {
  const now = today || new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Returns { dueDate (UTC midnight), month (YYYY-MM) } for the NEXT billing month
 * based on a reference date (today or entry date).
 */
function getNextDueDateAndMonth(tenant, referenceDate) {
  const dueDay = tenant.dueDay;
  const y = referenceDate.getUTCFullYear();
  const m = referenceDate.getUTCMonth(); // 0‑11
  const d = referenceDate.getUTCDate();

  let dueYear = y;
  let dueMonth = m;

  if (d >= dueDay) {
    // Move to next month
    dueMonth++;
    if (dueMonth > 11) {
      dueMonth = 0;
      dueYear++;
    }
  }

  const lastDay = new Date(Date.UTC(dueYear, dueMonth + 1, 0)).getUTCDate();
  const finalDay = Math.min(dueDay, lastDay);
  const dueDate = new Date(Date.UTC(dueYear, dueMonth, finalDay));
  const month = `${dueYear}-${String(dueMonth + 1).padStart(2, "0")}`;

  return { dueDate, month };
}

function getEffectiveToday(req) {
  const devDateStr = req.headers["x-dev-date"];
  if (devDateStr) {
    const devDate = new Date(devDateStr);
    if (!isNaN(devDate.getTime())) {
      return new Date(
        Date.UTC(
          devDate.getUTCFullYear(),
          devDate.getUTCMonth(),
          devDate.getUTCDate()
        )
      );
    }
  }
  // fallback: real UTC midnight
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

function getNextMonthString(monthString) {
  let [year, month] = monthString.split("-").map(Number);
  let date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() + 1);
  let newYear = date.getFullYear();
  let newMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${newYear}-${newMonth}`;
}

function getPreviousMonthString(monthString) {
  let [year, month] = monthString.split("-").map(Number);
  let date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() - 1);
  let newYear = date.getFullYear();
  let newMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${newYear}-${newMonth}`;
}

function getNextMonthDueDate(tenant, yearMonth, referenceDate) {
  const dueDate = getDueDateForMonth(tenant, yearMonth, referenceDate);
  let year = dueDate.getUTCFullYear();
  let month = dueDate.getUTCMonth(); // 0‑11
  let day = dueDate.getUTCDate();

  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear++;
  }
  const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  const finalDay = Math.min(day, lastDay);
  return new Date(Date.UTC(nextYear, nextMonth, finalDay));
}

function getFirstFutureMonth(tenant, today) {
  if (!tenant.paymentHistory || tenant.paymentHistory.length === 0) return null;
  const todayUTC = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  );
  const months = [...new Set(tenant.paymentHistory.map((e) => e.month))].sort();
  for (const month of months) {
    const monthEntries = tenant.paymentHistory.filter((e) => e.month === month);
    monthEntries.sort((a, b) => {
      const aDate = a.datePaid ? new Date(a.datePaid).getTime() : 0;
      const bDate = b.datePaid ? new Date(b.datePaid).getTime() : 0;
      return aDate - bDate;
    });
    const latest = monthEntries[monthEntries.length - 1];
    if (!latest || !latest.dueDate) continue;
    const dueUTC = new Date(latest.dueDate);
    if (dueUTC > todayUTC) return month;
  }
  return null;
}

async function getGlobalSettings(userId) {
  let settings = await Settings.findById("global_" + userId); // ✅ FIXED: Settings.findById
  if (!settings) {
    settings = new Settings({
      _id: "global_" + userId,
      garbageFee: 0,
      waterRatePerUnit: 0,
      defaultDueDay: 1,
    });
    await settings.save();
  }
  return settings;
}
function getPreviousMeterReading(tenant, targetMonth) {
  const sorted = [...tenant.waterMeterReadings].sort((a, b) =>
    a.month.localeCompare(b.month)
  );
  const targetIndex = sorted.findIndex((r) => r.month === targetMonth);
  if (targetIndex > 0) {
    return sorted[targetIndex - 1].reading;
  }
  return 0;
}

// ========================
//   CORE RECALCULATION
// ========================
async function recalcFutureMonths(tenant, changedMonth) {
  const allEntries = tenant.paymentHistory.sort((a, b) => {
    if (a.month !== b.month) return a.month.localeCompare(b.month);
    const aDate = a.datePaid ? new Date(a.datePaid).getTime() : 0;
    const bDate = b.datePaid ? new Date(b.datePaid).getTime() : 0;
    return aDate - bDate;
  });

  if (allEntries.length === 0) return;

  const monthMap = new Map();
  for (const entry of allEntries) {
    if (!monthMap.has(entry.month)) monthMap.set(entry.month, []);
    monthMap.get(entry.month).push(entry);
  }

  const months = [...monthMap.keys()].sort();
  let runningBalance = 0;
  const settings = await getGlobalSettings(tenant.userId);
  const firstMonth = months[0];
  const [firstYear, firstMonthNum] = firstMonth.split("-").map(Number);

  for (const month of months) {
    const entries = monthMap.get(month);
    const [year, mon] = month.split("-").map(Number);
    const monthDiff = (year - firstYear) * 12 + (mon - firstMonthNum);
    const isBeforeChanged = month < changedMonth;

    // ---------- 1) Charges ----------
    let depositExtra = 0;
    if (
      tenant.deposit &&
      tenant.depositPeriod &&
      monthDiff < tenant.depositPeriod
    ) {
      depositExtra = Math.round(tenant.rent / tenant.depositPeriod);
    }
    const baseRent = tenant.rent + depositExtra;

    let waterCharge = 0;
    const meterReading = tenant.waterMeterReadings.find(
      (r) => r.month === month
    );
    if (meterReading) {
      const prevReading = getPreviousMeterReading(tenant, month);
      const unitsUsed = meterReading.reading - prevReading;
      meterReading.unitsUsed = unitsUsed;
      const rate = meterReading.rate || settings.waterRatePerUnit || 0;
      meterReading.cost = unitsUsed * rate;
      waterCharge = meterReading.cost;
      tenant.markModified("waterMeterReadings");
    }

    const garbageCharge = settings.garbageFee;
    const totalDue = baseRent + waterCharge + garbageCharge;

    // ---------- 2) Update charge fields (but NOT due date) for months >= changedMonth ----------
    if (!isBeforeChanged) {
      for (const entry of entries) {
        entry.baseRent = baseRent;
        entry.waterCharge = waterCharge;
        entry.garbageCharge = garbageCharge;
        entry.totalDue = totalDue;
        // ❗ do NOT update dueDate – it stays as originally created
      }
    }

    // ---------- 3) Running balance ----------
    const chargeEntry = entries.find(
      (e) => (e.amountPaid || 0) === 0 && !e.datePaid
    );
    if (chargeEntry) {
      const tDue = isBeforeChanged
        ? chargeEntry.totalDue || totalDue
        : totalDue;
      if (month === months[0]) {
        runningBalance = tDue;
      } else {
        runningBalance += tDue;
      }
    }

    // ---------- 4) Subtract payments ----------
    const paymentEntries = entries.filter((e) => (e.amountPaid || 0) > 0);
    for (const payment of paymentEntries) {
      runningBalance -= payment.amountPaid;
      payment.remainingBalance = runningBalance;
      payment.paid = runningBalance <= 0;
      if (payment.paid && !payment.datePaid) {
        payment.datePaid = new Date().toISOString();
      }
    }

    // ---------- 5) Charge entry balance ----------
    if (chargeEntry) {
      chargeEntry.remainingBalance = runningBalance;
      chargeEntry.paid = runningBalance <= 0;
    }
  }
}
// ========================
//   CONTROLLER FUNCTIONS
// ========================

async function getAllTenants(req, res) {
  try {
    const { archived } = req.query;
    let filter = { userId: req.userId };
    if (archived === "true") {
      filter.active = false;
    } else {
      filter.active = true;
    }
    let result = await Tenant.find(filter);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
async function restoreTenant(req, res) {
  try {
    const { id } = req.params;
    const tenant = await Tenant.findOne({ _id: id, userId: req.userId });
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });
    tenant.active = true;
    await tenant.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function permanentlyDeleteTenant(req, res) {
  try {
    const { id } = req.params;
    const tenant = await Tenant.findOne({ _id: id, userId: req.userId });
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });
    await tenant.deleteOne();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getExportStatement(req, res) {
  try {
    const { type } = req.query; // 'all' or 'late'
    let tenants = await Tenant.find({ userId: req.userId, active: true });
    tenants.forEach((t) => {
      if (!t.paymentHistory) t.paymentHistory = [];
    });
    // ---------- Today's date (dev‑aware) – convert to UTC midnight ----------
    let today;
    if (req.query.devDate) {
      const devDate = new Date(req.query.devDate);
      if (!isNaN(devDate.getTime())) {
        today = new Date(
          Date.UTC(
            devDate.getUTCFullYear(),
            devDate.getUTCMonth(),
            devDate.getUTCDate()
          )
        );
      }
    }
    if (!today) {
      const now = new Date();
      today = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      );
    }
    const todayUTC = new Date(
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    );
    const todayStr = `${todayUTC.getUTCFullYear()}-${String(
      todayUTC.getUTCMonth() + 1
    ).padStart(2, "0")}-${String(todayUTC.getUTCDate()).padStart(2, "0")}`;

    const settings = await getGlobalSettings(req.userId);
    const garbageFee = settings.garbageFee || 0;

    // ---------- Helper: get the current billing month (the month whose due date is ≥ today) ----------
    function getCurrentBillingMonth(tenant) {
      const months = [
        ...new Set(tenant.paymentHistory.map((e) => e.month)),
      ].sort();
      if (months.length === 0) return getCurrentMonthString();
      for (let month of months) {
        const entry = tenant.paymentHistory.find((e) => e.month === month);
        if (!entry || !entry.dueDate) continue;
        const dueUTC = new Date(entry.dueDate);
        const dueStr = `${dueUTC.getUTCFullYear()}-${String(
          dueUTC.getUTCMonth() + 1
        ).padStart(2, "0")}-${String(dueUTC.getUTCDate()).padStart(2, "0")}`;
        if (dueStr >= todayStr) return month;
      }
      return months[months.length - 1];
    }

    // ---------- Helper: expected total for a given billing month (rent + water + garbage + deposit) ----------
    function getExpectedForMonth(tenant, month) {
      const chargeEntry = tenant.paymentHistory.find(
        (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
      );
      if (chargeEntry) return chargeEntry.totalDue || 0;
      // Fallback (should rarely happen)
      let depositExtra = 0;
      if (tenant.deposit && tenant.depositPeriod) {
        const firstMonth = tenant.paymentHistory.map((e) => e.month).sort()[0];
        if (firstMonth) {
          const [fy, fm] = firstMonth.split("-").map(Number);
          const endDate = new Date(fy, fm - 1 + tenant.depositPeriod - 1, 1);
          const lastDepMonth = `${endDate.getFullYear()}-${String(
            endDate.getMonth() + 1
          ).padStart(2, "0")}`;
          if (month <= lastDepMonth)
            depositExtra = Math.round(tenant.rent / tenant.depositPeriod);
        }
      }
      const baseRent = tenant.rent + depositExtra;
      const waterCharge =
        tenant.waterMeterReadings?.find((r) => r.month === month)?.cost || 0;
      return baseRent + waterCharge + garbageFee;
    }

    // ---------- Helper: collected amount for a given billing month ----------
    function getCollectedForMonth(tenant, month) {
      return tenant.paymentHistory
        .filter((e) => e.month === month && e.amountPaid > 0)
        .reduce((sum, e) => sum + e.amountPaid, 0);
    }

    // ---------- Helper: overdue balance (past months only) ----------
    function getPastDueAmount(tenant) {
      if (!tenant.paymentHistory || tenant.paymentHistory.length === 0)
        return 0;
      const todayUTC = new Date(
        Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
      );
      const todayStr = `${todayUTC.getUTCFullYear()}-${String(
        todayUTC.getUTCMonth() + 1
      ).padStart(2, "0")}-${String(todayUTC.getUTCDate()).padStart(2, "0")}`;
      const months = [
        ...new Set(tenant.paymentHistory.map((e) => e.month)),
      ].sort();
      let lastPastBalance = 0;
      for (const month of months) {
        const monthEntries = tenant.paymentHistory.filter(
          (e) => e.month === month
        );
        monthEntries.sort((a, b) => {
          const aDate = a.datePaid ? new Date(a.datePaid).getTime() : 0;
          const bDate = b.datePaid ? new Date(b.datePaid).getTime() : 0;
          return aDate - bDate;
        });
        const latest = monthEntries[monthEntries.length - 1];
        if (!latest || !latest.dueDate) continue;
        const dueUTC = new Date(latest.dueDate);
        const dueStr = `${dueUTC.getUTCFullYear()}-${String(
          dueUTC.getUTCMonth() + 1
        ).padStart(2, "0")}-${String(dueUTC.getUTCDate()).padStart(2, "0")}`;
        if (dueStr < todayStr) {
          lastPastBalance = latest.remainingBalance;
        } else {
          break; // stop at the first month that is not past due
        }
      }
      return lastPastBalance < 0 ? 0 : lastPastBalance;
    }
    // ---------- Build stats per tenant ----------
    const tenantStats = [];
    for (let tenant of tenants) {
      const currentMonth = getCurrentBillingMonth(tenant);
      const expected = getExpectedForMonth(tenant, currentMonth);
      const collected = getCollectedForMonth(tenant, currentMonth);
      const overdue = getPastDueAmount(tenant);
      // For "late" export, only include tenants with overdue > 0
      if (type === "late" && overdue === 0) continue;
      tenantStats.push({ tenant, currentMonth, expected, collected, overdue });
    }

    // Sort by house number (natural numeric)
    tenantStats.sort((a, b) => {
      const ha = a.tenant.houseNumber || "";
      const hb = b.tenant.houseNumber || "";
      return ha.localeCompare(hb, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    // ---------- Totals for the summary cards ----------
    let totalOwed = 0,
      totalExpected = 0,
      totalCollected = 0;
    for (let ts of tenantStats) {
      totalOwed += ts.overdue;
      totalExpected += ts.expected;
      totalCollected += ts.collected;
    }

    // ---------- User / landlord info ----------
    const user = await User.findById(req.userId);
    const landlordDisplay = user.landlordName || user.name || "Landlord";
    const todayDateStr = today.toLocaleDateString();

    // ---------- Generate HTML with four cards ----------
    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${type === "late" ? "Late Tenants Report" : "Tenant Roster"}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #1e293b; background:#ffffff; }
    .header { text-align:center; margin-bottom: 40px; }
    .header h1 { font-size:2.5rem; font-weight:800; color:#0f172a; margin-bottom:5px; letter-spacing:-0.5px; }
    .header p { color:#475569; font-size:1rem; font-weight:400; }

    .summary-box { display:flex; justify-content:center; gap:25px; margin:30px 0; flex-wrap:wrap; }
    .summary-item { background:#f8fafc; border-radius:16px; padding:20px 32px; text-align:center;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05); border:1px solid #e2e8f0; min-width:120px; }
    .summary-item .label { font-size:0.75rem; text-transform:uppercase; letter-spacing:1.5px; color:#64748b; margin-bottom:8px; }
    .summary-item .value { font-size:2.2rem; font-weight:700; color:#0f172a; }
    .summary-item .value.owed { color:#dc2626; }
    .summary-item .value.collected { color:#16a34a; }

    table { width:100%; border-collapse:collapse; margin-top:20px; border-radius:12px; overflow:hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.04); border:1px solid #e2e8f0; }
    th, td { text-align:center !important; }
    th { background:#f1f5f9; text-transform:uppercase; font-size:0.75rem; letter-spacing:0.5px; color:#475569;
         padding:12px 8px; font-weight:600; }
    td { padding:12px 8px; font-size:0.9rem; border-bottom:1px solid #f1f5f9; color:#334155; }
    tr:last-child td { border-bottom:none; }
    tr:nth-child(even) td { background:#f8fafc; }

    .status-badge { display:inline-block; padding:4px 12px; border-radius:20px; font-size:0.7rem; font-weight:600; }
    .status-paid { background:#dcfce7; color:#16a34a; }
    .status-unpaid { background:#fee2e2; color:#dc2626; }
    .status-overpaid { background:#dbeafe; color:#2563eb; }

    .deposit-badge { font-size:0.7rem; color:#b45309; display:block; }
    .balance-red { color:#dc2626; font-weight:700; }
    .balance-green { color:#16a34a; font-weight:700; }

    .print-btn { margin-top:35px; text-align:right; }
    .print-btn button { background:#0f172a; color:white; border:none; padding:12px 28px; border-radius:8px;
                       font-size:0.9rem; font-weight:600; cursor:pointer; transition:0.2s; }
    .print-btn button:hover { background:#1e293b; }
    @media print { .print-btn { display:none; } body { padding:20px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${landlordDisplay}</h1>
    <p>${
      type === "late" ? "Late Tenants Report" : "Complete Tenant Roster"
    } – ${todayDateStr}</p>
  </div>

  <div class="summary-box">
`;

    if (type === "late") {
      html += `
    <div class="summary-item">
      <div class="label">Total Past Due</div>
      <div class="value owed">KSH ${totalOwed.toLocaleString()}</div>
    </div>
    <div class="summary-item">
      <div class="label">Late Tenants</div>
      <div class="value">${tenantStats.length}</div>
    </div>
      `;
    } else {
      html += `
    <div class="summary-item">
      <div class="label">Total Past Due</div>
      <div class="value owed">KSH ${totalOwed.toLocaleString()}</div>
    </div>
    <div class="summary-item">
      <div class="label">Collected This Billing Month</div>
      <div class="value collected">KSH ${totalCollected.toLocaleString()}</div>
    </div>
    <div class="summary-item">
      <div class="label">Expected This Billing Month</div>
      <div class="value">KSH ${totalExpected.toLocaleString()}</div>
    </div>
    <div class="summary-item">
      <div class="label">Active Tenants</div>
      <div class="value">${tenantStats.length}</div>
    </div>
      `;
    }

    html += `
  </div>

  <table>
    <thead>
      <tr>
        <th>Tenant</th>
        <th>House</th>
        <th>Phone</th>
        <th>Rent</th>
        <th>${type === "late" ? "Past Due" : "Past Due (Overdue)"}</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
`;

    for (let ts of tenantStats) {
      const tenant = ts.tenant;
      const overdue = ts.overdue;
      const statusText = overdue > 0 ? "Unpaid" : "Paid";
      const statusClass = overdue > 0 ? "status-unpaid" : "status-paid";

      // Deposit badge (if applicable)
      let depositBadge = "";
      if (tenant.deposit && tenant.depositPeriod) {
        const firstMonth = tenant.paymentHistory.map((e) => e.month).sort()[0];
        if (firstMonth) {
          const [fy, fm] = firstMonth.split("-").map(Number);
          const endDate = new Date(fy, fm - 1 + tenant.depositPeriod - 1, 1);
          const lastDepMonth = `${endDate.getFullYear()}-${String(
            endDate.getMonth() + 1
          ).padStart(2, "0")}`;
          const todayMonth = `${today.getFullYear()}-${String(
            today.getMonth() + 1
          ).padStart(2, "0")}`;
          if (todayMonth <= lastDepMonth)
            depositBadge = '<br><span class="deposit-badge">+Deposit</span>';
        }
      }

      const balanceCellClass = overdue > 0 ? "balance-red" : "balance-green";

      html += `
        <tr>
          <td style="font-weight:600;">${tenant.name}</td>
          <td>${tenant.houseNumber}</td>
          <td>${tenant.phoneNumber}</td>
          <td>KSH ${tenant.rent.toLocaleString()}${depositBadge}</td>
          <td class="${balanceCellClass}">KSH ${overdue.toLocaleString()}</td>
          <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        </tr>
      `;
    }

    html += `
    </tbody>
  </table>

  <div class="print-btn">
    <button onclick="window.print()">🖨️ Print / Save as PDF</button>
  </div>
</body>
</html>`;

    res.send(html);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getTenantById(req, res) {
  try {
    let id = req.params.id;
    let matchingTenant = await Tenant.findById(id);
    if (!matchingTenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }
    if (matchingTenant.userId.toString() !== req.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    res.json(matchingTenant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateMeterReading(req, res) {
  try {
    const { id, readingId } = req.params;
    const { reading } = req.body;

    const tenant = await Tenant.findOne({ _id: id, userId: req.userId });
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const meterReading = tenant.waterMeterReadings.id(readingId);
    if (!meterReading)
      return res.status(404).json({ message: "Meter reading not found" });

    const prevReading = getPreviousMeterReading(tenant, meterReading.month);
    if (reading < prevReading) {
      return res
        .status(400)
        .json({ message: "Reading cannot be less than previous reading" });
    }

    meterReading.reading = reading;
    const unitsUsed = meterReading.reading - prevReading;
    meterReading.unitsUsed = unitsUsed;
    meterReading.cost = unitsUsed * meterReading.rate;

    await tenant.save();
    await recalcFutureMonths(tenant, meterReading.month);
    await tenant.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updatePaymentEntry(req, res) {
  try {
    const { id, entryId } = req.params;
    const { amountPaid, datePaid, mpesaRef } = req.body;
    const tenant = await Tenant.findOne({ _id: id, userId: req.userId });
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const entry = tenant.paymentHistory.id(entryId);
    if (!entry)
      return res.status(404).json({ message: "Payment entry not found" });

    if ((entry.amountPaid || 0) === 0 && !entry.datePaid) {
      return res.status(400).json({
        message: "Cannot edit the system charge entry for this month.",
      });
    }

    const newAmount = Number(amountPaid);
    if (isNaN(newAmount) || newAmount < 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    entry.amountPaid = newAmount;
    if (datePaid !== undefined) entry.datePaid = datePaid || null;
    if (mpesaRef !== undefined) entry.mpesaRef = mpesaRef;

    await recalcFutureMonths(tenant, entry.month);
    tenant.markModified("paymentHistory");
    await tenant.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updatePaymentHistory(req, res) {
  try {
    const { id } = req.params;
    const { amountPaid, datePaid, mpesaRef } = req.body;
    const tenant = await Tenant.findOne({ _id: id, userId: req.userId });
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    let remaining = Number(amountPaid);
    if (isNaN(remaining) || remaining < 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const today = getEffectiveToday(req);
    const currentMonth = getCurrentMonthString(today);

    // ----- Build a map of the charge entry for each month (once) -----
    const chargeByMonth = new Map();
    for (const entry of tenant.paymentHistory) {
      if ((entry.amountPaid || 0) === 0 && !entry.datePaid) {
        chargeByMonth.set(entry.month, entry);
      }
    }

    // ----- Compute already paid per month -----
    const paidByMonth = new Map();
    for (const entry of tenant.paymentHistory) {
      if (entry.amountPaid > 0) {
        const prev = paidByMonth.get(entry.month) || 0;
        paidByMonth.set(entry.month, prev + entry.amountPaid);
      }
    }

    const allMonths = [
      ...new Set(tenant.paymentHistory.map((e) => e.month)),
    ].sort();
    let earliestChangedMonth = null;

    // ----- 1. Pay past‑due & current months (only the missing amount per month) -----
    for (const month of allMonths) {
      if (remaining <= 0) break;

      const charge = chargeByMonth.get(month);
      if (!charge || !charge.dueDate) continue;
      const due = new Date(charge.dueDate);
      if (!(due < today || month === currentMonth)) continue;

      const totalDue =
        charge.totalDue ||
        (charge.baseRent || 0) +
          (charge.waterCharge || 0) +
          (charge.garbageCharge || 0);
      const alreadyPaid = paidByMonth.get(month) || 0;
      const needed = totalDue - alreadyPaid;
      if (needed <= 0) continue;

      const pay = Math.min(needed, remaining);
      remaining -= pay;

      tenant.paymentHistory.push({
        month: month,
        amountPaid: pay,
        remainingBalance: 0, // placeholder, recalc will fix
        paid: false,
        datePaid: datePaid || null,
        dueDate: charge.dueDate,
        mpesaRef: mpesaRef || "",
      });
      if (!earliestChangedMonth || month < earliestChangedMonth) {
        earliestChangedMonth = month;
      }
      paidByMonth.set(month, alreadyPaid + pay);
    }

    // ----- 2. Pay future months (months > currentMonth) -----
    const futureMonths = allMonths.filter((m) => m > currentMonth);
    for (const month of futureMonths) {
      if (remaining <= 0) break;

      const charge = chargeByMonth.get(month);
      if (!charge || !charge.dueDate) continue;

      const totalDue =
        charge.totalDue ||
        (charge.baseRent || 0) +
          (charge.waterCharge || 0) +
          (charge.garbageCharge || 0);
      const alreadyPaid = paidByMonth.get(month) || 0;
      const needed = totalDue - alreadyPaid;
      if (needed <= 0) continue;

      const pay = Math.min(needed, remaining);
      remaining -= pay;

      tenant.paymentHistory.push({
        month: month,
        amountPaid: pay,
        remainingBalance: 0,
        paid: false,
        datePaid: datePaid || null,
        dueDate: charge.dueDate,
        mpesaRef: mpesaRef || "",
      });
      if (!earliestChangedMonth || month < earliestChangedMonth) {
        earliestChangedMonth = month;
      }
      paidByMonth.set(month, alreadyPaid + pay);
    }

    // ----- 3. Overpayment: always create a NEW row in the LAST future month (or current if none) -----
    if (remaining > 0) {
      const targetMonth =
        futureMonths.length > 0
          ? futureMonths[futureMonths.length - 1]
          : currentMonth;
      const chargeEntry = chargeByMonth.get(targetMonth);
      const dueDateForTarget = chargeEntry
        ? chargeEntry.dueDate
        : getDueDateForMonth(tenant, targetMonth, today);

      // Always push a fresh payment entry – never merge with an existing one
      tenant.paymentHistory.push({
        month: targetMonth,
        amountPaid: remaining,
        remainingBalance: 0, // placeholder, recalc will fix
        paid: false,
        datePaid: datePaid || null,
        dueDate: dueDateForTarget,
        mpesaRef: mpesaRef || "",
      });
      if (!earliestChangedMonth || targetMonth < earliestChangedMonth) {
        earliestChangedMonth = targetMonth;
      }
    }

    if (earliestChangedMonth) {
      await recalcFutureMonths(tenant, earliestChangedMonth);
      tenant.markModified("paymentHistory");
    }
    await tenant.save();
    res.json({ success: true, paymentHistory: tenant.paymentHistory });
  } catch (error) {
    console.error("updatePaymentHistory error:", error);
    res.status(500).json({ message: error.message });
  }
}
async function bulkMarkPaid(req, res) {
  try {
    const { tenantIds } = req.body;
    let query = { userId: req.userId };
    if (tenantIds?.length) query._id = { $in: tenantIds };
    const tenants = await Tenant.find(query);

    for (let tenant of tenants) {
      // Calculate total debt (same logic as distributePayment)
      const latestByMonth = new Map();
      for (let entry of tenant.paymentHistory) {
        const existing = latestByMonth.get(entry.month);
        if (!existing) {
          latestByMonth.set(entry.month, entry);
        } else {
          const aDate = entry.datePaid ? new Date(entry.datePaid).getTime() : 0;
          const bDate = existing.datePaid
            ? new Date(existing.datePaid).getTime()
            : 0;
          if (
            aDate > bDate ||
            (aDate === bDate && entry._id.toString() > existing._id.toString())
          ) {
            latestByMonth.set(entry.month, entry);
          }
        }
      }

      let totalDebt = 0;
      for (let entry of latestByMonth.values()) {
        if (entry.remainingBalance > 0) totalDebt += entry.remainingBalance;
      }

      if (totalDebt > 0) {
        // Use the same distribution logic as a single payment
        let remaining = totalDebt;
        const sortedMonths = [...latestByMonth.keys()].sort((a, b) =>
          a.localeCompare(b)
        );
        let earliestChanged = null;

        for (let month of sortedMonths) {
          if (remaining <= 0) break;
          const latestEntry = latestByMonth.get(month);
          if (latestEntry.remainingBalance > 0) {
            const pay = Math.min(latestEntry.remainingBalance, remaining);
            remaining -= pay;

            tenant.paymentHistory.push({
              month: latestEntry.month,
              amountPaid: pay,
              remainingBalance: 0,
              paid: false,
              datePaid: new Date().toISOString(),
              dueDate: latestEntry.dueDate,
              mpesaRef: "",
            });

            if (!earliestChanged || month < earliestChanged) {
              earliestChanged = month;
            }
          }
        }

        if (earliestChanged) {
          await recalcFutureMonths(tenant, earliestChanged);
        }
        await tenant.save();
      }
    }

    res.json({ success: true, count: tenants.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function createTenant(req, res) {
  try {
    let {
      name,
      rent,
      entryDate,
      dueDay,
      phoneNumber,
      houseNumber,
      notes,
      depositPeriod,
    } = req.body;
    let userId = req.userId;

    if (!name) return res.status(400).json({ message: "Name is required." });
    const rentNum = Number(rent);
    if (!rentNum || rentNum <= 0 || isNaN(rentNum)) {
      return res.status(400).json({ message: "Rent is required." });
    }
    if (!phoneNumber)
      return res.status(400).json({ message: "Phone number is required." });
    if (!houseNumber)
      return res.status(400).json({ message: "House number required." });

    const phoneDigits = phoneNumber.toString().replace(/\D/g, "");
    if (phoneDigits.length < 9 || phoneDigits.length > 12) {
      return res.status(400).json({
        message:
          "Phone number must have between 9 and 12 digits (e.g., 0712345678 or 254712345678).",
      });
    }

    // Fallback to global default due day if not provided
    const settings = await getGlobalSettings(req.userId);

    let dueDayNum = Number(dueDay);
    if (!dueDayNum || dueDayNum < 1 || dueDayNum > 31 || isNaN(dueDayNum)) {
      dueDayNum = settings.defaultDueDay;
      if (!dueDayNum || dueDayNum < 1 || dueDayNum > 31) {
        return res.status(400).json({
          message:
            "No due day provided and no valid default due day set in Global Settings. Please set a due day or configure default due day.",
        });
      }
    }

    const existing = await Tenant.findOne({
      userId,
      $or: [{ houseNumber }, { name }],
    });
    if (existing) {
      if (existing.houseNumber === houseNumber) {
        return res
          .status(400)
          .json({ message: "A tenant with this house number already exists." });
      }
      if (existing.name === name) {
        return res
          .status(400)
          .json({ message: "A tenant with this name already exists." });
      }
    }

    // ─────────────────────────────────────────────────────────
    // First month due date logic (same rule as the sync)
    const today = getEffectiveToday(req);
    const entryDateObj = entryDate ? new Date(entryDate) : today;
    entryDateObj.setHours(0, 0, 0, 0);

    // Use the later of today and entry date as the reference
    const referenceDate = entryDateObj > today ? entryDateObj : today;
    const { dueDate: computedDueDate, month: startMonth } =
      getNextDueDateAndMonth({ dueDay: dueDayNum }, referenceDate);
    // ─────────────────────────────────────────────────────────

    // Deposit logic
    const depPeriod = depositPeriod !== undefined ? Number(depositPeriod) : 1;
    const deposit = depPeriod > 0;
    const depositInstalment = deposit ? Math.round(rentNum / depPeriod) : 0;
    const baseRent = rentNum;
    const waterCharge = 0;
    const garbageCharge = settings.garbageFee;
    const totalDue = baseRent + depositInstalment + waterCharge + garbageCharge;

    const newTenant = new Tenant({
      userId,
      name,
      rent: rentNum,
      houseNumber,
      notes,
      phoneNumber,
      entryDate: entryDate || new Date(),
      dueDay: dueDayNum,
      deposit,
      depositPeriod: depPeriod,
      paymentHistory: [
        {
          amountPaid: 0,
          remainingBalance: totalDue,
          month: startMonth,
          paid: false,
          datePaid: null,
          dueDate: computedDueDate,
          baseRent: baseRent + depositInstalment, // increased rent for this month
          waterCharge,
          garbageCharge,
          totalDue,
          mpesaRef: "",
        },
      ],
    });
    console.log(
      `[createTenant] startMonth=${startMonth}, computedDueDate=${computedDueDate.toISOString()}`
    );
    console.log(
      `[CREATE TENANT] startMonth=${startMonth}, computedDueDate=${computedDueDate.toISOString()}`
    );
    await newTenant.save();
    res.status(201).json(newTenant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
async function deletePaymentRecord(req, res) {
  try {
    const { id, entryId } = req.params;
    const tenant = await Tenant.findOne({ _id: id, userId: req.userId });
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const entry = tenant.paymentHistory.id(entryId);
    if (!entry)
      return res.status(404).json({ message: "Payment entry not found" });

    if ((entry.amountPaid || 0) === 0 && !entry.datePaid) {
      return res.status(400).json({
        message: "Cannot delete the system charge entry for this month.",
      });
    }

    const month = entry.month;
    entry.deleteOne();
    await recalcFutureMonths(tenant, month);
    tenant.markModified("paymentHistory");
    await tenant.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateTenant(req, res) {
  try {
    const id = req.params.id;
    const existing = await Tenant.findOne({ _id: id, userId: req.userId });
    if (!existing) return res.status(404).json({ message: "Tenant not found" });

    // Duplicate name/house check
    if (req.body.name || req.body.houseNumber) {
      const duplicateCheck = await Tenant.findOne({
        userId: req.userId,
        _id: { $ne: id },
        $or: [
          { name: req.body.name || existing.name },
          { houseNumber: req.body.houseNumber || existing.houseNumber },
        ],
      });
      if (duplicateCheck) {
        if (duplicateCheck.houseNumber === req.body.houseNumber) {
          return res.status(400).json({
            message: "Another tenant already uses this house number.",
          });
        }
        if (duplicateCheck.name === req.body.name) {
          return res
            .status(400)
            .json({ message: "Another tenant already has this name." });
        }
      }
    }

    const rentChanged = req.body.rent && req.body.rent !== existing.rent;
    const dueDayChanged =
      req.body.dueDay && req.body.dueDay !== existing.dueDay;

    // Apply allowed updates
    const allowedUpdates = [
      "name",
      "rent",
      "phoneNumber",
      "houseNumber",
      "notes",
      "entryDate",
      "dueDay",
    ];
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        existing[field] = req.body[field];
      }
    });
    await existing.save();

    // If rent or due day changed, recalc ONLY future months (dev‑date aware)
    if (rentChanged || dueDayChanged) {
      const today = getEffectiveToday(req); // respects X-Dev-Date if present
      const startMonth = getFirstFutureMonth(existing, today);
      if (startMonth) {
        // only if there’s at least one month still in the future
        await recalcFutureMonths(existing, startMonth);
        existing.markModified("paymentHistory");
        await existing.save();
      }
    }

    res.json(existing);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// ❌ REMOVED resetMonth – deprecated

async function getPaymentStatusByMonth(req, res) {
  try {
    let month = req.params.month;
    let allTenants = await Tenant.find({ userId: req.userId });
    if (!allTenants)
      return res.status(404).json({ message: "No tenants found" });

    let result = allTenants.map((tenant) => {
      let foundRecord = tenant.paymentHistory.find((r) => r.month === month);
      return {
        name: tenant.name,
        paid: foundRecord ? foundRecord.paid : false,
      };
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function archiveTenant(req, res) {
  try {
    let id = req.params.id;
    let tenant = await Tenant.findOne({ _id: id, userId: req.userId });
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });
    tenant.active = false;
    await tenant.save();
    res.json({ message: "Tenant archived successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// ========================
//   UTILITY ENDPOINTS
// ========================
async function addMeterReading(req, res) {
  try {
    const { id } = req.params;
    const { month, reading } = req.body;

    const tenant = await Tenant.findOne({ _id: id, userId: req.userId });
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    // Find the latest reading before the given month
    const allReadings = [...(tenant.waterMeterReadings || [])].sort((a, b) =>
      a.month.localeCompare(b.month)
    );
    let prevReading = 0;
    for (const r of allReadings) {
      if (r.month < month) prevReading = r.reading;
      else break;
    }

    if (reading < prevReading) {
      return res
        .status(400)
        .json({ message: "Reading cannot be less than previous reading" });
    }

    const settings = await getGlobalSettings(tenant.userId);
    const rate = settings.waterRatePerUnit;

    let existing = tenant.waterMeterReadings.find((r) => r.month === month);
    if (existing) {
      existing.reading = reading;
      existing.rate = rate;
    } else {
      tenant.waterMeterReadings.push({ month, reading, rate });
    }

    await tenant.save();
    await recalcFutureMonths(tenant, month);
    await tenant.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// ❌ REMOVED updateTenantUtilities – no longer needed

// ========================
//   GLOBAL SETTINGS ENDPOINTS
// ========================
async function getGlobalSettingsEndpoint(req, res) {
  try {
    const settings = await getGlobalSettings(req.userId);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateGlobalSettings(req, res) {
  try {
    const { garbageFee, waterRatePerUnit, defaultDueDay } = req.body;
    let settings = await Settings.findById("global_" + req.userId); // ✅ FIXED
    if (req.body.reminderTemplate !== undefined)
      settings.reminderTemplate = req.body.reminderTemplate;
    if (!settings) settings = new Settings({ _id: "global_" + req.userId });
    if (req.body.autoRemindersEnabled !== undefined)
      settings.autoRemindersEnabled = req.body.autoRemindersEnabled;
    if (garbageFee !== undefined) settings.garbageFee = garbageFee;
    if (waterRatePerUnit !== undefined)
      settings.waterRatePerUnit = waterRatePerUnit;
    if (defaultDueDay !== undefined) settings.defaultDueDay = defaultDueDay;
    if (req.body.totalHouses !== undefined)
      settings.totalHouses = Number(req.body.totalHouses);

    await settings.save();

    // ---- Immediately update all active tenants with the new charges ----
    const tenants = await Tenant.find({ userId: req.userId, active: true });
    const today = getEffectiveToday(req); // ✅ use dev‑aware today
    for (let tenant of tenants) {
      const startMonth = getFirstFutureMonth(tenant, today);
      if (startMonth) {
        await recalcFutureMonths(tenant, startMonth);
        tenant.markModified("paymentHistory");
        await tenant.save();
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function importTenants(req, res) {
  try {
    const { tenants } = req.body;
    const userId = req.userId;
    const today = getEffectiveToday(req);
    const currentMonth = getCurrentMonthString(today);
    const settings = await getGlobalSettings(req.userId);

    if (!Array.isArray(tenants) || tenants.length === 0) {
      return res.status(400).json({ message: "No tenants provided" });
    }

    const created = [];
    const errors = [];

    for (const t of tenants) {
      // --- Basic required fields ---
      if (!t.name || !t.phoneNumber || !t.houseNumber || !t.rent) {
        errors.push(
          `Skipped row: missing required fields - ${JSON.stringify(t)}`
        );
        continue;
      }

      // --- Phone number validation ---
      const phoneDigits = t.phoneNumber.toString().replace(/\D/g, "");
      if (phoneDigits.length < 9 || phoneDigits.length > 12) {
        errors.push(`Skipped ${t.name}: invalid phone number`);
        continue;
      }

      const rentNum = Number(t.rent);
      if (isNaN(rentNum) || rentNum <= 0) {
        errors.push(`Skipped ${t.name}: invalid rent`);
        continue;
      }

      // Duplicate check
      const existing = await Tenant.findOne({
        userId,
        $or: [{ houseNumber: t.houseNumber }, { name: t.name }],
      });
      if (existing) {
        errors.push(`Skipped ${t.name}: duplicate name or house number`);
        continue;
      }

      // ----- dueDay – directly from CSV, fallback to global default -----
      let dueDayNum = settings.defaultDueDay || 1;
      if (t.dueDay !== undefined && t.dueDay !== "") {
        const parsed = parseInt(t.dueDay);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 31) {
          dueDayNum = parsed;
        }
      }

      // ----- Deposit logic -----
      let deposit = false;
      let depositPeriod = 1;
      if (t.depositPeriod !== undefined && t.depositPeriod !== "") {
        const period = parseInt(t.depositPeriod);
        if (!isNaN(period) && period > 0) {
          deposit = true;
          depositPeriod = period;
        }
      }

      const entryDate = t.entryDate ? new Date(t.entryDate) : new Date();
      const depositInstalment = deposit
        ? Math.round(rentNum / depositPeriod)
        : 0;
      const baseRent = rentNum;
      const waterCharge = 0;
      const garbageCharge = settings.garbageFee;
      const totalDue =
        baseRent + depositInstalment + waterCharge + garbageCharge;

      const newTenant = new Tenant({
        userId,
        name: t.name,
        rent: rentNum,
        phoneNumber: t.phoneNumber,
        houseNumber: t.houseNumber,
        notes: t.notes || "",
        entryDate,
        dueDay: dueDayNum,
        deposit,
        depositPeriod,
        active: true,
        paymentHistory: [
          {
            month: currentMonth,
            baseRent: baseRent + depositInstalment,
            waterCharge,
            garbageCharge,
            totalDue,
            amountPaid: 0,
            remainingBalance: totalDue,
            paid: false,
            datePaid: null,
            dueDate: getDueDateForMonth(dueDayNum, currentMonth),
            mpesaRef: "",
          },
        ],
      });

      await newTenant.save();
      created.push(newTenant);
    }

    res.json({
      success: true,
      created: created.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getArchivedCount(req, res) {
  try {
    const count = await Tenant.countDocuments({
      userId: req.userId,
      active: false,
    });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function deleteMeterReading(req, res) {
  try {
    const { id, readingId } = req.params;
    const tenant = await Tenant.findOne({ _id: id, userId: req.userId });
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const readingIndex = tenant.waterMeterReadings.findIndex(
      (r) => r._id.toString() === readingId
    );
    if (readingIndex === -1)
      return res.status(404).json({ message: "Reading not found" });

    const readingMonth = tenant.waterMeterReadings[readingIndex].month;
    tenant.waterMeterReadings.splice(readingIndex, 1);

    // Recalculate future months (water charge will be 0 for that month now)
    await recalcFutureMonths(tenant, readingMonth);
    tenant.markModified("waterMeterReadings");
    await tenant.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getTenantStatement(req, res) {
  try {
    const tenant = await Tenant.findOne({
      _id: req.params.id,
      userId: req.userId,
    });
    const user = await User.findById(req.userId);
    const landlordDisplay = user.landlordName || user.name || "Landlord";

    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    // 🔥 SAFETY FIXES: ensure paymentHistory is an array
    if (!tenant.paymentHistory) tenant.paymentHistory = [];
    if (!Array.isArray(tenant.paymentHistory)) tenant.paymentHistory = [];

    // Determine today’s date (dev‑aware)
    let today;
    if (req.query.devDate) {
      const devDate = new Date(req.query.devDate);
      if (!isNaN(devDate.getTime())) {
        today = new Date(
          Date.UTC(
            devDate.getUTCFullYear(),
            devDate.getUTCMonth(),
            devDate.getUTCDate()
          )
        );
      }
    }
    if (!today) {
      const now = new Date();
      today = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      );
    }

    // Sort all entries (safe)
    const allEntries = [...tenant.paymentHistory].sort((a, b) => {
      if (a.month !== b.month) return a.month.localeCompare(b.month);
      const aDate = a.datePaid ? new Date(a.datePaid).getTime() : 0;
      const bDate = b.datePaid ? new Date(b.datePaid).getTime() : 0;
      if (aDate !== bDate) return aDate - bDate;
      return a._id.toString().localeCompare(b._id.toString());
    });

    const allMonths = [...new Set(allEntries.map((e) => e.month))].sort();
    const firstMonth = allMonths.length > 0 ? allMonths[0] : null;

    function isDepositMonth(month) {
      if (!tenant.deposit || !tenant.depositPeriod || !firstMonth) return false;
      const [fy, fm] = firstMonth.split("-").map(Number);
      const endDate = new Date(fy, fm - 1 + (tenant.depositPeriod || 1) - 1, 1);
      const lastDepMonth = `${endDate.getFullYear()}-${String(
        endDate.getMonth() + 1
      ).padStart(2, "0")}`;
      return month >= firstMonth && month <= lastDepMonth;
    }

    // SAFE overdue calculation
    function getPastDueAmount(tenant) {
      if (!tenant.paymentHistory || tenant.paymentHistory.length === 0)
        return 0;
      const todayUTC = new Date(
        Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
      );
      const todayStr = `${todayUTC.getUTCFullYear()}-${String(
        todayUTC.getUTCMonth() + 1
      ).padStart(2, "0")}-${String(todayUTC.getUTCDate()).padStart(2, "0")}`;
      const months = [
        ...new Set(tenant.paymentHistory.map((e) => e.month)),
      ].sort();
      let lastPastBalance = 0;
      for (const month of months) {
        const monthEntries = tenant.paymentHistory.filter(
          (e) => e.month === month
        );
        monthEntries.sort((a, b) => {
          const aDate = a.datePaid ? new Date(a.datePaid).getTime() : 0;
          const bDate = b.datePaid ? new Date(b.datePaid).getTime() : 0;
          return aDate - bDate;
        });
        const latest = monthEntries[monthEntries.length - 1];
        if (!latest || !latest.dueDate) continue;
        const dueUTC = new Date(latest.dueDate);
        const dueStr = `${dueUTC.getUTCFullYear()}-${String(
          dueUTC.getUTCMonth() + 1
        ).padStart(2, "0")}-${String(dueUTC.getUTCDate()).padStart(2, "0")}`;
        if (dueStr < todayStr) {
          lastPastBalance = latest.remainingBalance;
        } else {
          break; // stop at the first month that is not past due
        }
      }
      return lastPastBalance < 0 ? 0 : lastPastBalance;
    }

    const overdueBalance = getPastDueAmount(tenant);

    // ---------- HTML generation (YOUR ORIGINAL CODE) ----------
    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Statement – ${tenant.name}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #1e293b; }
    .header { text-align:center; margin-bottom: 30px; }
    .header h1 { font-size:2rem; color:#0f172a; }
    .header p { color:#475569; font-size:0.9rem; }
    .tenant-info { margin-bottom:25px; padding:12px; background:#f8fafc; border-radius:8px; text-align:center; }
    .tenant-info p { margin:3px 0; font-size:0.95rem; }
    table { width:100%; border-collapse:collapse; margin-top:10px; }
    th, td { text-align:center !important; padding:8px 6px; font-size:0.85rem; }
    th { background:#e2e8f0; text-transform:uppercase; font-size:0.8rem; color:#334155; }
    td { border-bottom:1px solid #e2e8f0; }
    .charge-row td { background:#f1f5f9; font-weight:600; }
    .payment-row td { color:#475569; }
    .balance { font-weight:700; }
    .red-balance { color:#dc2626; font-weight:700; }
    .deposit-badge { font-size:0.7rem; color:#b45309; display:block; }
    .water-detail { font-size:0.7rem; color:#64748b; display:block; margin-top:2px; }
    .print-btn { margin-top:30px; text-align:center; }
    .print-btn button { background:#3b82f6; color:white; border:none; padding:10px 30px; border-radius:8px; font-size:1rem; cursor:pointer; }
    @media print { .print-btn { display:none; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${landlordDisplay}</h1>
    <p>Statement generated on ${today.toLocaleDateString()}</p>
  </div>
  <div class="tenant-info">
    <p><strong>Tenant:</strong> ${tenant.name}</p>
    <p><strong>House:</strong> ${
      tenant.houseNumber
    } &nbsp;&nbsp; <strong>Phone:</strong> ${tenant.phoneNumber}</p>
  </div>

  <table>
    <thead>
      <tr><th>Month</th><th>Rent</th><th>Water</th><th>Garbage</th><th>Total Due</th><th>Amount Paid</th><th>Balance</th><th>Date Paid</th><th>M‑Pesa Ref</th></tr>
    </thead>
    <tbody>
`;

    let currentMonth = null;
    for (const entry of allEntries) {
      const isOriginalCharge = (entry.amountPaid || 0) === 0 && !entry.datePaid;
      if (entry.month !== currentMonth) {
        currentMonth = entry.month;
        const depositText = isDepositMonth(entry.month)
          ? '<br><span class="deposit-badge">+Deposit</span>'
          : "";
        const reading = tenant.waterMeterReadings?.find(
          (r) => r.month === entry.month
        );
        let waterDisplay = entry.waterCharge
          ? entry.waterCharge.toLocaleString()
          : "0";
        if (reading && reading.unitsUsed > 0) {
          waterDisplay = `${entry.waterCharge.toLocaleString()}<br><span class="water-detail">(${
            reading.unitsUsed
          } units × ${reading.rate.toLocaleString()})</span>`;
        }
        const balanceClass =
          entry.remainingBalance > 0 ? "red-balance" : "balance";
        html += `
          <tr class="charge-row">
            <td>${entry.month}</td>
            <td>${(entry.baseRent || 0).toLocaleString()}${depositText}</td>
            <td>${waterDisplay}</td>
            <td>${(entry.garbageCharge || 0).toLocaleString()}</td>
            <td>${(entry.totalDue || 0).toLocaleString()}</td>
            <td></td>
            <td class="${balanceClass}">${entry.remainingBalance.toLocaleString()}</td>
            <td></td>
            <td></td>
          </tr>
        `;
      }
      if (!isOriginalCharge && entry.amountPaid > 0) {
        const balanceClass =
          entry.remainingBalance > 0 ? "red-balance" : "balance";
        html += `
          <tr class="payment-row">
            <td>↳ Payment</td><td></td><td></td><td></td><td></td>
            <td>${entry.amountPaid.toLocaleString()}</td>
            <td class="${balanceClass}">${entry.remainingBalance.toLocaleString()}</td>
            <td>${
              entry.datePaid
                ? new Date(entry.datePaid).toLocaleDateString()
                : "—"
            }</td>
            <td>${entry.mpesaRef || "—"}</td>
          </tr>
        `;
      }
    }

    html += `
    </tbody>
  </table>
  <div style="margin-top:20px; text-align:center; font-size:1.2rem; font-weight:700;">
    Current Overdue Balance: KSH ${overdueBalance.toLocaleString()}
  </div>
  <div class="print-btn">
    <button onclick="window.print()">🖨️ Save as PDF</button>
  </div>
</body>
</html>`;

    res.send(html);
  } catch (error) {
    console.error("Statement generation error:", error);
    res.status(500).json({ message: error.message });
  }
}

async function sendManualSms(req, res) {
  try {
    const { tenantIds, message } = req.body;
    if (!tenantIds || !tenantIds.length) {
      return res.status(400).json({ message: "Select at least one tenant." });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ message: "Message cannot be empty." });
    }
    const results = await sendBulkSms(tenantIds, message, req.userId);
    res.json({ success: true, results });
  } catch (error) {
    console.error("sendManualSms error:", error);
    res.status(500).json({ message: error.message });
  }
}

// (Optional) Endpoint to trigger automatic reminders manually
async function triggerAutomaticReminders(req, res) {
  try {
    let today = new Date();
    if (req.query.devDate) {
      const devDate = new Date(req.query.devDate);
      if (!isNaN(devDate.getTime())) today = devDate;
    }
    const force = req.query.force === "true";
    const results = await sendOverdueRemindersForUser(req.userId, today, force);
    const safeResults = Array.isArray(results) ? results : [];
    res.json({ success: true, results: safeResults });
  } catch (error) {
    console.error("triggerAutomaticReminders error:", error);
    res.status(500).json({ message: error.message, results: [] });
  }
}

async function manualSync(req, res) {
  let today = new Date();
  if (req.headers["x-dev-date"]) {
    // Parse the header as UTC (since it's YYYY-MM-DD)
    const devDateStr = req.headers["x-dev-date"];
    const [year, month, day] = devDateStr.split("-").map(Number);
    today = new Date(Date.UTC(year, month - 1, day));
  } else {
    // Use current UTC date at midnight
    const now = new Date();
    today = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    );
  }
  await syncAllTenantsToCurrentMonth(today);
  res.json({
    success: true,
    currentMonth: `${today.getUTCFullYear()}-${String(
      today.getUTCMonth() + 1
    ).padStart(2, "0")}`,
  });
}

async function bulkChangeRent(req, res) {
  try {
    const { newRent } = req.body;
    const rentNum = Number(newRent);
    if (!rentNum || rentNum <= 0 || isNaN(rentNum)) {
      return res
        .status(400)
        .json({ message: "Rent must be a positive number." });
    }

    const tenants = await Tenant.find({ userId: req.userId, active: true });
    const today = getEffectiveToday(req); // ✅ use simulated date if present

    for (let tenant of tenants) {
      tenant.rent = rentNum;
      await tenant.save();
      const startMonth = getFirstFutureMonth(tenant, today);
      if (startMonth) {
        await recalcFutureMonths(tenant, startMonth);
        tenant.markModified("paymentHistory");
        await tenant.save();
      }
    }

    res.json({ success: true, updatedCount: tenants.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
async function bulkChangeDueDay(req, res) {
  try {
    const { newDueDay } = req.body;
    const day = Number(newDueDay);
    if (!day || day < 1 || day > 31) {
      return res
        .status(400)
        .json({ message: "Due day must be between 1 and 31." });
    }

    const tenants = await Tenant.find({ userId: req.userId, active: true });
    const today = getEffectiveToday(req); // ✅ simulated date

    for (let tenant of tenants) {
      tenant.dueDay = day;
      await tenant.save();
      const startMonth = getFirstFutureMonth(tenant, today);
      if (startMonth) {
        await recalcFutureMonths(tenant, startMonth);
        tenant.markModified("paymentHistory");
        await tenant.save();
      }
    }

    // 🔥 REMOVED the syncAllTenantsToCurrentMonth(new Date()) call – it was
    // both unnecessary (the recalculation already adjusts future months) and
    // would ignore the dev-date.

    res.json({ success: true, updatedCount: tenants.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

function isTenantLate(tenant, currentMonth, todayOverride) {
  const latestByMonth = new Map();
  for (let entry of tenant.paymentHistory) {
    const existing = latestByMonth.get(entry.month);
    if (!existing) {
      latestByMonth.set(entry.month, entry);
    } else {
      const aDate = entry.datePaid ? new Date(entry.datePaid).getTime() : 0;
      const bDate = existing.datePaid
        ? new Date(existing.datePaid).getTime()
        : 0;
      if (
        aDate > bDate ||
        (aDate === bDate && entry._id.toString() > existing._id.toString())
      ) {
        latestByMonth.set(entry.month, entry);
      }
    }
  }

  const today = todayOverride || new Date();
  today.setHours(0, 0, 0, 0);

  for (let entry of latestByMonth.values()) {
    if (entry.remainingBalance > 0) {
      const due = entry.dueDate ? new Date(entry.dueDate) : null;
      if (due && due < today) {
        return true;
      }
    }
  }
  return false;
}

async function getOverdueCount(req, res) {
  try {
    let todayOverride;
    if (req.query.devDate) {
      const devDate = new Date(req.query.devDate);
      if (!isNaN(devDate.getTime())) todayOverride = devDate;
    }
    const overdue = await getOverdueTenants(req.userId, todayOverride);
    res.json({ count: overdue.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

const atmClient = africastalking({
  username: process.env.AFRICASTALKING_USERNAME,
  apiKey: process.env.AFRICASTALKING_API_KEY,
});

async function getSmsBalance(req, res) {
  try {
    // Africa's Talking doesn't have a direct balance endpoint for SMS;
    // but you can fetch via application data. Alternative: store credit in env or DB.
    // Simpler: fetch from /api/application endpoint.
    const response = await atmClient.application.fetchApplicationData();
    const balance = response.UserData?.creditBalance || 0;
    res.json({ balance });
  } catch (error) {
    console.error("Balance fetch error:", error);
    res.json({ balance: null, error: error.message });
  }
}

async function handleSmsWebhook(req, res) {
  try {
    const data = req.body;
    // Africa's Talking sends a JSON with delivery reports
    // Expected format: { data: [{ id, status, ... }] }
    const reports = data?.data || [];
    for (const report of reports) {
      const messageId = report.id;
      const status = report.status; // e.g., "Delivered", "Failed", "Sent"
      const error = report.reason || null;
      await SmsLog.findOneAndUpdate(
        { messageId },
        {
          status:
            status === "Delivered"
              ? "delivered"
              : status === "Failed"
              ? "failed"
              : "sent",
          deliveredAt: status === "Delivered" ? new Date() : null,
          failedAt: status === "Failed" ? new Date() : null,
          error: error,
        }
      );
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error);
    res.sendStatus(500);
  }
}

async function getSmsLogs(req, res) {
  try {
    const logs = await SmsLog.find({ userId: req.userId })
      .sort({ sentAt: -1 })
      .limit(200);
    res.json(logs);
  } catch (error) {
    console.error("Error fetching SMS logs:", error);
    res.status(500).json({ message: error.message });
  }
}

// ========================
//   EXPORTS
// ========================
export {
  getAllTenants,
  getTenantById,
  createTenant,
  updateTenant,
  importTenants,
  manualSync,
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
  archiveTenant,
  restoreTenant,
  permanentlyDeleteTenant,
  getArchivedCount,
  deleteMeterReading,
  getExportStatement,
  syncAllTenantsToCurrentMonth,
  bulkChangeDueDay,
  bulkChangeRent,
  sendManualSms,
  triggerAutomaticReminders,
  getOverdueCount,
  getSmsBalance,
  handleSmsWebhook,
  getSmsLogs,
};
