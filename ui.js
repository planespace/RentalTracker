// ui.js – Handles UI rendering & display (updated toasts)

function normalizeDueDate(val) {
  if (!val) return null;
  if (val instanceof Date) return new Date(val);
  // Try direct parsing (works for ISO strings and YYYY-MM-DD)
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d;
  // Fallback: if it's a plain date string without time, use T00:00:00
  const try2 = new Date(val + "T00:00:00");
  return isNaN(try2.getTime()) ? null : try2;
}

function renderTenant(tenant, index) {
  let currentRecord = getCurrentPaymentRecord(tenant);
  const today = getAppToday(); // midnight, dev‑aware

  // Determine the "active billing month": first month with a future due date.
  let activeMonth = null;
  for (let entry of tenant.paymentHistory || []) {
    const due = normalizeDueDate(entry.dueDate);
    if (due && due > today) {
      activeMonth = entry.month;
      break;
    }
  }
  // If all due dates are past, the active month is the current calendar month
  if (!activeMonth) activeMonth = getCurrentMonth();

  // ----- Balance = sum of charges for months ≤ active month (minus total paid) -----
  let totalCharges = 0;
  let totalPaid = 0;
  const seenMonths = new Set();

  for (let entry of tenant.paymentHistory || []) {
    // Sum all payments
    totalPaid += entry.amountPaid || 0;

    // Only count charges once per month, and only if month ≤ active month
    if (seenMonths.has(entry.month) || entry.month > activeMonth) continue;

    const charges =
      (entry.baseRent || tenant.rent) +
      (entry.waterCharge || 0) +
      (entry.garbageCharge || 0);
    totalCharges += charges;
    seenMonths.add(entry.month);
  }

  // If the active month has no payment record yet, add the tenant’s rent
  if (!seenMonths.has(activeMonth)) {
    totalCharges += tenant.rent;
    const settings = globalSettings || { garbageFee: 0 };
    totalCharges += settings.garbageFee || 0;
  }

  let balance = totalCharges - totalPaid;

  // Fallback: if no payment history at all, use tenant.rent
  if (balance === 0 && tenant.paymentHistory.length === 0) {
    balance = tenant.rent;
  }

  // Formatting
  let balanceClass = "";
  let balanceText = "";
  if (balance < 0) {
    balanceClass = "balance-overpaid";
    balanceText = `+${formatCurrency(Math.abs(balance))}`;
  } else if (balance === 0) {
    balanceClass = "balance-paid";
    balanceText = formatCurrency(0);
  } else {
    balanceClass = "balance-unpaid";
    balanceText = formatCurrency(balance);
  }

  const displayDueDate = getTenantNextDueDate(tenant);
  const isFullyPaid = currentRecord.paid && balance <= 0;

  // ---------- Past‑due logic (per month, using latest entry only) ----------
  let isPastDue = false;

  // Build a map: month -> entry with the latest datePaid (or newest _id)
  const latestByMonth = new Map();
  for (let entry of tenant.paymentHistory || []) {
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

  for (let entry of latestByMonth.values()) {
    if (entry.remainingBalance > 0) {
      const due = normalizeDueDate(entry.dueDate);
      if (due && due < today) {
        isPastDue = true;
        break;
      }
    }
  }

  let statusText = "";
  let statusClass = "status-badge due-status";
  if (isFullyPaid && !isPastDue) statusText = "✅ On time";
  else if (isPastDue) {
    statusText = "⚠️ Past due";
    statusClass += " overdue";
  } else statusText = "✅ On time";

  // Deposit badge – visible until the due date of the LAST deposit month passes

  let hasDeposit = false;
  if (tenant.deposit) {
    const firstMonth = getTenantFirstMonth(tenant); // e.g., "2026-04"
    if (firstMonth) {
      const addMonths = (monthStr, n) => {
        const [y, m] = monthStr.split("-").map(Number);
        const d = new Date(y, m - 1 + n, 1);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        return `${year}-${month}`;
      };
      const depositPeriod = tenant.depositPeriod || 1;
      const endMonth = addMonths(firstMonth, depositPeriod - 1); // last month with deposit instalment

      // Find the payment entry for the end month
      const endEntry = tenant.paymentHistory?.find((e) => e.month === endMonth);
      if (endEntry) {
        const due = normalizeDueDate(endEntry.dueDate);
        if (due && due > today) {
          hasDeposit = true; // deadline not yet passed
        }
      } else {
        // If the entry doesn't exist yet (future month), deposit is still active
        hasDeposit = true;
      }
    }
  }

  let newDiv = document.createElement("div");
  newDiv.className = "tenant-info";
  newDiv.innerHTML = `
  <p class="tenant-name-cell">${tenant.name}</p>
  <div class="rent-cell">
    <span class="rent-value">${formatCurrency(tenant.rent)}</span>
    ${hasDeposit ? `<span class="deposit-badge">+ Deposit</span>` : ""}
  </div>
  <div class="balance-cell ${balanceClass}">${balanceText}</div>
  <p class="entry-date-cell">${formatDate(tenant.entryDate) || "—"}</p>
  <div class="due-date-cell">
    <span class="due-date-value">${formatDate(displayDueDate) || "—"}</span>
    <span class="${statusClass}">${statusText}</span>
  </div>
  <div class="actions-cell">
  ${
    showArchived
      ? `<button class="archived-actions-btn" data-id="${tenant._id}">⚙️</button>`
      : `<button class="tenant-actions-btn" data-id="${tenant._id}">🛠️</button>`
  }
  </div>`;

  return newDiv;
}
// TODO Function to update list

function formatDate(isoString) {
  if (!isoString) return "—";
  // If it's already a Date object, convert it to a string
  if (isoString instanceof Date) {
    return isoString.toISOString().split("T")[0];
  }
  return isoString.split("T")[0];
}

function populateMonthSelector() {
  let selector = document.getElementById("month-view-selector");
  selector.innerHTML = '<option value="current">Current month</option>';
  let monthsSet = new Set();
  tenantArray.forEach((tenant) => {
    tenant.paymentHistory.forEach((record) => {
      monthsSet.add(record.month);
    });
  });
  let uniqueMonths = Array.from(monthsSet).sort().reverse();

  uniqueMonths.forEach((month) => {
    let option = document.createElement("option");
    option.value = month;
    option.textContent = month;
    selector.appendChild(option);
  });
}

document
  .querySelector("#month-view-selector")
  .addEventListener("change", async (event) => {
    if (event.target.value === "current") {
      updateTenantList(tenantArray);
      updateStats(tenantArray);
      document.querySelector(
        ".current-month"
      ).textContent = `Current Month&Year: ${getCurrentMonth()}`;
      document.getElementById("enter-bulk-mode-btn").style.display = "block";
      if (window.isBulkMode) window.exitBulkMode();
      return;
    } else {
      document.getElementById("enter-bulk-mode-btn").style.display = "none";
      if (window.isBulkMode) window.exitBulkMode();

      let month = event.target.value;
      let response = await fetch(
        `window.location.origin/tenants/payment-status/${month}`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        }
      );

      let data = await response.json();
      renderPastMonthTable(data, month);
      updateStatsForMonth(tenantArray, month);
    }
  });
