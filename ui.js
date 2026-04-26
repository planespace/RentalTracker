// ui.js – Handles UI rendering & display (updated toasts)

function renderTenant(tenant, index) {
  let currentRecord = getCurrentPaymentRecord(tenant);
  const today = getAppToday(); // midnight, dev‑aware

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

  // Track the earliest unpaid due date to compute days overdue
  let earliestUnpaidDue = null;
  for (let entry of latestByMonth.values()) {
    if (entry.remainingBalance > 0) {
      const due = normalizeDueDate(entry.dueDate);
      if (due && due < today) {
        isPastDue = true;
        if (!earliestUnpaidDue || due < earliestUnpaidDue) {
          earliestUnpaidDue = due;
        }
      }
    }
  }

  let daysOverdue = 0;
  if (earliestUnpaidDue) {
    daysOverdue = Math.floor(
      (today - earliestUnpaidDue) / (1000 * 60 * 60 * 24)
    );
  }

  let statusText = "";
  let statusClass = "status-badge due-status";

  // ----- Balance = latest cumulative remaining balance from payment history -----
  let balance = tenant.rent; // fallback if no history
  if (tenant.paymentHistory && tenant.paymentHistory.length > 0) {
    // Sort same way the server does: month → datePaid (nulls last) → _id
    const sorted = [...tenant.paymentHistory].sort((a, b) => {
      if (a.month !== b.month) return a.month.localeCompare(b.month);
      const aDate = a.datePaid ? new Date(a.datePaid).getTime() : 0;
      const bDate = b.datePaid ? new Date(b.datePaid).getTime() : 0;
      if (aDate !== bDate) return aDate - bDate;
      return a._id.toString().localeCompare(b._id.toString());
    });
    balance = sorted[sorted.length - 1].remainingBalance;
  }

  const isFullyPaid = currentRecord.paid && balance <= 0;

  if (isFullyPaid && !isPastDue) statusText = "✅ On time";
  else if (isPastDue) {
    statusText = "⚠️ Past due";
    statusClass += " overdue";
  } else statusText = "✅ On time";

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
    ${
      isPastDue
        ? `<span class="overdue-days">${daysOverdue} day${
            daysOverdue !== 1 ? "s" : ""
          }</span>`
        : ""
    }
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
        window.location.origin + `/tenants/payment-status/${month}`,
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
    const today = getAppToday();

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
