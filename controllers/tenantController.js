// ========================
//   controllers/tenantController.js – FULLY FIXED
// ========================
import { Tenant } from "../models/Tenant.js";
import Settings from "../models/Settings.js";
import User from "../models/User.js";
// ========================
//   HELPER FUNCTIONS
// ========================

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
  let settings = await Settings.findById("global_" + userId);
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
      baseRent = tenant.rent + depositExtra;

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

    // Filter for late tenants using the correct latest‑entry logic
    if (type === "late") {
      const currentMonth = getCurrentMonthString();
      tenants = tenants.filter((tenant) => isTenantLate(tenant, currentMonth));
    }

    const user = await _findById(req.userId);
    const landlordDisplay = user.landlordName || user.name || "Landlord";

    // Sort tenants alphabetically for a clean report
    tenants.sort((a, b) => a.name.localeCompare(b.name));

    let html = `
      <html>
      <head>
        <title>Tenant Statement - ${
          type === "late" ? "Late Tenants" : "All Tenants"
        }</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #1e293b; text-align: center; }
          table { border-collapse: collapse; width: 100%; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background: #f1f5f9; }
          .summary { margin-top: 20px; font-weight: bold; }
          @media print { button { display: none; } }
        </style>
      </head>
      <body>
        <h1>${landlordDisplay}</h1>
        <h3>${
          type === "late" ? "Late Tenants Report" : "All Tenants Report"
        }</h3>
        <p>Generated on: ${new Date().toLocaleDateString()}</p>
        <table>
          <thead>
            <tr><th>Name</th><th>House</th><th>Phone</th><th>Rent</th><th>Current Balance</th><th>Status</th><th>Due Date</th></tr>
          </thead>
          <tbody>
    `;

    let totalOwed = 0;
    for (const tenant of tenants) {
      const currentMonth = getCurrentMonthString();
      const record = tenant.paymentHistory.find(
        (r) => r.month === currentMonth
      );
      const balance = record?.remainingBalance ?? tenant.rent;
      const isPaid = record?.paid && balance <= 0;
      const status = isPaid ? "Paid" : balance > 0 ? "Unpaid" : "Overpaid";
      if (balance > 0) totalOwed += balance;

      html += `
        <tr>
          <td>${tenant.name}</td>
          <td>${tenant.houseNumber}</td>
          <td>${tenant.phoneNumber}</td>
          <td>KSH ${tenant.rent.toLocaleString()}</td>
          <td>KSH ${balance.toLocaleString()}</td>
          <td>${status}</td>
          <td>${
            record?.dueDate
              ? new Date(record.dueDate).toLocaleDateString()
              : "—"
          }</td>
        </tr>
      `;
    }

    html += `
          </tbody>
         </table>
         <div class="summary">Total Balance: KSH ${totalOwed.toLocaleString()}</div>
         <button onclick="window.print()">Save as PDF</button>
       </body>
      </html>
    `;

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
    let settings = await Settings.findById("global_" + req.userId);
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
    const { tenants } = req.body; // array of tenant objects
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

      // --- NEW: Extract dueDay from dueDate ---
      let dueDayNum = settings.defaultDueDay; // fallback to global default
      if (t.dueDate) {
        const parsedDueDate = new Date(t.dueDate);
        if (!isNaN(parsedDueDate.getTime())) {
          dueDayNum = parsedDueDate.getDate(); // extract day (1-31)
        }
      }
      // Ensure within valid range
      if (!dueDayNum || dueDayNum < 1 || dueDayNum > 31) {
        dueDayNum = settings.defaultDueDay || 1;
      }

      const entryDate = t.entryDate ? new Date(t.entryDate) : new Date();

      const newTenant = new Tenant({
        userId,
        name: t.name,
        rent: rentNum,
        phoneNumber: t.phoneNumber,
        houseNumber: t.houseNumber,
        notes: t.notes || "",
        entryDate,
        dueDay: dueDayNum, // ← store dueDay, not dueDate
        active: true,
        paymentHistory: [
          {
            month: currentMonth,
            baseRent: rentNum,
            waterCharge: 0,
            garbageCharge: settings.garbageFee,
            totalDue: rentNum + settings.garbageFee,
            amountPaid: 0,
            remainingBalance: rentNum + settings.garbageFee,
            paid: false,
            datePaid: null,
            dueDate: getDueDateForMonth(dueDayNum, currentMonth), // compute for payment record
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

    let html = `
      <html><head><title>Statement - ${tenant.name}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h2 { color: #1e293b; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f1f5f9; }
        .summary { margin-top: 20px; font-weight: bold; }
        @media print { button { display: none; } }
      </style></head><body>
      <h2>Statement for ${tenant.name}</h2>
      <p>House: ${tenant.houseNumber} | Phone: ${tenant.phoneNumber}</p>
      <table>
        <tr><th>Month</th><th>Rent</th><th>Water</th><th>Garbage</th><th>Total Due</th><th>Paid</th><th>Balance</th><th>Date</th><th>M‑Pesa Ref</th></tr>
    `;

    for (let entry of allEntries) {
      // Determine if this month falls within the deposit period
      let depositNote = "";
      if (tenant.deposit) {
        const firstMonth = tenant.paymentHistory.map((e) => e.month).sort()[0]; // earliest month (e.g., "2026-04")
        if (firstMonth) {
          const depPeriod = tenant.depositPeriod || 1;
          // Calculate the last deposit month
          const [fy, fm] = firstMonth.split("-").map(Number);
          const endDate = new Date(fy, fm - 1 + depPeriod - 1, 1);
          const lastDepMonth = `${endDate.getFullYear()}-${String(
            endDate.getMonth() + 1
          ).padStart(2, "0")}`;
          if (entry.month >= firstMonth && entry.month <= lastDepMonth) {
            depositNote = " (+Deposit)";
          }
        }
      }

      // Original charge entries always have amountPaid === 0
      const isOriginalCharge = (entry.amountPaid || 0) === 0;

      const rentDisplay = isOriginalCharge
        ? (entry.baseRent || 0) + depositNote
        : "—";
      const waterDisplay = isOriginalCharge ? entry.waterCharge || 0 : "—";
      const garbageDisplay = isOriginalCharge ? entry.garbageCharge || 0 : "—";
      const totalDueDisplay = isOriginalCharge ? entry.totalDue || 0 : "—";

      html += `<tr>
        <td>${entry.month}</td>
        <td>${rentDisplay}</td>
        <td>${waterDisplay}</td>
        <td>${garbageDisplay}</td>
        <td>${totalDueDisplay}</td>
        <td>${entry.amountPaid || 0}</td>
        <td>${entry.remainingBalance || 0}</td>
        <td>${
          entry.datePaid ? new Date(entry.datePaid).toLocaleDateString() : "—"
        }</td>
        <td>${entry.mpesaRef || "—"}</td>
      </tr>`;
    }

    const lastEntry = allEntries[allEntries.length - 1];
    const currentBalance = lastEntry ? lastEntry.remainingBalance || 0 : 0;

    html += `</table>
     <div class="summary">Current Balance: KSH ${currentBalance.toLocaleString()}</div>
      <button onclick="window.print()">Save as PDF</button>
      </body></html>`;

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

function isTenantLate(tenant, currentMonth) {
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

  const today = new Date();
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