function renderPastMonthTable(paymentData, month) {
  let html = `
    <div class="tenant-info">
      <h2>Name</h2>
      <h2>Rent Amount</h2>
      <h2>Balance</h2>
      <h2>Entry Date</h2>
      <h2>Due Date</h2>
      <h2>Actions</h2>
    </div>
  `;

  tenantArray.forEach((tenant) => {
    const paymentRecord = tenant.paymentHistory.find((r) => r.month === month);

    let balance = paymentRecord?.remainingBalance ?? tenant.rent;
    let balanceClass = "";
    let balanceText = "";
    if (balance < 0) {
      balanceClass = "balance-overpaid";
      balanceText = `+${formatCurrency(Math.abs(balance))}`;
    } else if (balance === 0) {
      balanceClass = "balance-paid";
      balanceText = formatCurrency(0);
    } else {
      balanceClass = "balance-unpaid";
      balanceText = formatCurrency(balance);
    }

    // Status logic – purely due-date based
    const isFullyPaid = paymentRecord?.paid && balance <= 0;
    let statusText = "";
    let statusClass = "status-badge due-status";

    const due = paymentRecord?.dueDate
      ? new Date(paymentRecord.dueDate)
      : new Date();
    due.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isFullyPaid) {
      statusText = "✅ On time";
    } else {
      if (due >= today) {
        statusText = "✅ On time";
      } else {
        statusText = "⚠️ Past due";
        statusClass += " overdue";
      }
    }

    const firstMonth = getTenantFirstMonth(tenant);
    const isFirstMonth = firstMonth === month;
    const hasDeposit = isFirstMonth && tenant.deposit === true;

    const dueDate = paymentRecord?.dueDate
      ? formatDate(paymentRecord.dueDate)
      : formatDate(tenant.dueDate);

    html += `
      <div class="tenant-info">
        <p>${tenant.name}</p>
        <div class="rent-cell">
          <span class="rent-value">${formatCurrency(tenant.rent)}</span>
          ${hasDeposit ? `<span class="deposit-badge">+ Deposit</span>` : ""}
        </div>
        <div class="balance-cell ${balanceClass}">${balanceText}</div>
        <p class="entry-date-cell">${formatDate(tenant.entryDate) || "—"}</p>
        <div class="due-date-cell">
          <span class="due-date-value">${dueDate || "—"}</span>
          <span class="${statusClass}">${statusText}</span>
        </div>
        <div>
          <button disabled class="tenant-actions-btn">🛠️</button>
        </div>
      </div>
    `;
  });

  tenantInfoDiv.innerHTML = html;
  document.querySelector(".current-month").textContent = `Viewing: ${month}`;
}

