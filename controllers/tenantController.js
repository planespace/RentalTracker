// ========================
//   controllers/tenantController.js – FULLY FIXED (only the necessary changes)
// ========================
import { Tenant } from "../models/Tenant.js";
import Settings from "../models/Settings.js"; // ✅ FIXED: default import only
import User from "../models/User.js"; // ✅ FIXED: default import only

// ========================
//   HELPER FUNCTIONS
// ========================
function getCorrectMonthFormat() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
async function syncAllTenantsToCurrentMonth() {
  const currentMonth = getCurrentMonthString();
  const allTenants = await Tenant.find({ active: true });

  const byUser = {};
  for (const t of allTenants) {
    if (!byUser[t.userId]) byUser[t.userId] = [];
    byUser[t.userId].push(t);
  }

  for (const userId of Object.keys(byUser)) {
    const settings = await getGlobalSettings(userId);
    const tenants = byUser[userId];

    for (let tenant of tenants) {
      let lastMonth = null;
      if (tenant.paymentHistory.length > 0) {
        const sorted = [...tenant.paymentHistory].sort((a, b) =>
          b.month.localeCompare(a.month)
        );
        lastMonth = sorted[0].month;
      }

      let monthToCreate = lastMonth
        ? getNextMonthString(lastMonth)
        : currentMonth;

      while (monthToCreate <= currentMonth) {
        const exists = tenant.paymentHistory.find(
          (e) => e.month === monthToCreate
        );
        if (!exists) {
          // Determine the correct due date
          let dueDate;

          // Check if this is the very first month for the tenant
          const isFirstMonthEver =
            tenant.paymentHistory.length === 0
              ? monthToCreate === currentMonth
              : false;

          if (isFirstMonthEver) {
            // Same logic as when a tenant is created: push to a future month if past
            dueDate = getDueDateForMonth(tenant, monthToCreate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            while (dueDate.getTime() < today.getTime()) {
              const nextStr = getNextMonthString(
                `${dueDate.getFullYear()}-${String(
                  dueDate.getMonth() + 1
                ).padStart(2, "0")}`
              );
              dueDate = getDueDateForMonth(tenant, nextStr);
            }
          } else {
            // Subsequent months: due date = due day of the NEXT calendar month
            const nextMonthStr = getNextMonthString(monthToCreate);
            dueDate = getDueDateForMonth(tenant, nextMonthStr);
          }

          tenant.paymentHistory.push({
            month: monthToCreate,
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

          await recalcFutureMonths(tenant, monthToCreate);
          await tenant.save();
        }
        monthToCreate = getNextMonthString(monthToCreate);
      }
    }
  }
  console.log(`✅ Synced all tenants up to ${currentMonth}`);
}

function getDueDateForMonth(tenantOrDueDay, yearMonth) {
  let dueDay;
  if (typeof tenantOrDueDay === "object") {
    dueDay = tenantOrDueDay.dueDay;
  } else {
    dueDay = tenantOrDueDay;
  }
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(dueDay, lastDay);
  return new Date(Date.UTC(year, month - 1, day));
}

async function getCurrentDate(req, res) {
  res.json({ currentDate: new Date().toISOString() });
}

function getCurrentMonthString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
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
    if (aDate !== bDate) return aDate - bDate;
    const aTimestamp = parseInt(a._id.toString().substring(0, 8), 16);
    const bTimestamp = parseInt(b._id.toString().substring(0, 8), 16);
    return aTimestamp - bTimestamp;
  });

  if (allEntries.length === 0) return;

  let runningBalance = 0;
  let currentMonth = null;
  let monthIndex = 0;
  const settings = await getGlobalSettings(tenant.userId); // 👈 GLOBAL SETTINGS

  for (let i = 0; i < allEntries.length; i++) {
    const entry = allEntries[i];
    const month = entry.month;
    if (month !== currentMonth) {
      currentMonth = month;

      // Deposit instalment logic
      let depositExtra = 0;
      if (tenant.deposit) {
        const depPeriod = tenant.depositPeriod || 1;
        if (monthIndex < depPeriod) {
          depositExtra = Math.round(tenant.rent / depPeriod);
        }
      }
      // ✅ FIXED: declare baseRent with let
      let baseRent = tenant.rent + depositExtra;

      monthIndex++;

      // Water charge – use stored rate from meter reading
      const meterReading = tenant.waterMeterReadings.find(
        (r) => r.month === month
      );
      let waterCharge = 0;
      if (meterReading) {
        const prevReading = getPreviousMeterReading(tenant, month);
        const unitsUsed = meterReading.reading - prevReading;
        meterReading.unitsUsed = unitsUsed;
        const rate = meterReading.rate || settings.waterRatePerUnit || 0;
        meterReading.cost = unitsUsed * rate;
        waterCharge = meterReading.cost;
        tenant.markModified("waterMeterReadings");
      }

      const garbageCharge = settings.garbageFee; // 👈 GLOBAL
      const totalDue = baseRent + waterCharge + garbageCharge;

      const monthEntries = allEntries.filter((e) => e.month === month);
      monthEntries.forEach((e) => {
        e.baseRent = baseRent;
        e.waterCharge = waterCharge;
        e.garbageCharge = garbageCharge;
        e.totalDue = totalDue;
      });

      if (i === 0) {
        runningBalance = totalDue;
      } else {
        runningBalance += totalDue;
      }
    }

    runningBalance -= entry.amountPaid;
    entry.remainingBalance = runningBalance;
    entry.paid = runningBalance <= 0;
    if (entry.paid && !entry.datePaid) {
      entry.datePaid = new Date().toISOString();
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

    // ---------- Today's date (dev‑aware) ----------
    let today = new Date();
    if (req.query.devDate) {
      const devDate = new Date(req.query.devDate);
      if (!isNaN(devDate.getTime())) today = devDate;
    }
    today.setHours(0, 0, 0, 0);

    // ---------- Global settings ----------
    const settings = await getGlobalSettings(req.userId);
    const garbageFee = settings.garbageFee || 0;

    // ---------- Helper: cumulative balance ----------
    function getCumulativeBalance(tenant, currentDate) {
      let activeMonth = null;
      for (let entry of tenant.paymentHistory || []) {
        const due = new Date(entry.dueDate);
        if (!isNaN(due.getTime()) && due > currentDate) {
          activeMonth = entry.month;
          break;
        }
      }
      if (!activeMonth) {
        const y = currentDate.getFullYear();
        const m = String(currentDate.getMonth() + 1).padStart(2, "0");
        activeMonth = `${y}-${m}`;
      }

      let totalCharges = 0;
      let totalPaid = 0;
      const seenMonths = new Set();

      for (let entry of tenant.paymentHistory || []) {
        totalPaid += entry.amountPaid || 0;
        if (seenMonths.has(entry.month) || entry.month > activeMonth) continue;

        const charges =
          (entry.baseRent || tenant.rent) +
          (entry.waterCharge || 0) +
          (entry.garbageCharge || 0);
        totalCharges += charges;
        seenMonths.add(entry.month);
      }

      if (!seenMonths.has(activeMonth)) {
        totalCharges += tenant.rent + garbageFee;
      }

      let balance = totalCharges - totalPaid;
      if (balance === 0 && tenant.paymentHistory.length === 0) {
        balance = tenant.rent;
      }
      return balance;
    }

    // ---------- Helper: past‑due balance ----------
    function getPastDueBalance(tenant, currentDate) {
      let overdue = 0;
      for (let entry of tenant.paymentHistory || []) {
        if (entry.remainingBalance > 0 && entry.dueDate) {
          if (new Date(entry.dueDate) < currentDate)
            overdue += entry.remainingBalance;
        }
      }
      return overdue;
    }

    // ---------- Pre‑compute stats for All Tenants report ----------
    const activeTenantsCount = tenants.length;
    let totalCollected = 0; // all‑time
    let expectedThisMonth = 0;
    let collectedThisMonth = 0;
    const currentMonthStr = getCurrentMonthString();

    tenants.forEach((t) => {
      t.paymentHistory.forEach((e) => {
        totalCollected += e.amountPaid || 0;
      });
      // Expected rent for the current month (just the base rent – no deposit/water/garbage projection here)
      expectedThisMonth += t.rent;
      // Look for a payment record for the current month and sum its paid amount
      const currentMonthRecord = t.paymentHistory.find(
        (r) => r.month === currentMonthStr
      );
      if (currentMonthRecord) {
        collectedThisMonth += currentMonthRecord.amountPaid || 0;
      }
    });

    // ---------- Filter for late tenants ----------
    if (type === "late") {
      tenants = tenants.filter(
        (tenant) => getPastDueBalance(tenant, today) > 0
      );
    }

    // ---------- Landlord info ----------
    const user = await User.findById(req.userId);
    const landlordDisplay = user.landlordName || user.name || "Landlord";

    tenants.sort((a, b) => a.name.localeCompare(b.name));

    // ---------- Generate HTML ----------
    let totalOwed = 0;

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
    } – ${new Date().toLocaleDateString()}</p>
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
      <div class="value">${tenants.length}</div>
    </div>
      `;
    } else {
      // All tenants – 5 cards
      html += `
    <div class="summary-item">
      <div class="label">Total Owed</div>
      <div class="value owed">KSH ${totalOwed.toLocaleString()}</div>
    </div>
    <div class="summary-item">
      <div class="label">Active Tenants</div>
      <div class="value">${activeTenantsCount}</div>
    </div>
    <div class="summary-item">
      <div class="label">Total Collected (All‑Time)</div>
      <div class="value collected">KSH ${totalCollected.toLocaleString()}</div>
    </div>
    <div class="summary-item">
      <div class="label">Expected This Month</div>
      <div class="value">KSH ${expectedThisMonth.toLocaleString()}</div>
    </div>
    <div class="summary-item">
      <div class="label">Collected This Month</div>
      <div class="value collected">KSH ${collectedThisMonth.toLocaleString()}</div>
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
        <th>${type === "late" ? "Past Due" : "Balance"}</th>
        <th>Status</th>
        <th>Due Date</th>
      </tr>
    </thead>
    <tbody>
`;

    tenants.forEach((tenant) => {
      let balance, statusText, statusClass;
      if (type === "late") {
        balance = getPastDueBalance(tenant, today);
        statusText = "Past Due";
        statusClass = "status-unpaid";
      } else {
        balance = getCumulativeBalance(tenant, today);
        const isPaid = balance <= 0;
        statusText = isPaid ? "Paid" : balance > 0 ? "Unpaid" : "Overpaid";
        statusClass = isPaid
          ? "status-paid"
          : balance > 0
          ? "status-unpaid"
          : "status-overpaid";
      }

      totalOwed += balance > 0 ? balance : 0;

      // Deposit badge
      let depositBadge = "";
      if (tenant.deposit && tenant.depositPeriod) {
        const firstMonth = tenant.paymentHistory.map((e) => e.month).sort()[0];
        if (firstMonth) {
          const [fy, fm] = firstMonth.split("-").map(Number);
          const endDate = new Date(
            fy,
            fm - 1 + (tenant.depositPeriod || 1) - 1,
            1
          );
          const lastDepMonth = `${endDate.getFullYear()}-${String(
            endDate.getMonth() + 1
          ).padStart(2, "0")}`;
          const todayMonth = `${today.getFullYear()}-${String(
            today.getMonth() + 1
          ).padStart(2, "0")}`;
          if (todayMonth <= lastDepMonth) {
            depositBadge = '<br><span class="deposit-badge">+Deposit</span>';
          }
        }
      }

      let displayDueDate = "—";
      if (type === "late") {
        for (let entry of tenant.paymentHistory) {
          if (
            entry.remainingBalance > 0 &&
            entry.dueDate &&
            new Date(entry.dueDate) < today
          ) {
            displayDueDate = new Date(entry.dueDate).toLocaleDateString();
            break;
          }
        }
      } else {
        const record = tenant.paymentHistory.find(
          (r) => r.month === currentMonthStr
        );
        displayDueDate = record?.dueDate
          ? new Date(record.dueDate).toLocaleDateString()
          : "—";
      }

      const balanceCellClass = balance > 0 ? "balance-red" : "balance-green";

      html += `
        <tr>
          <td style="font-weight:600;">${tenant.name}</td>
          <td>${tenant.houseNumber}</td>
          <td>${tenant.phoneNumber}</td>
          <td>KSH ${tenant.rent.toLocaleString()}${depositBadge}</td>
          <td class="${balanceCellClass}">KSH ${balance.toLocaleString()}</td>
          <td><span class="status-badge ${statusClass}">${statusText}</span></td>
          <td>${displayDueDate}</td>
        </tr>
      `;
    });

    // Replace placeholder in the summary cards
    html = html.replace(
      "KSH 0</div>",
      `KSH ${totalOwed.toLocaleString()}</div>`
    );

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

    let remainingToDistribute = Number(amountPaid);
    if (isNaN(remainingToDistribute) || remainingToDistribute < 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    // Build map of latest entry per month
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

    const sortedMonths = [...latestByMonth.keys()].sort((a, b) =>
      a.localeCompare(b)
    );
    let earliestChangedMonth = null;

    for (let month of sortedMonths) {
      if (remainingToDistribute <= 0) break;
      const latestEntry = latestByMonth.get(month);
      if (latestEntry.remainingBalance > 0) {
        const pay = Math.min(
          latestEntry.remainingBalance,
          remainingToDistribute
        );
        remainingToDistribute -= pay;

        // Clean payment entry – NO charge fields
        tenant.paymentHistory.push({
          month: latestEntry.month,
          amountPaid: pay,
          remainingBalance: 0,
          paid: false,
          datePaid: datePaid || null,
          dueDate: latestEntry.dueDate,
          mpesaRef: mpesaRef || "",
        });

        if (!earliestChangedMonth || month < earliestChangedMonth) {
          earliestChangedMonth = month;
        }
      }
    }

    // Overpayment – also clean
    if (remainingToDistribute > 0) {
      const currentMonth = getCurrentMonthString();
      tenant.paymentHistory.push({
        month: currentMonth,
        amountPaid: remainingToDistribute,
        remainingBalance: 0,
        paid: false,
        datePaid: datePaid || null,
        dueDate: getDueDateForMonth(tenant, currentMonth),
        mpesaRef: mpesaRef || "",
      });
      if (!earliestChangedMonth) earliestChangedMonth = currentMonth;
    }

    if (earliestChangedMonth) {
      await recalcFutureMonths(tenant, earliestChangedMonth);
    }

    tenant.markModified("paymentHistory");
    await tenant.save();

    res.json({ success: true, paymentHistory: tenant.paymentHistory });
  } catch (error) {
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
    // Due date logic (unchanged)
    const currentMonth = getCurrentMonthString();
    const targetMonth = currentMonth;
    let computedDueDate = getDueDateForMonth(dueDayNum, currentMonth);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    while (computedDueDate.getTime() < today.getTime()) {
      const nextMonthStr = getNextMonthString(
        `${computedDueDate.getFullYear()}-${String(
          computedDueDate.getMonth() + 1
        ).padStart(2, "0")}`
      );
      computedDueDate = getDueDateForMonth(dueDayNum, nextMonthStr);
    }
    if (entryDate) {
      const entryObj = new Date(entryDate);
      if (!isNaN(entryObj.getTime())) {
        while (entryObj.getTime() > computedDueDate.getTime()) {
          const nextMonthStr = getNextMonthString(
            `${computedDueDate.getFullYear()}-${String(
              computedDueDate.getMonth() + 1
            ).padStart(2, "0")}`
          );
          computedDueDate = getDueDateForMonth(dueDayNum, nextMonthStr);
        }
      }
    }
    // ─────────────────────────────────────────────────────────

    // Deposit logic
    const depPeriod = Number(depositPeriod) || 1; // default 1 month
    const deposit = depPeriod > 0; // if period > 0, deposit is active
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
          month: targetMonth,
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
    if (rentChanged) existing.rent = req.body.rent;

    const allowedUpdates = [
      "name",
      "rent",
      "phoneNumber",
      "houseNumber",
      "notes",
      "entryDate",
      "dueDay", // ← changed from dueDate
    ];
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        existing[field] = req.body[field];
      }
    });
    await existing.save();

    if (rentChanged) {
      const currentMonth = getCurrentMonthString();
      await recalcFutureMonths(existing, currentMonth);
      await existing.save();
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

async function setDeposit(req, res) {
  try {
    const { id } = req.params;
    const tenant = await Tenant.findOne({ _id: id, userId: req.userId });
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const currentMonth = getCurrentMonthString();
    const entry = tenant.paymentHistory.find((e) => e.month === currentMonth);
    if (!entry)
      return res
        .status(400)
        .json({ message: "No payment entry for current month" });

    tenant.deposit = true;
    entry.totalDue = tenant.rent * 2;
    entry.baseRent = tenant.rent;
    entry.remainingBalance = entry.totalDue;
    entry.paid = false;
    await tenant.save();
    await recalcFutureMonths(tenant, entry.month);
    await tenant.save();

    res.json({ success: true });
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
    if (!settings) settings = new Settings({ _id: "global_" + req.userId });

    if (garbageFee !== undefined) settings.garbageFee = garbageFee;
    if (waterRatePerUnit !== undefined)
      settings.waterRatePerUnit = waterRatePerUnit;
    if (defaultDueDay !== undefined) settings.defaultDueDay = defaultDueDay;

    await settings.save();

    // ---- Immediately update all active tenants with the new charges ----
    const tenants = await Tenant.find({ userId: req.userId, active: true });
    for (let tenant of tenants) {
      // Recalculate from the tenant's earliest month to current
      const earliestMonth =
        tenant.paymentHistory.length > 0
          ? tenant.paymentHistory.map((e) => e.month).sort()[0]
          : getCurrentMonthString();
      await recalcFutureMonths(tenant, earliestMonth);
      tenant.markModified("paymentHistory");
      await tenant.save();
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function importTenants(req, res) {
  try {
    const { tenants } = req.body; // array of tenant objects from CSV
    const userId = req.userId;
    const currentMonth = getCurrentMonthString();
    const settings = await getGlobalSettings(req.userId);

    if (!Array.isArray(tenants) || tenants.length === 0) {
      return res.status(400).json({ message: "No tenants provided" });
    }

    const created = [];
    const errors = [];

    for (const t of tenants) {
      // Basic validation
      if (!t.name || !t.phoneNumber || !t.houseNumber || !t.rent) {
        errors.push(
          `Skipped row: missing required fields - ${JSON.stringify(t)}`
        );
        continue;
      }

      const rentNum = Number(t.rent);
      if (isNaN(rentNum) || rentNum <= 0) {
        errors.push(`Skipped ${t.name}: invalid rent`);
        continue;
      }

      // Check for duplicate house number or name for this user
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

      // Build first month's payment entry with deposit instalment
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
            baseRent: baseRent + depositInstalment, // includes deposit instalment
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
async function manualSync(req, res) {
  await syncAllTenantsToCurrentMonth();
  res.json({ success: true, currentMonth: getCurrentMonthString() });
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

    // Sort all entries: month → datePaid (nulls last) → _id
    const allEntries = [...tenant.paymentHistory].sort((a, b) => {
      if (a.month !== b.month) return a.month.localeCompare(b.month);
      const aDate = a.datePaid ? new Date(a.datePaid).getTime() : 0;
      const bDate = b.datePaid ? new Date(b.datePaid).getTime() : 0;
      if (aDate !== bDate) return aDate - bDate;
      return a._id.toString().localeCompare(b._id.toString());
    });

    // Get all unique months to determine the tenant's first month
    const allMonths = [...new Set(allEntries.map((e) => e.month))].sort();
    const firstMonth = allMonths.length > 0 ? allMonths[0] : null;

    // Helper to check if a month is within the deposit period
    function isDepositMonth(month) {
      if (!tenant.deposit || !tenant.depositPeriod || !firstMonth) return false;
      const [fy, fm] = firstMonth.split("-").map(Number);
      const endDate = new Date(fy, fm - 1 + (tenant.depositPeriod || 1) - 1, 1);
      const lastDepMonth = `${endDate.getFullYear()}-${String(
        endDate.getMonth() + 1
      ).padStart(2, "0")}`;
      return month >= firstMonth && month <= lastDepMonth;
    }

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
    .deposit-badge { font-size:0.7rem; color:#b45309; display:block; }
    .water-detail { font-size:0.75rem; color:#64748b; display:block; }
    .print-btn { margin-top:30px; text-align:center; }
    .print-btn button { background:#3b82f6; color:white; border:none; padding:10px 30px; border-radius:8px; font-size:1rem; cursor:pointer; }
    @media print { .print-btn { display:none; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${landlordDisplay}</h1>
    <p>Statement generated on ${new Date().toLocaleDateString()}</p>
  </div>
  <div class="tenant-info">
    <p><strong>Tenant:</strong> ${tenant.name}</p>
    <p><strong>House:</strong> ${
      tenant.houseNumber
    } &nbsp;&nbsp; <strong>Phone:</strong> ${tenant.phoneNumber}</p>
  </div>

  <table>
    <thead>
      <tr>
        <th>Month</th>
        <th>Rent</th>
        <th>Water</th>
        <th>Garbage</th>
        <th>Total Due</th>
        <th>Amount Paid</th>
        <th>Balance</th>
        <th>Due Date</th>
        <th>Date Paid</th>
        <th>M‑Pesa Ref</th>
      </tr>
    </thead>
    <tbody>
`;

    let currentMonth = null;
    for (const entry of allEntries) {
      const isOriginalCharge = (entry.amountPaid || 0) === 0 && !entry.datePaid;

      if (entry.month !== currentMonth) {
        currentMonth = entry.month;

        // Deposit badge – show below rent on its own line
        const depositText = isDepositMonth(entry.month)
          ? '<br><span class="deposit-badge">+Deposit</span>'
          : "";

        // Water details
        const reading = tenant.waterMeterReadings?.find(
          (r) => r.month === entry.month
        );
        let waterDisplay = entry.waterCharge
          ? entry.waterCharge.toLocaleString()
          : "0";
        if (reading) {
          waterDisplay = `${entry.waterCharge.toLocaleString()}<br><span class="water-detail">(${
            reading.reading
          } – ${
            reading.unitsUsed
          } u × ${reading.rate.toLocaleString()})</span>`;
        }

        // Format due date for this charge entry
        const dueDateStr = entry.dueDate
          ? new Date(entry.dueDate).toLocaleDateString()
          : "—";

        html += `
          <tr class="charge-row">
            <td>${entry.month}</td>
            <td>${(entry.baseRent || 0).toLocaleString()}${depositText}</td>
            <td>${waterDisplay}</td>
            <td>${(entry.garbageCharge || 0).toLocaleString()}</td>
            <td>${(entry.totalDue || 0).toLocaleString()}</td>
            <td></td>
            <td class="balance">${entry.remainingBalance.toLocaleString()}</td>
            <td>${dueDateStr}</td>
            <td></td>
            <td></td>
          </tr>
        `;
      }

      // Payment rows
      if (!isOriginalCharge && entry.amountPaid > 0) {
        html += `
          <tr class="payment-row">
            <td>↳ Payment</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>${entry.amountPaid.toLocaleString()}</td>
            <td class="balance">${entry.remainingBalance.toLocaleString()}</td>
            <td></td>
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

    const lastEntry = allEntries[allEntries.length - 1];
    const currentBalance = lastEntry ? lastEntry.remainingBalance || 0 : 0;

    html += `
    </tbody>
  </table>
  <div style="margin-top:20px; text-align:center; font-size:1.2rem; font-weight:700;">
    Current Balance: KSH ${currentBalance.toLocaleString()}
  </div>
  <div class="print-btn">
    <button onclick="window.print()">🖨️ Save as PDF</button>
  </div>
</body>
</html>
`;

    res.send(html);
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

    // Update all active tenants
    const tenants = await Tenant.find({ userId: req.userId, active: true });
    for (let tenant of tenants) {
      tenant.dueDay = day;
      await tenant.save();

      // Recalculate from earliest month to current
      const earliestMonth =
        tenant.paymentHistory.length > 0
          ? tenant.paymentHistory.map((e) => e.month).sort()[0]
          : getCurrentMonthString();
      await recalcFutureMonths(tenant, earliestMonth);
      tenant.markModified("paymentHistory");
      await tenant.save();
    }

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
  setDeposit,
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
};