// Event listener for Profile button in actions modal
document.querySelector("#modal-profile").addEventListener("click", () => {
  let tenant = tenantArray.find((t) => t._id === window.currentActionsTenantId);
  if (!tenant) return;

  let html = `
  <div class="profile-display-mode" id="profile-display">
    <div class="profile-field"><label>Name:</label> <span>${
      tenant.name
    }</span></div>
    <div class="profile-field"><label>Rent:</label> <span>${formatCurrency(
      tenant.rent
    )}</span></div>
   <div class="profile-field">
  <label>Phone:</label>
  <span id="display-phone">${tenant.phoneNumber || "Not provided"}</span>
  ${
    tenant.phoneNumber
      ? `<button class="copy-phone-btn" data-phone="${tenant.phoneNumber}" title="Copy phone number">📋</button>`
      : ""
  }
</div>
    <div class="profile-field"><label>House:</label> <span id="display-house">${
      tenant.houseNumber || "Not provided"
    }</span></div>
    <div class="profile-field"><label>Notes:</label> <span id="display-notes">${
      tenant.notes || "No notes"
    }</span></div>
       <div class="profile-field"><label>Entry Date:</label> <span>${formatDate(
         tenant.entryDate
       )}</span></div>
    <div class="profile-field"><label>Due Day:</label> <span>${
      tenant.dueDay || 1
    }</span></div>
    <div class="profile-buttons">
      <button id="edit-profile-btn">✏️ Edit</button>
    </div>
  </div>
  <div class="profile-edit-mode" id="profile-edit" style="display: none;">
    <!-- Edit form will be inserted here when Edit is clicked -->
  </div>
`;

  document.querySelector("#profile-content").innerHTML = html;
  document.querySelector("#profile-modal").style.display = "block";
  document.getElementById("tenant-actions-modal").style.display = "none";
  document.getElementById("modal-overlay").style.display = "none";
  document.body.classList.add("modal-open");
});

// Save button inside profile modal (use event delegation)
document
  .querySelector("#profile-modal")
  .addEventListener("click", async (event) => {
    if (event.target.id === "edit-profile-btn") {
      let tenant = tenantArray.find(
        (t) => t._id === window.currentActionsTenantId
      );
      document.querySelector("#profile-display").style.display = "none";
      document.querySelector("#profile-edit").style.display = "block";
      document.querySelector("#profile-edit").innerHTML = `
    <div class="profile-field"><label>Name:</label> <input type="text" id="edit-name" value="${
      tenant.name
    }"></div>
    <div class="profile-field"><label>Rent:</label> <input type="number" id="edit-rent" value="${
      tenant.rent
    }" step="any"></div>
    <div class="profile-field"><label>Phone:</label> <input type="tel" id="edit-phone" value="${
      tenant.phoneNumber || ""
    }"></div>
    <div class="profile-field"><label>House:</label> <input type="text" id="edit-house" value="${
      tenant.houseNumber || ""
    }"></div>
    <div class="profile-field"><label>Notes:</label> <textarea id="edit-notes">${
      tenant.notes || ""
    }</textarea></div>
   
    <div class="profile-field"><label>Entry Date:</label> <input type="date" id="edit-entry-date" value="${formatDate(
      tenant.entryDate
    )}"></div>
<div class="profile-field"><label>Due Day (1‑31):</label> <input type="number" id="edit-due-day" min="1" max="31" value="${
        tenant.dueDay || 1
      }"></div>

    <div class="profile-buttons">
      <button id="save-profile-edit">Save</button>
      <button id="cancel-profile-edit">Cancel</button>
    </div>
  `;
    }

    if (event.target.id === "cancel-profile-edit") {
      document.querySelector("#profile-display").style.display = "block";
      document.querySelector("#profile-edit").style.display = "none";
    }

    if (event.target.id === "save-profile-edit") {
      const saveBtn = event.target;
      if (typeof setButtonLoading === "function") {
        setButtonLoading(saveBtn, true);
      }

      try {
        let tenantId = window.currentActionsTenantId;
        let newName = document.getElementById("edit-name").value;
        let newRent = Number(document.getElementById("edit-rent").value);
        let newPhone = document.getElementById("edit-phone").value;
        let newHouse = document.getElementById("edit-house").value;
        let newNotes = document.getElementById("edit-notes").value;
        let newEntryDate = document.getElementById("edit-entry-date").value;
        let newDueDay =
          parseInt(document.getElementById("edit-due-day").value) ||
          tenant.dueDay;
        let response = await fetch(
          `window.location.origin/tenants/${tenantId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({
              name: newName,
              rent: newRent,
              phoneNumber: newPhone,
              houseNumber: newHouse,
              notes: newNotes,
              entryDate: newEntryDate,
              dueDay: newDueDay,
            }),
          }
        );

        if (response.ok) {
          await loadTenants();
          document.getElementById("profile-modal").style.display = "none";
          document.body.classList.remove("modal-open");
          // Use the dark toast mixin (defined in main.js)
          Toast.fire({
            icon: "success",
            title: "Profile Updated",
          });
        } else {
          Toast.fire({
            icon: "error",
            title: "Update Failed",
            text: "Failed to update profile.",
          });
        }
      } catch (err) {
        console.error("Profile update error:", err);
        Toast.fire({
          icon: "error",
          title: "Network Error",
          text: "Please check your connection.",
        });
      } finally {
        if (typeof setButtonLoading === "function") {
          setButtonLoading(saveBtn, false);
        }
      }
    }

    if (event.target.id === "cancel-profile-btn") {
      document.getElementById("profile-modal").style.display = "none";
    }
  });

function getPreviousMonthString(monthString) {
  let [year, month] = monthString.split("-").map(Number);
  let date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() - 1);
  let newYear = date.getFullYear();
  let newMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${newYear}-${newMonth}`;
}

function setMonthPickerDefault() {
  const picker = document.getElementById("manual-month-picker");
  const currentMonth = getCurrentMonth();
  if (picker && currentMonth) {
    // If dev date picker has a value, use its month
    const devPicker = document.getElementById("dev-date-picker");
    if (devPicker && devPicker.value) {
      picker.value = devPicker.value.slice(0, 7);
    } else {
      picker.value = currentMonth;
    }
  }
}

function getNextMonthString(monthString) {
  let [year, month] = monthString.split("-").map(Number);
  let date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() + 1);
  let newYear = date.getFullYear();
  let newMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${newYear}-${newMonth}`;
}

function updateAllTimeStats(tenantArray) {
  let allTimeOwed = 0;
  let allTimeCollected = 0;
  let highestDebtAmount = 0;
  let highestDebtor = null;

  tenantArray.forEach((tenant) => {
    tenant.paymentHistory.forEach((record) => {
      if (record.remainingBalance > 0) {
        allTimeOwed += record.remainingBalance;
      }
      if (record.amountPaid) {
        allTimeCollected += record.amountPaid;
      }
    });
    const tenantTotalDebt = tenant.paymentHistory.reduce(
      (sum, r) => sum + (r.remainingBalance > 0 ? r.remainingBalance : 0),
      0
    );
    if (tenantTotalDebt > highestDebtAmount) {
      highestDebtAmount = tenantTotalDebt;
      highestDebtor = tenant;
    }
  });

  document.querySelector(
    ".all-time-owed"
  ).textContent = `Total owed: ${formatCurrency(allTimeOwed)}`;
  document.querySelector(
    ".all-time-collected"
  ).textContent = `Collected: ${formatCurrency(allTimeCollected)}`;
  const debtorText = highestDebtor
    ? `${highestDebtor.name} – ${formatCurrency(highestDebtAmount)}`
    : "No debt";
  document.querySelector(".all-time-highest-debtor").textContent = debtorText;
}

// Topbar menu toggle
const menuBtn = document.getElementById("topbar-menu-btn");
const menuDropdown = document.getElementById("topbar-menu-dropdown");

if (menuBtn && menuDropdown) {
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = menuDropdown.style.display === "none";
    menuDropdown.style.display = isHidden ? "flex" : "none";
  });

  document.addEventListener("click", (e) => {
    if (!menuBtn.contains(e.target) && !menuDropdown.contains(e.target)) {
      menuDropdown.style.display = "none";
    }
  });
}

document.getElementById("modal-overlay").addEventListener("click", () => {
  if (window._closeGlobalSettingsModal) {
    window._closeGlobalSettingsModal();
  }
  document.getElementById("tenant-actions-modal").style.display = "none";
  document.getElementById("profile-modal").style.display = "none";
  document.getElementById("utilities-modal").style.display = "none";
  document.getElementById("modal-overlay").style.display = "none";
  document.body.classList.remove("modal-open");
});

function updateStatsForMonth(tenants, month) {
  let totalOwed = 0,
    totalPaidTenants = 0,
    totalUnpaidTenants = 0;
  tenants.forEach((tenant) => {
    const record = tenant.paymentHistory.find((r) => r.month === month);
    const balance = record?.remainingBalance ?? tenant.rent;
    const isPaid = record?.paid && balance <= 0;
    if (balance > 0) totalOwed += balance;
    if (isPaid) totalPaidTenants++;
    else totalUnpaidTenants++;
  });
  // Update only the relevant stats display or simply do nothing – we can leave it minimal.
  // For now, just update total-owed, paid/unpaid counts to avoid errors.
  document.querySelector(
    ".total-owed"
  ).textContent = `Total owed: ${formatCurrency(totalOwed)}`;
  document.querySelector(
    ".total-unpaid-tenants"
  ).textContent = `Unpaid tenants: ${totalUnpaidTenants}`;
  document.querySelector(
    ".total-paid-tenants"
  ).textContent = `Paid tenants: ${totalPaidTenants}`;
}
