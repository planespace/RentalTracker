// ========================
//   main.js – TOASTS, VERTICAL SETTINGS, CLEAN
//   + FETCH TIMEOUT (10s) ON ALL CRITICAL REQUESTS
// ========================

// ----- AUTH CHECK -----
const loginToken = localStorage.getItem("token");
if (!loginToken) {
  window.location.replace("login.html");
}

// ----- GLOBAL VARIABLES -----
let tenantName = document.querySelector(".tenant-name");
let rentAmount = document.querySelector(".rent-amount");
let addTenantButton = document.querySelector(".add-tenant-button");
let dueDayInput = document.querySelector(".tenant-due-day");

let entryDateInput = document.querySelector(".tenant-entry-date");
entryDateInput.value = new Date().toISOString().split("T")[0];
let phoneNumber = document.querySelector(".tenant-phone");
let houseNumber = document.querySelector(".tenant-house");
let tenantNotes = document.querySelector(".tenant-notes");
let tenantInfoDiv = document.querySelector(".tenant-info-div");
window.isBulkMode = false;
let debtLineChart = null;
let paidDonutChart = null;
let trendLineChart = null;
let currentAppDate;
let tenantArray = [];
let globalSettings = { garbageFee: 0, waterRatePerUnit: 0 };

let userProfile = { name: "", email: "", phone: "", landlordName: "" };

function getAppToday() {
  if (!currentAppDate) return new Date(); // fallback
  const d = new Date(currentAppDate);
  d.setHours(0, 0, 0, 0);
  return d;
}

let chartUpdateTimeout;
function scheduleChartUpdate() {
  clearTimeout(chartUpdateTimeout);
  chartUpdateTimeout = setTimeout(updateCharts, 300);
}

function getAppTodayStr() {
  if (!currentAppDate) return new Date().toISOString().slice(0, 10);
  // currentAppDate comes from server as ISO string; extract date part
  // OR it’s already a YYYY-MM-DD string if set from dev picker
  const d = new Date(currentAppDate);
  if (isNaN(d.getTime())) {
    // already a plain YYYY-MM-DD string?
    if (/^\d{4}-\d{2}-\d{2}$/.test(currentAppDate)) return currentAppDate;
    // fallback to real today
    return new Date().toISOString().slice(0, 10);
  }
  // Use local date parts to avoid time zone madness
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ----- Global top‑bar loader (shows on every fetch) -----
(function () {
  const bar = document.createElement("div");
  bar.id = "top-loader";
  bar.style.cssText = `
    position: fixed; top:0; left:0; width:100%; height:3px; z-index:99999;
    background: linear-gradient(90deg, var(--accent-cyan), var(--accent-blue));
    transform: scaleX(0); transform-origin: left;
    transition: transform 0.4s ease;
  `;
  document.body.prepend(bar);

  let active = 0;
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    active++;
    bar.style.transform = "scaleX(1)";
    bar.style.opacity = "1";
    const hide = () => {
      active--;
      if (active <= 0) {
        active = 0;
        bar.style.transform = "scaleX(0)";
        setTimeout(() => {
          bar.style.opacity = "0";
        }, 400);
      }
    };
    return originalFetch
      .apply(this, args)
      .then((res) => {
        hide();
        return res;
      })
      .catch((err) => {
        hide();
        throw err;
      });
  };
})();

// ----- FETCH WITH TIMEOUT (10 seconds) -----
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Request timed out after 10 seconds");
    }
    throw error;
  }
}
// ----- DEV MODE DATE OVERRIDE (must be early) -----
let currentDevDate = null;
const urlParams = new URLSearchParams(window.location.search);
const devModeActive = urlParams.get("dev") === "true";

if (devModeActive) {
  // Read from URL param, default to today
  const paramDate = urlParams.get("devDate");
  currentDevDate = paramDate || new Date().toISOString().split("T")[0];

  // Override fetchWithTimeout to include X-Dev-Date header
  const originalFetchWithTimeout = fetchWithTimeout;
  fetchWithTimeout = async function (url, options = {}, timeout = 10000) {
    if (currentDevDate) {
      options.headers = options.headers || {};
      options.headers["X-Dev-Date"] = currentDevDate;
    }
    return originalFetchWithTimeout(url, options, timeout);
  };

  // Update URL when picker changes
  function updateDevUrl(newDate) {
    const newParams = new URLSearchParams(window.location.search);
    newParams.set("dev", "true");
    newParams.set("devDate", newDate);
    window.history.replaceState({}, "", `?${newParams.toString()}`);
  }

  // Show the dev date picker and set listeners
  document.addEventListener("DOMContentLoaded", () => {
    const devWrapper = document.getElementById("dev-date-picker-wrapper");
    const devDatePicker = document.getElementById("dev-date-picker");
    const resetBtn = document.getElementById("reset-dev-date-btn");
    if (devWrapper) {
      devWrapper.style.display = "flex";
      if (devDatePicker) {
        devDatePicker.value = currentDevDate;
        devDatePicker.addEventListener("change", async (e) => {
          currentDevDate = e.target.value;
          updateDevUrl(currentDevDate);

          // Reload tenants with the new dev date
          await loadTenants();

          // Trigger the backend sync to create the new month's payment record
          try {
            await fetchWithTimeout(window.location.origin + "/tenants/sync", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              },
            });
            // Reload again to get the newly created month's data
            await loadTenants();
          } catch (err) {
            console.warn("Sync after dev-date change failed:", err);
          }

          Toast.fire({
            icon: "info",
            title: `Date changed to ${currentDevDate}`,
          });
        });
      }
      if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
          currentDevDate = null;
          if (devDatePicker) devDatePicker.value = "";
          // Remove devDate param but keep dev=true
          const newParams = new URLSearchParams();
          newParams.set("dev", "true");
          window.history.replaceState({}, "", `?${newParams.toString()}`);
          await loadTenants();
          Toast.fire({ icon: "info", title: "Using real date" });
        });
      }
    }
    // Also show the month‑picker row for manual month change
    const setMonthRow = document.querySelector(".set-month-row");
    if (setMonthRow) setMonthRow.style.display = "flex";
  });
}

// Helper to show error modal (for timeouts & network errors)
function showNetworkErrorModal(message) {
  Swal.fire({
    icon: "error",
    title: "Network Error",
    text:
      message ||
      "Failed to connect to the server. Please check your connection and try again.",
    confirmButtonColor: "#3b82f6",
    background: "#1e293b",
    color: "#f1f5f9",
  });
}

async function fetchUserProfile() {
  try {
    const response = await fetchWithTimeout(
      window.location.origin + "/auth/profile",
      {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      }
    );
    if (response.ok) userProfile = await response.json();
    return userProfile;
  } catch (err) {
    console.warn("Fetch user profile failed", err);
    return userProfile;
  }
}

async function updateUserProfile(updates) {
  const response = await fetchWithTimeout(
    window.location.origin + "/auth/profile",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify(updates),
    }
  );
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message);
  }
  const data = await response.json();
  userProfile = data.user;
  return data;
}

// ----- DARK TOAST MIXIN (with progress bar) -----
const Toast = Swal.mixin({
  toast: true,
  position: "bottom-end",
  showConfirmButton: false,
  timer: 2000,
  timerProgressBar: true,
  background: "#1e293b",
  color: "#f1f5f9",
  customClass: {
    timerProgressBar: "swal2-timer-progress-bar-dark",
  },
  didOpen: (toast) => {
    toast.onmouseenter = Swal.stopTimer;
    toast.onmouseleave = Swal.resumeTimer;
  },
});

// SweetAlert2 dark theme for modal (non‑toast) popups
const originalFire = Swal.fire;
Swal.fire = function (options) {
  if (typeof options === "object" && !options.background) {
    options.background = "#1e293b";
    options.color = "#f1f5f9";
  }
  return originalFire.call(this, options);
};

// ----- LOADER & BUTTON LOADING -----
function showGlobalLoader() {
  document.getElementById("custom-loader-overlay").style.display = "flex";
}

function showLandlordProfileModal() {
  const html = `
    <div class="utilities-section" style="display: flex; flex-direction: column; gap: 16px;">
      <h4 style="margin-bottom: 0;">👤 Landlord Profile</h4>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="color: var(--text-secondary); font-size: 0.9rem;">Full Name</label>
        <input type="text" id="profile-name" value="${
          userProfile.name || ""
        }" class="swal2-input" style="margin: 0;">
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="color: var(--text-secondary); font-size: 0.9rem;">Email</label>
        <input type="email" id="profile-email" value="${
          userProfile.email || ""
        }" class="swal2-input" style="margin: 0;">
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="color: var(--text-secondary); font-size: 0.9rem;">Phone</label>
        <input type="tel" id="profile-phone" value="${
          userProfile.phone || ""
        }" class="swal2-input" style="margin: 0;">
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="color: var(--text-secondary); font-size: 0.9rem;">Display Name (on statements)</label>
        <input type="text" id="profile-landlord-name" value="${
          userProfile.landlordName || ""
        }" class="swal2-input" style="margin: 0;">
      </div>
      <div class="utility-actions" style="margin-top: 8px;">
        <button id="save-landlord-profile" class="modal-action-btn">Save</button>
        <button id="cancel-landlord-profile" class="modal-action-btn danger">Cancel</button>
      </div>
    </div>
  `;

  const utilitiesModal = document.getElementById("utilities-modal");
  const overlay = document.getElementById("modal-overlay");
  const contentDiv = document.getElementById("utilities-content");
  contentDiv.innerHTML = html;
  utilitiesModal.style.display = "block";
  overlay.style.display = "block";
  document.body.classList.add("modal-open");

  if (window._landlordProfileHandler) {
    document.removeEventListener("click", window._landlordProfileHandler);
  }

  const handler = async (e) => {
    if (e.target.id === "save-landlord-profile") {
      const updates = {
        name: document.getElementById("profile-name").value,
        email: document.getElementById("profile-email").value,
        phone: document.getElementById("profile-phone").value,
        landlordName: document.getElementById("profile-landlord-name").value,
      };
      setButtonLoading(e.target, true);
      try {
        await updateUserProfile(updates);
        Toast.fire({ icon: "success", title: "Profile updated" });
        closeModal();
      } catch (err) {
        Toast.fire({ icon: "error", title: err.message || "Update failed" });
      } finally {
        setButtonLoading(e.target, false);
      }
    } else if (e.target.id === "cancel-landlord-profile") {
      closeModal();
    }
  };

  const closeModal = () => {
    utilitiesModal.style.display = "none";
    overlay.style.display = "none";
    document.body.classList.remove("modal-open");
    document.removeEventListener("click", handler);
    window._landlordProfileHandler = null;
  };

  const closeBtn = document.getElementById("close-utilities-modal");
  const oldCloseClick = closeBtn.onclick;
  closeBtn.onclick = (ev) => {
    closeModal();
    if (oldCloseClick) oldCloseClick(ev);
  };
  const oldOverlayClick = overlay.onclick;
  overlay.onclick = (ev) => {
    if (ev.target === overlay) closeModal();
    if (oldOverlayClick) oldOverlayClick(ev);
  };
  window._restoreModalHandlers = () => {
    closeBtn.onclick = oldCloseClick;
    overlay.onclick = oldOverlayClick;
  };

  document.addEventListener("click", handler);
  window._landlordProfileHandler = handler;
}

function hideGlobalLoader() {
  document.getElementById("custom-loader-overlay").style.display = "none";
}
function setButtonLoading(button, isLoading) {
  if (!button) return;
  if (isLoading) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.innerHTML;
    }
    button.innerHTML = `<span class="custom-loader" style="margin-right: 8px;"></span> ${button.dataset.originalText}`;
    button.disabled = true;
  } else {
    button.innerHTML = button.dataset.originalText || button.innerHTML;
    button.disabled = false;
    delete button.dataset.originalText;
  }
}

// ----- GLOBAL SETTINGS HELPERS -----
async function fetchGlobalSettings() {
  const response = await fetchWithTimeout(
    window.location.origin + "/tenants/settings",
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
    }
  );
  if (response.status === 401) {
    localStorage.removeItem("token");
    window.location.replace("login.html");
  }
  globalSettings = await response.json();
  return globalSettings;
}

async function updateGlobalSettingsOnServer(
  garbageFee,
  waterRatePerUnit,
  defaultDueDay
) {
  const response = await fetchWithTimeout(
    window.location.origin + "/tenants/settings",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify({ garbageFee, waterRatePerUnit, defaultDueDay }),
    }
  );
  if (response.status === 401) {
    localStorage.removeItem("token");
    window.location.href = "login.html";
  }
  return response.ok;
}

// ----- INITIAL LOAD -----
async function fetchCurrentDate() {
  const response = await fetchWithTimeout(
    window.location.origin + "/tenants/current-date",
    {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    }
  );
  const data = await response.json();
  currentAppDate = data.currentDate; // store full ISO string
}

let showArchived = false;

async function loadTenants() {
  const url = showArchived
    ? window.location.origin + "/tenants?archived=true"
    : window.location.origin + "/tenants";
  try {
    let response = await fetchWithTimeout(url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
    });
    if (response.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "login.html";
      return;
    }
    tenantArray = await response.json();

    await fetchCurrentDate();
    await fetchUserProfile();
    await fetchGlobalSettings();
    populateMonthSelector();
    updateTenantList(tenantArray);
    updateCharts();
    populateMonthSelector();
    setMonthPickerDefault();
    updateAllTimeStats(tenantArray);
    updateArchivedBadge();
    updateStatusBar();
  } catch (err) {
    showNetworkErrorModal(err.message);
  }
}
loadTenants();

// ----- CHARTS -----
function getLast6Months() {
  let months = [];
  let current = getCurrentMonth();
  for (let i = 0; i < 6; i++) {
    months.push(current);
    current = getPreviousMonthString(current);
  }
  return months.reverse();
}
function getOutstandingBalanceForMonths(months) {
  return months.map((month) => {
    let totalOutstanding = 0;
    tenantArray.forEach((tenant) => {
      let record = tenant.paymentHistory.find((r) => r.month === month);
      if (record) {
        if (record.remainingBalance > 0)
          totalOutstanding += record.remainingBalance;
      } else {
        totalOutstanding += tenant.rent;
      }
    });
    return totalOutstanding;
  });
}
function updateCharts() {
  // ---------- Donut chart (paid/unpaid tenants) ----------
  let paid = 0,
    unpaid = 0;
  tenantArray.forEach((tenant) => {
    let rec = getCurrentPaymentRecord(tenant);
    if (rec.paid) paid++;
    else unpaid++;
  });
  const donutCtx = document.getElementById("paidDonutChart").getContext("2d");
  const donutData = [paid, unpaid];
  if (paidDonutChart) {
    paidDonutChart.data.datasets[0].data = donutData;
    paidDonutChart.update();
  } else {
    paidDonutChart = new Chart(donutCtx, {
      type: "doughnut",
      data: {
        labels: ["Paid", "Unpaid"],
        datasets: [
          {
            data: donutData,
            backgroundColor: ["#10b981", "#ef4444"],
            borderWidth: 0,
            cutout: "65%",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          tooltip: { callbacks: { label: (ctx) => `${ctx.raw} tenants` } },
          legend: { position: "bottom" },
        },
      },
    });
  }
  let percentage =
    tenantArray.length === 0
      ? 0
      : Math.round((paid / tenantArray.length) * 100);
  document.getElementById(
    "donutLabel"
  ).innerText = `Paid: ${paid} / ${tenantArray.length} (${percentage}%)`;

  // ---------- Line chart (last 6 months: expected vs collected) ----------
  const months = getLast6Months();
  let expectedData = [];
  let collectedData = [];
  months.forEach((month) => {
    let expectedSum = 0;
    let collectedSum = 0;
    tenantArray.forEach((tenant) => {
      expectedSum += Number(tenant.rent);
      let rec = tenant.paymentHistory.find((r) => r.month === month);
      if (rec && rec.amountPaid) collectedSum += Number(rec.amountPaid);
    });
    expectedData.push(expectedSum);
    collectedData.push(collectedSum);
  });
  const lineCtx = document.getElementById("trendLineChart").getContext("2d");
  if (trendLineChart) {
    trendLineChart.data.datasets[0].data = expectedData;
    trendLineChart.data.datasets[1].data = collectedData;
    trendLineChart.update();
  } else {
    trendLineChart = new Chart(lineCtx, {
      type: "line",
      data: {
        labels: months,
        datasets: [
          {
            label: "Expected Rent",
            data: expectedData,
            borderColor: "#3b82f6",
            backgroundColor: "transparent",
            tension: 0.2,
            fill: false,
          },
          {
            label: "Collected Rent",
            data: collectedData,
            borderColor: "#10b981",
            backgroundColor: "transparent",
            tension: 0.2,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (val) => formatCurrency(val) },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
            },
          },
        },
      },
    });
  }

  // ---------- Outstanding Balance Line Chart (Last 6 Months) ----------
  const debtMonths = getLast6Months();
  const debtData = getOutstandingBalanceForMonths(debtMonths);
  const debtCtx = document.getElementById("debtLineChart").getContext("2d");

  if (debtLineChart) {
    debtLineChart.data.labels = debtMonths;
    debtLineChart.data.datasets[0].data = debtData;
    debtLineChart.update();
  } else {
    debtLineChart = new Chart(debtCtx, {
      type: "line",
      data: {
        labels: debtMonths,
        datasets: [
          {
            label: "Outstanding Balance",
            data: debtData,
            borderColor: "#ef4444",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            tension: 0.2,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (val) => formatCurrency(val) },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `Outstanding: ${formatCurrency(ctx.raw)}`,
            },
          },
        },
      },
    });
  }
}
// ----- TENANT HELPERS -----
function getCurrentPaymentRecord(tenant) {
  let currentMonth = getCurrentMonth();
  let records = tenant.paymentHistory.filter((r) => r.month === currentMonth);
  if (records.length === 0) {
    const computedDueDate = getTenantNextDueDate(tenant);
    return {
      month: currentMonth,
      paid: false,
      datePaid: null,
      dueDate: computedDueDate,
    };
  }
  // Sort by datePaid ascending (nulls first), then pick the last (most recent)
  records.sort((a, b) => {
    if (!a.datePaid && !b.datePaid) return 0;
    if (!a.datePaid) return -1;
    if (!b.datePaid) return 1;
    return new Date(a.datePaid) - new Date(b.datePaid);
  });
  return records[records.length - 1];
}

function getDueDateForMonthLocal(tenant, yearMonth) {
  const dueDay = tenant.dueDay || 1;
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(dueDay, lastDay);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`; // plain “YYYY-MM-DD”
}

function getTenantNextDueDate(tenant) {
  const currentMonth = getCurrentMonth(); // "2026-05"
  let dueDateStr = getDueDateForMonthLocal(tenant, currentMonth); // "2026-05-05"
  const todayStr = getAppTodayStr(); // "2026-05-05"

  // Simple string comparison works because YYYY-MM-DD is lexicographically correct
  while (dueDateStr < todayStr) {
    const [y, m] = dueDateStr.split("-").map(Number);
    const nextMonth = getNextMonthString(`${y}-${String(m).padStart(2, "0")}`);
    dueDateStr = getDueDateForMonthLocal(tenant, nextMonth);
  }

  // If entry date is later than the computed due date, push further
  if (tenant.entryDate) {
    const entryStr = formatDate(tenant.entryDate); // "2026-04-23"
    if (entryStr && dueDateStr < entryStr) {
      // entry date after due date
      // We need to advance until due date is after entry
      // Use string comparison
      while (dueDateStr < entryStr) {
        const [y, m] = dueDateStr.split("-").map(Number);
        const nextMonth = getNextMonthString(
          `${y}-${String(m).padStart(2, "0")}`
        );
        dueDateStr = getDueDateForMonthLocal(tenant, nextMonth);
      }
    }
  }

  return dueDateStr; // always a string
}

function isLate(dueDate, paid, tenant) {
  const today = getAppToday();

  // Build map of month -> latest entry
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

  // Check each month's latest entry
  for (let entry of latestByMonth.values()) {
    if (entry.remainingBalance > 0) {
      const due = normalizeDueDate(entry.dueDate);
      if (due && due < today) {
        return true;
      }
    }
  }

  // Fallback to the provided dueDate (if no history)
  if (paid) return false;
  if (!dueDate) return false;
  const due = normalizeDueDate(dueDate);
  if (!due) return false;
  due.setHours(0, 0, 0, 0);
  return due < today;
}
// ----- RENDER TENANT LIST -----

function getTenantFirstMonth(tenant) {
  if (tenant.paymentHistory && tenant.paymentHistory.length > 0) {
    const sorted = [...tenant.paymentHistory].sort((a, b) =>
      a.month.localeCompare(b.month)
    );
    return sorted[0].month;
  }
  if (tenant.entryDate) {
    const d = new Date(tenant.entryDate);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return null;
}
function updateTenantList(filteredList) {
  requestAnimationFrame(() => {
    let headerHtml = `<div class="tenant-info">`;
    if (window.isBulkMode)
      headerHtml += `<div class="checkbox-cell"><input type="checkbox" id="select-all-checkbox" title="Select all tenants"></div>`;
    headerHtml += `<h2>Name</h2><h2>Rent Amount</h2><h2>Balance</h2><h2>Entry Date</h2><h2>Due Date</h2><h2>Actions</h2></div>`;
    tenantInfoDiv.innerHTML = headerHtml;

    filteredList.forEach((tenant) => {
      let rowDiv = renderTenant(tenant);
      if (window.isBulkMode) {
        const checkboxCell = document.createElement("div");
        checkboxCell.className = "checkbox-cell";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "tenant-select";
        cb.dataset.id = tenant._id;
        checkboxCell.appendChild(cb);
        rowDiv.insertBefore(checkboxCell, rowDiv.firstChild);
      }
      tenantInfoDiv.appendChild(rowDiv);
    });

    if (window.isBulkMode) {
      const selectAll = document.getElementById("select-all-checkbox");
      if (selectAll)
        selectAll.addEventListener("change", (e) => {
          document
            .querySelectorAll(".tenant-select")
            .forEach((cb) => (cb.checked = e.target.checked));
        });
    }
    updateStats(tenantArray);
    if (filteredList.length === 0) {
      tenantInfoDiv.innerHTML = `
    <div class="tenant-info">
      ${window.isBulkMode ? '<div class="checkbox-cell"></div>' : ""}
      <h2>Name</h2><h2>Rent Amount</h2><h2>Balance</h2><h2>Entry Date</h2><h2>Due Date</h2><h2>Actions</h2>
    </div>
  `;
      const nameInput = document.querySelector(".tenant-name");
      if (nameInput) nameInput.focus();
    }
  });
}
function updateStats(tenantArray) {
  document.querySelector(
    ".current-month"
  ).innerHTML = `Current Month&Year: ${getCurrentMonth()}`;
  document.querySelector(
    ".stats-subtitle"
  ).textContent = `📅 Statistics for: ${getCurrentMonth()}`;
  let totalOwed = 0,
    totalPaidTenants = 0,
    totalUnpaidTenants = 0,
    totalTenants = tenantArray.length,
    totalPaid = 0,
    collectionRate = 0,
    totalRent = 0,
    totalLateTenants = 0,
    totalPaidRent = 0;
  let highestDebtor = null,
    highestDebtAmount = 0;
  tenantArray.forEach((tenant) => {
    totalRent += Number(tenant.rent);
    let rec = getCurrentPaymentRecord(tenant);
    let isPaid = rec.paid;
    let balance = rec.remainingBalance ?? tenant.rent;
    if (!isPaid && balance > highestDebtAmount) {
      highestDebtAmount = balance;
      highestDebtor = tenant;
    }
    if (!isPaid) {
      totalUnpaidTenants++;
      if (balance > 0) totalOwed += balance;
    } else {
      totalPaidTenants++;
      totalPaid += Number(tenant.rent);
    }
    if (isLate(rec.dueDate, rec.paid, tenant)) totalLateTenants++;
    if (rec.paid) totalPaidRent += Number(tenant.rent);
  });
  collectionRate =
    totalRent === 0 ? 0 : Math.round((totalPaid / totalRent) * 100);
  document.querySelector(
    ".total-owed"
  ).textContent = `Total owed: ${formatCurrency(totalOwed)}`;
  document.querySelector(
    ".total-unpaid-tenants"
  ).textContent = `Unpaid tenants: ${totalUnpaidTenants}`;
  document.querySelector(
    ".total-paid-tenants"
  ).textContent = `Paid tenants: ${totalPaidTenants}`;
  document.querySelector(
    ".total-tenants"
  ).textContent = `Total tenants: ${totalTenants}`;
  document.querySelector(
    ".collection-rate"
  ).textContent = `Collection rate: %${collectionRate}`;
  document.querySelector(
    ".total-expected-rent"
  ).textContent = `Total expected rent: ${formatCurrency(totalRent)}`;
  document.querySelector(".highest-debtor").textContent = highestDebtor
    ? `${highestDebtor.name} – ${formatCurrency(highestDebtAmount)}`
    : "No unpaid tenants";
  document.querySelector(
    ".total-late-tenants"
  ).textContent = `Total late tenants: ${totalLateTenants}`;
  document.querySelector(
    ".total-paid-rent"
  ).textContent = `Total paid rent: ${formatCurrency(totalPaidRent)}`;
}

// ----- MODALS: Tenant Actions, History, Profile, Payment -----
async function showTenantActionsModal(id) {
  window.currentActionsTenantId = id;
  document.getElementById("tenant-actions-modal").style.display = "block";
  document.getElementById("modal-overlay").style.display = "block";
  document.body.classList.add("modal-open");
}
async function showHistoryModal(id) {
  let matchingTenant = tenantArray.find((tenant) => tenant._id === id);
  let sortedHistory = [...matchingTenant.paymentHistory].sort((a, b) =>
    b.month.localeCompare(a.month)
  );
  let html = `<div class="history-header">
  <span>Month</span><span>Paid</span><span>Date Paid</span><span>Action</span></div>`;
  sortedHistory.forEach((record) => {
    html += `
<div class="history-record" data-month="${record.month}">
    <span class="history-month">${record.month}</span>
    <span class="history-paid">${record.paid ? "✅" : "❌"}</span>
    <span class="history-date">${
      record.datePaid ? formatDate(record.datePaid) : "—"
    }</span>
    <button class="edit-record-btn">Edit</button>
</div>`;
  });
  document.getElementById("history-content").innerHTML = html;
  document.getElementById("history-modal").style.display = "block";
  document.body.classList.add("modal-open");
  document.getElementById("modal-overlay").style.display = "block";
  document.getElementById("tenant-actions-modal").style.display = "none";
  document.getElementById("profile-modal").style.display = "none";
}
function renderPaymentModal(tenantId) {
  let tenant = tenantArray.find((t) => t._id === tenantId);
  if (!tenant) return;
  let currentMonth = getCurrentMonth();
  // If the tenant has no payment record for the current month, default to the first month they have a record for
  if (!tenant.paymentHistory.some((e) => e.month === currentMonth)) {
    if (tenant.paymentHistory.length > 0) {
      currentMonth = tenant.paymentHistory[0].month; // e.g., "2026-05"
    }
  }

  // --- Check if water reading exists for the current month ---
  const hasWaterReading = (tenant.waterMeterReadings || []).some(
    (r) => r.month === currentMonth
  );

  // Build warning banner HTML if missing
  const warningBanner = !hasWaterReading
    ? `
    <div id="water-reading-warning" style="
      background: rgba(245, 158, 11, 0.15);
      border-left: 4px solid var(--warning);
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    ">
      <span style="color: var(--warning); font-weight: 500;">
        ⚠️ No water reading recorded for ${currentMonth}. Water charges will be 0.
      </span>
      <button id="dismiss-water-warning" style="
        background: transparent;
        border: none;
        color: var(--text-muted);
        font-size: 1.2rem;
        cursor: pointer;
        padding: 0 4px;
      ">✕</button>
    </div>
  `
    : "";

  // --- Info message about auto charges ---
  const infoMessage = `
    <div style="
      background: rgba(59, 130, 246, 0.1);
      border-left: 4px solid var(--accent-blue);
      border-radius: 8px;
      padding: 8px 14px;
      margin-bottom: 12px;
      font-size: 0.8rem;
      color: var(--text-secondary);
    ">
      ℹ️ Water and garbage charges are added automatically to the total due.
    </div>
  `;

  let html = `
    ${warningBanner}
    ${infoMessage}
    <div class="payment-add-section">
      <h4>Add Payment</h4>
      <div class="payment-add-row">
        <label>Amount(KSH):</label>
        <input type="number" id="pay-amount" step="any" placeholder="0.00">
      </div>
      <div class="payment-add-row">
        <label>Date Paid:</label>
        <input type="date" id="pay-date" value="${new Date()
          .toISOString()
          .slice(0, 10)}">
      </div>
      <div class="payment-add-row">
        <label>M‑Pesa Ref:</label>
        <input type="text" id="pay-mpesa" placeholder="Optional">
      </div>
      <button id="add-payment-btn" class="modal-action-btn">➕ Add Payment</button>
    </div>
    <hr>
    <div id="payment-history-list" class="payment-history-list"></div>
  `;
  document.getElementById("payment-content").innerHTML = html;

  // --- Dismiss warning banner ---
  const dismissBtn = document.getElementById("dismiss-water-warning");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      document.getElementById("water-reading-warning")?.remove();
    });
  }

  // ---- Sort & filter the payment history ----
  let sortedHistory = [...tenant.paymentHistory].sort((a, b) => {
    if (a.month !== b.month) return b.month.localeCompare(a.month);
    const aDate = a.datePaid ? new Date(a.datePaid).getTime() : 0;
    const bDate = b.datePaid ? new Date(b.datePaid).getTime() : 0;
    if (aDate !== bDate) return bDate - aDate;
    const aId = a._id.toString();
    const bId = b._id.toString();
    if (aId > bId) return -1;
    if (aId < bId) return 1;
    return 0;
  });

  // Identify the first month (earliest month ever)
  let firstMonth = null;
  if (sortedHistory.length > 0) {
    const byMonth = [...sortedHistory].sort((a, b) =>
      a.month.localeCompare(b.month)
    );
    firstMonth = byMonth[0].month;
  }

  const today = getAppToday(); // dev‑aware midnight Date

  // Determine the active billing month (first month with future due date)
  let activeMonth = null;
  for (let entry of sortedHistory) {
    const due = normalizeDueDate(entry.dueDate);
    if (due && due > today) {
      activeMonth = entry.month;
      break;
    }
  }
  if (!activeMonth) {
    // All due dates are past – active month is the current calendar month
    activeMonth = getCurrentMonth();
  }

  // Filter: always keep the first month, plus any month ≤ active month
  sortedHistory = sortedHistory.filter((entry) => {
    if (entry.month === firstMonth) return true;
    return entry.month <= activeMonth;
  });

  // ---- Render the filtered list ----
  let container = document.getElementById("payment-history-list");
  container.innerHTML = `
  <div class="payment-header">
    <span>Month</span><span>Amount Paid</span><span>Balance</span><span>Date Paid</span><span></span><span></span>
  </div>`;
  sortedHistory.forEach((entry) => {
    // If this entry is overpaid AND a later month still has a balance,
    // show "0" instead of the negative number (overpayment moved forward).
    let displayBalance = entry.remainingBalance;
    if (displayBalance < 0) {
      const hasLaterPositive = sortedHistory.some(
        (e) => e.month > entry.month && e.remainingBalance > 0
      );
      if (hasLaterPositive) {
        displayBalance = 0;
      }
    }

    let balanceClass = "";
    if (displayBalance < 0) {
      balanceClass = "overpaid";
    } else if (displayBalance === 0) {
      balanceClass = "zero";
    }

    let div = document.createElement("div");
    div.className = "payment-record";
    div.innerHTML = `
    <span class="record-month">${entry.month}</span>
    <span class="record-amount-paid">${entry.amountPaid.toLocaleString()}</span>
    <span class="record-remaining-balance ${balanceClass}">
      ${
        displayBalance < 0
          ? "+" + Math.abs(displayBalance).toLocaleString()
          : displayBalance.toLocaleString()
      }
    </span>
    <span class="record-date-paid">${
      entry.datePaid ? formatDate(entry.datePaid) : "—"
    }</span>

    <button class="actions-btn" data-id="${entry._id}" data-month="${
      entry.month
    }" data-amount="${entry.amountPaid}" data-date="${
      entry.datePaid || ""
    }" data-mpesa="${entry.mpesaRef || ""}">⚙️</button>
    `;
    container.appendChild(div);
  });
}

// ----- UTILITIES MODAL (Meter Reading) -----
// ----- UTILITIES MODAL (Meter Reading) -----
async function showUtilitiesModal(tenantId) {
  const tenant = tenantArray.find((t) => t._id === tenantId);
  if (!tenant) return;
  const currentMonth = getCurrentMonth();
  const waterRate = globalSettings.waterRatePerUnit || 0;

  const readings = [...(tenant.waterMeterReadings || [])].sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  // Previous reading for the "Add New" form (uses the last reading overall as initial)
  const prevReading =
    readings.length > 0 ? readings[readings.length - 1].reading : 0;

  let html = `
    <div class="utilities-section">
      <div class="utility-row" style="justify-content: space-between;">
        <label>💧 Current Water Rate:</label>
        <span>${formatCurrency(waterRate)} / unit</span>
      </div>

           <h4>📝 Add New Reading</h4>
      <div class="add-reading-form">
        <div class="utility-row"><label>Month:</label><input type="month" id="reading-month" value="${currentMonth}"></div>
        <div class="utility-row"><label>Previous Reading:</label><span id="prev-reading-display">${prevReading}</span></div>
        <div class="utility-row"><label>Current Reading:</label><input type="number" id="meter-reading" step="0.1" placeholder="Enter current reading"></div>
        <div class="utility-row"><label>Units Used:</label><span id="units-used">0</span></div>
        <div class="utility-row"><label>Water Cost (KSH):</label><span id="water-cost">0</span></div>
        <div class="utility-actions">
          <button id="save-utilities-btn" class="modal-action-btn">Save Reading</button>
          <button id="cancel-utilities-btn" class="modal-action-btn danger">Close</button>
        </div>
      </div>
  `;

  // History table (only if readings exist)
  if (readings.length > 0) {
    html += `<h4>📜 Reading History</h4>
      <div style="overflow-x: auto;">
        <table style="width:100%; border-collapse: collapse;">
          <thead>
            <tr><th>Month</th><th>Reading</th><th>Units</th><th>Cost</th><th></th></tr>
          </thead>
          <tbody>`;
    readings.forEach((reading, index) => {
      const prev = index > 0 ? readings[index - 1].reading : 0;
      const units = reading.reading - prev;
      const cost = units * reading.rate;
      html += `
        <tr>
          <td>${reading.month}</td>
          <td style="text-align:right">${reading.reading}</td>
          <td style="text-align:right">${units}</td>
          <td style="text-align:right">${formatCurrency(cost)}</td>
          <td style="text-align:center">
            <button class="reading-actions-btn" data-id="${
              reading._id
            }" data-month="${reading.month}" data-reading="${
        reading.reading
      }" style="background: none; border: none; font-size: 1.2rem; cursor: pointer;">⚙️</button>
          </td>
        </tr>
      `;
    });
    html += `</tbody></table></div>`;
  } else {
    html += `<p style="text-align:center; color: var(--text-muted); margin-top: 20px;">No readings yet. Add your first reading above.</p>`;
  }

  html += `</div>`;
  document.getElementById("utilities-content").innerHTML = html;
  document.getElementById("utilities-modal").style.display = "block";
  document.getElementById("modal-overlay").style.display = "block";
  document.body.classList.add("modal-open");

  // ──────────────────────────────────────────────
  // Live calculation – uses the selected month's previous reading
  // ──────────────────────────────────────────────
  const readingInput = document.getElementById("meter-reading");
  const readingMonthInput = document.getElementById("reading-month");
  const unitsSpan = document.getElementById("units-used");
  const costSpan = document.getElementById("water-cost");
  const prevDisplay = document.getElementById("prev-reading-display");

  function getPreviousReadingForMonth(month) {
    const sorted = [...(readings || [])].sort((a, b) =>
      a.month.localeCompare(b.month)
    );
    let prev = 0;
    for (const r of sorted) {
      if (r.month < month) prev = r.reading;
      else break;
    }
    return prev;
  }

  function updateCalc() {
    const selectedMonth = readingMonthInput
      ? readingMonthInput.value
      : currentMonth;
    const prevRead = getPreviousReadingForMonth(selectedMonth);
    const current = parseFloat(readingInput.value) || 0;
    const units = current - prevRead;
    unitsSpan.textContent = units > 0 ? units : 0;
    costSpan.textContent = (units > 0 ? units * waterRate : 0).toFixed(2);
    prevDisplay.textContent = prevRead;
  }

  if (readingInput) {
    readingInput.addEventListener("input", updateCalc);
  }
  if (readingMonthInput) {
    readingMonthInput.addEventListener("change", updateCalc);
  }
  // Set initial previous reading display
  if (prevDisplay) prevDisplay.textContent = prevReading;

  // Event delegation for gear buttons (no duplicate listeners)
  document
    .getElementById("utilities-content")
    .addEventListener("click", async (e) => {
      const btn = e.target.closest(".reading-actions-btn");
      if (!btn) return;

      const id = btn.dataset.id;
      const month = btn.dataset.month;
      const currentReading = parseFloat(btn.dataset.reading);
      const tenantId = tenant._id; // tenant is from outer scope

      const result = await Swal.fire({
        title: `Reading for ${month}`,
        text: "Choose an action:",
        icon: "question",
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: "✏️ Edit",
        denyButtonText: "🗑️ Delete",
        cancelButtonText: "Cancel",
        confirmButtonColor: "#3b82f6",
        denyButtonColor: "#ef4444",
        background: "#1e293b",
        color: "#f1f5f9",
      });

      if (result.isConfirmed) {
        // Edit
        const { value: newReading } = await Swal.fire({
          title: `Edit Reading for ${month}`,
          input: "number",
          inputValue: currentReading,
          inputAttributes: { step: "0.1", min: "0" },
          showCancelButton: true,
          confirmButtonText: "Update",
          background: "#1e293b",
          color: "#f1f5f9",
        });
        if (newReading !== undefined && !isNaN(newReading) && newReading >= 0) {
          setButtonLoading(btn, true);
          try {
            const response = await fetchWithTimeout(
              window.location.origin +
                `/tenants/${tenantId}/meter-reading/${id}`,
              {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${localStorage.getItem("token")}`,
                },
                body: JSON.stringify({ reading: Number(newReading) }),
              }
            );
            if (response.ok) {
              await loadTenants();
              showUtilitiesModal(tenantId);
              Toast.fire({ icon: "success", title: "Reading updated" });
            } else {
              Toast.fire({ icon: "error", title: "Update failed" });
            }
          } catch (err) {
            Toast.fire({ icon: "error", title: err.message });
          } finally {
            setButtonLoading(btn, false);
          }
        }
      } else if (result.isDenied) {
        // Delete
        const confirm = await Swal.fire({
          title: "Delete Reading?",
          text: `Delete meter reading for ${month}? This will affect water charges.`,
          icon: "warning",
          showCancelButton: true,
          confirmButtonColor: "#ef4444",
          confirmButtonText: "Yes, delete",
          background: "#1e293b",
          color: "#f1f5f9",
        });
        if (confirm.isConfirmed) {
          setButtonLoading(btn, true);
          try {
            const response = await fetchWithTimeout(
              window.location.origin +
                `/tenants/${tenantId}/meter-reading/${id}`,
              {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${localStorage.getItem("token")}`,
                },
              }
            );
            if (response.ok) {
              await loadTenants();
              showUtilitiesModal(tenantId);
              Toast.fire({ icon: "success", title: "Reading deleted" });
            } else {
              Toast.fire({ icon: "error", title: "Delete failed" });
            }
          } catch (err) {
            Toast.fire({ icon: "error", title: err.message });
          } finally {
            setButtonLoading(btn, false);
          }
        }
      }
    });
}
function getPreviousMeterReading(tenant, targetMonth) {
  const sorted = [...(tenant.waterMeterReadings || [])].sort((a, b) =>
    a.month.localeCompare(b.month)
  );
  const targetIndex = sorted.findIndex((r) => r.month === targetMonth);
  return targetIndex > 0 ? sorted[targetIndex - 1].reading : 0;
}

// ----- GLOBAL SETTINGS MODAL (VERTICAL LAYOUT) -----
function showGlobalSettingsModal() {
  const html = `
    <div class="utilities-section" style="display: flex; flex-direction: column; gap: 20px;">
      <h4 style="margin-bottom: 0;">⚙️ Global Settings</h4>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="color: var(--text-secondary); font-size: 0.9rem;">Garbage Fee (KSH)</label>
        <input type="number" id="global-garbage" step="0.01" value="${
          globalSettings.garbageFee || 0
        }" class="swal2-input" style="margin: 0;">
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="color: var(--text-secondary); font-size: 0.9rem;">Water Rate per Unit (KSH)</label>
        <input type="number" id="global-waterrate" step="0.01" value="${
          globalSettings.waterRatePerUnit || 0
        }" class="swal2-input" style="margin: 0;">
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="color: var(--text-secondary); font-size: 0.9rem;">Default Due Day (1-31)</label>
        <input type="number" id="global-default-due-day" min="1" max="31" value="${
          globalSettings.defaultDueDay || 1
        }" class="swal2-input" style="margin: 0;">
      </div>

      <!-- NEW BULK CHANGE DUE DAY BUTTON -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <button id="change-due-day-btn" class="modal-action-btn" style="background: var(--accent-cyan);">
          📅 Change Due Day for All Tenants
        </button>
      </div>

      <div class="utility-actions" style="margin-top: 8px;">
        <button id="save-global-settings" class="modal-action-btn">Save</button>
        <button id="cancel-global-settings" class="modal-action-btn danger">Cancel</button>
      </div>
    </div>
  `;

  const utilitiesModal = document.getElementById("utilities-modal");
  const overlay = document.getElementById("modal-overlay");
  const contentDiv = document.getElementById("utilities-content");
  contentDiv.innerHTML = html;
  utilitiesModal.style.display = "block";
  overlay.style.display = "block";
  document.body.classList.add("modal-open");

  if (window._globalSettingsHandler) {
    document.removeEventListener("click", window._globalSettingsHandler);
  }

  const handler = async (e) => {
    // ----- NEW: Change Due Day for All Tenants -----
    if (e.target.id === "change-due-day-btn") {
      const { value: newDay } = await Swal.fire({
        title: "Change Due Day for All Tenants",
        input: "number",
        inputLabel: "New Due Day (1–31)",
        inputAttributes: { min: 1, max: 31, step: 1 },
        inputValue: globalSettings.defaultDueDay || 1,
        showCancelButton: true,
        confirmButtonText: "Update All",
        confirmButtonColor: "#3b82f6",
        background: "#1e293b",
        color: "#f1f5f9",
        inputValidator: (val) => {
          if (!val || val < 1 || val > 31)
            return "Enter a day between 1 and 31";
        },
      });

      if (newDay) {
        setButtonLoading(e.target, true);
        try {
          const res = await fetchWithTimeout(
            window.location.origin + "/tenants/bulk-change-due-day",
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              },
              body: JSON.stringify({ newDueDay: newDay }),
            }
          );
          if (res.ok) {
            await fetchGlobalSettings(); // refresh default due day
            await loadTenants();
            Toast.fire({
              icon: "success",
              title: `Due day updated to ${newDay}`,
            });
          } else {
            const err = await res.json();
            Toast.fire({
              icon: "error",
              title: err.message || "Update failed",
            });
          }
        } catch (err) {
          Toast.fire({ icon: "error", title: err.message });
        } finally {
          setButtonLoading(e.target, false);
        }
      }
    }

    // ----- Existing save / cancel logic -----
    if (e.target.id === "save-global-settings") {
      const garbageFee =
        parseFloat(document.getElementById("global-garbage").value) || 0;
      const waterRatePerUnit =
        parseFloat(document.getElementById("global-waterrate").value) || 0;
      const defaultDueDay =
        parseInt(document.getElementById("global-default-due-day").value) || 1;

      setButtonLoading(e.target, true);
      try {
        const ok = await updateGlobalSettingsOnServer(
          garbageFee,
          waterRatePerUnit,
          defaultDueDay
        );
        if (ok) {
          await fetchGlobalSettings();
          await loadTenants();
          updateTenantList(tenantArray); // extra safety
          updateStatusBar();
          Toast.fire({ icon: "success", title: "Settings updated" });
          document.getElementById("global-garbage").value =
            globalSettings.garbageFee || 0;
          document.getElementById("global-waterrate").value =
            globalSettings.waterRatePerUnit || 0;
          document.getElementById("global-default-due-day").value =
            globalSettings.defaultDueDay || 1;
        } else {
          Toast.fire({ icon: "error", title: "Update failed" });
        }
      } catch (err) {
        Toast.fire({ icon: "error", title: err.message || "Update failed" });
      } finally {
        setButtonLoading(e.target, false);
      }
    } else if (e.target.id === "cancel-global-settings") {
      closeGlobalSettingsModal();
    }
  };

  const closeGlobalSettingsModal = () => {
    utilitiesModal.style.display = "none";
    overlay.style.display = "none";
    document.body.classList.remove("modal-open");
    document.removeEventListener("click", handler);
    window._globalSettingsHandler = null;
    if (window._restoreModalHandlers) {
      window._restoreModalHandlers();
      window._restoreModalHandlers = null;
    }
  };

  const closeBtn = document.getElementById("close-utilities-modal");
  const oldCloseClick = closeBtn.onclick;
  closeBtn.onclick = (ev) => {
    closeGlobalSettingsModal();
    if (oldCloseClick) oldCloseClick(ev);
  };
  const oldOverlayClick = overlay.onclick;
  overlay.onclick = (ev) => {
    if (ev.target === overlay) closeGlobalSettingsModal();
    if (oldOverlayClick) oldOverlayClick(ev);
  };
  window._restoreModalHandlers = () => {
    closeBtn.onclick = oldCloseClick;
    overlay.onclick = oldOverlayClick;
  };

  document.addEventListener("click", handler);
  window._globalSettingsHandler = handler;
  window._closeGlobalSettingsModal = closeGlobalSettingsModal;
}
// ----- EVENT LISTENERS -----
document.addEventListener("click", async (e) => {
  if (e.target.id === "import-tenants-btn") {
    importTenantsFromCSV();
  }

  if (e.target.id === "modal-utilities") {
    showUtilitiesModal(window.currentActionsTenantId);
  }
  if (e.target.id === "global-settings-btn") {
    showGlobalSettingsModal();
  }
  if (e.target.id === "save-utilities-btn") {
    const tenantId = window.currentActionsTenantId;
    const reading =
      parseFloat(document.getElementById("meter-reading").value) || 0;
    const selectedMonth =
      document.getElementById("reading-month")?.value || getCurrentMonth();

    // ✅ Correct previous reading: the latest reading strictly before selected month
    const tenant = tenantArray.find((t) => t._id === tenantId);
    const allReadings = (tenant?.waterMeterReadings || []).sort((a, b) =>
      a.month.localeCompare(b.month)
    );
    let prevReading = 0;
    for (const r of allReadings) {
      if (r.month < selectedMonth) prevReading = r.reading;
      else break;
    }

    if (reading < prevReading) {
      Toast.fire({
        icon: "error",
        title: `Reading cannot be less than previous reading (${prevReading})`,
      });
      setButtonLoading(e.target, false);
      return;
    }

    setButtonLoading(e.target, true);
    try {
      await fetchWithTimeout(
        window.location.origin + `/tenants/${tenantId}/meter-reading`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({ month: selectedMonth, reading }),
        }
      );
      await loadTenants();
      showUtilitiesModal(tenantId);
      Toast.fire({ icon: "success", title: "Meter reading saved" });
    } catch (err) {
      Toast.fire({
        icon: "error",
        title: err.message || "Failed to save reading",
      });
    } finally {
      setButtonLoading(e.target, false);
    }
  }
  if (e.target.id === "cancel-utilities-btn") {
    document.getElementById("utilities-modal").style.display = "none";
    document.getElementById("modal-overlay").style.display = "none";
    document.body.classList.remove("modal-open");
  }
  if (e.target.id === "modal-statement") {
    const token = localStorage.getItem("token");
    const url =
      window.location.origin +
      `/tenants/${
        window.currentActionsTenantId
      }/statement?token=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
  }
  if (e.target.id === "modal-payment-management") {
    let id = window.currentActionsTenantId;
    renderPaymentModal(id);
    document.getElementById("payment-modal").style.display = "block";
    document.getElementById("modal-overlay").style.display = "block";
    document.body.classList.add("modal-open");
    document.getElementById("tenant-actions-modal").style.display = "none";
  }
  if (e.target.id === "modal-archive") {
    let id = window.currentActionsTenantId;
    const result = await Swal.fire({
      title: "Archive Tenant?",
      text: "The tenant will be hidden from the main list. You can restore them later.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#f59e0b",
      confirmButtonText: "Yes, archive",
    });
    if (result.isConfirmed) {
      setButtonLoading(e.target, true);
      try {
        let response = await fetchWithTimeout(
          window.location.origin + `/tenants/${id}/archive`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }
        );
        if (response.ok) {
          await loadTenants();
          document.getElementById("tenant-actions-modal").style.display =
            "none";
          document.getElementById("modal-overlay").style.display = "none";
          document.body.classList.remove("modal-open");
          Toast.fire({ icon: "success", title: "Tenant Archived" });
        }
      } catch (err) {
        Toast.fire({ icon: "error", title: err.message });
      } finally {
        setButtonLoading(e.target, false);
      }
    }
  }

  if (e.target.id === "add-payment-btn") {
    const btn = e.target;
    const tenantId = window.currentActionsTenantId;
    const amount = parseFloat(document.getElementById("pay-amount").value);
    const date = document.getElementById("pay-date").value;
    const mpesaRef = document.getElementById("pay-mpesa").value;

    // Validate amount
    if (isNaN(amount) || amount < 0) {
      Toast.fire({ icon: "warning", title: "Invalid Amount" });
      return;
    }

    // Confirmation dialog
    const confirm = await Swal.fire({
      title: "Confirm Payment",
      html: `
      <div style="text-align: left;">
        <p><strong>Amount:</strong> ${formatCurrency(amount)}</p>
        <p><strong>Date Paid:</strong> ${date || "Today"}</p>
        ${mpesaRef ? `<p><strong>M‑Pesa Ref:</strong> ${mpesaRef}</p>` : ""}
      </div>
    `,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#10b981",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Yes, record payment",
      cancelButtonText: "Cancel",
      background: "#1e293b",
      color: "#f1f5f9",
    });

    if (!confirm.isConfirmed) return;

    setButtonLoading(btn, true);
    try {
      let response = await fetchWithTimeout(
        window.location.origin + `/tenants/${tenantId}/payment-history`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            amountPaid: amount,
            datePaid: date || null,
            mpesaRef: mpesaRef || "",
          }),
        }
      );
      if (response.ok) {
        await loadTenants();
        updateTenantList(tenantArray); // ← force re‑render of table
        scheduleChartUpdate();
        renderPaymentModal(tenantId);
        Toast.fire({ icon: "success", title: "Payment Recorded" });
      } else {
        const error = await response.json();
        Toast.fire({ icon: "error", title: error.message || "Payment failed" });
      }
    } catch (err) {
      Toast.fire({ icon: "error", title: err.message });
    } finally {
      setButtonLoading(btn, false);
    }
  }
  if (e.target.classList.contains("ref-btn")) {
    const ref = e.target.dataset.ref;
    if (ref && ref.trim() !== "") {
      Swal.fire({
        title: "M‑Pesa Reference",
        text: ref,
        icon: "info",
        confirmButtonColor: "#3b82f6",
      });
    } else {
      Toast.fire({ icon: "info", title: "No M‑Pesa Reference" });
    }
  }
  if (e.target.classList.contains("actions-btn")) {
    const btn = e.target;
    const entryId = btn.dataset.id;
    const month = btn.dataset.month;
    const amount = btn.dataset.amount;
    const date = btn.dataset.date;
    const mpesa = btn.dataset.mpesa;
    const tenantId = window.currentActionsTenantId;

    // "View M‑Pesa Ref" button (only if a ref exists)
    const mpesaButton = mpesa
      ? `<button id="swal-mpesa-btn" style="background:#10b981; color:white; border:none; padding:12px 24px; border-radius:40px; font-size:1rem; font-weight:600; cursor:pointer; margin-top:12px;">
           📱 View M‑Pesa Ref
         </button>`
      : "";

    const action = await Swal.fire({
      title: "Payment Actions",
      html: `
        <div style="display:flex; flex-direction:column; align-items:center; text-align:center;">
          <p style="margin-bottom:8px; font-size:1rem; color:#e2e8f0;">
            <strong>Month:</strong> ${month}<br>
            <strong>Amount:</strong> ${formatCurrency(amount)}
          </p>
          ${mpesaButton}
        </div>
      `,
      showConfirmButton: true,
      confirmButtonText: "✏️ Edit",
      confirmButtonColor: "#3b82f6",
      showDenyButton: true,
      denyButtonText: "🗑️ Delete",
      denyButtonColor: "#ef4444",
      showCancelButton: true,
      cancelButtonText: "Cancel",
      cancelButtonColor: "#475569",
      background: "#1e293b",
      color: "#f1f5f9",
      didOpen: () => {
        const mpesaBtn = document.getElementById("swal-mpesa-btn");
        if (mpesaBtn) {
          mpesaBtn.addEventListener("click", () => {
            Swal.close();
            Swal.fire({
              title: "📱 M‑Pesa Reference",
              html: `<div style="background:rgba(59,130,246,0.1); border-left:4px solid #3b82f6; padding:14px; border-radius:6px; font-size:1.1rem; color:#e2e8f0; text-align:center;">${mpesa}</div>`,
              icon: "info",
              confirmButtonColor: "#3b82f6",
              background: "#1e293b",
              color: "#f1f5f9",
            });
          });
        }
      },
    });

    if (action.isConfirmed) {
      // ---- Edit payment ----
      const { value: formValues } = await Swal.fire({
        title: "✏️ Edit Payment",
        html: `
        <div style="display: flex; flex-direction: column; gap: 16px; text-align: left;">
          <div>
            <label for="swal-amount" style="display:block; margin-bottom:4px; font-weight:500;">Amount (KSH)</label>
            <input id="swal-amount" class="swal2-input" type="number" value="${amount}" step="any">
          </div>
          <div>
            <label for="swal-date" style="display:block; margin-bottom:4px; font-weight:500;">Date Paid</label>
            <input id="swal-date" class="swal2-input" type="date" value="${
              date ? date.slice(0, 10) : ""
            }">
          </div>
          <div>
            <label for="swal-mpesa" style="display:block; margin-bottom:4px; font-weight:500;">M‑Pesa Ref (optional)</label>
            <input id="swal-mpesa" class="swal2-input" type="text" value="${mpesa}">
          </div>
        </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: "💾 Save Changes",
        confirmButtonColor: "#3b82f6",
        preConfirm: () => {
          const amt = document.getElementById("swal-amount").value;
          const dt = document.getElementById("swal-date").value;
          const ref = document.getElementById("swal-mpesa").value;
          if (!amt || isNaN(amt) || Number(amt) < 0) {
            Swal.showValidationMessage("Enter a valid positive amount");
            return false;
          }
          return { amount: Number(amt), date: dt, mpesa: ref };
        },
      });
      if (formValues) {
        setButtonLoading(btn, true);
        try {
          let response = await fetchWithTimeout(
            window.location.origin +
              `/tenants/${tenantId}/payment-history/${entryId}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              },
              body: JSON.stringify({
                amountPaid: formValues.amount,
                datePaid: formValues.date || null,
                mpesaRef: formValues.mpesa || "",
              }),
            }
          );
          if (response.ok) {
            await loadTenants();
            renderPaymentModal(tenantId);
            Toast.fire({ icon: "success", title: "Payment Updated" });
          }
        } catch (err) {
          Toast.fire({ icon: "error", title: err.message });
        } finally {
          setButtonLoading(btn, false);
        }
      }
    } else if (action.isDenied) {
      // ---- Delete payment ----
      const confirmDelete = await Swal.fire({
        title: "🗑️ Delete Payment?",
        text: `Delete the payment record for ${month}?`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#ef4444",
        confirmButtonText: "Yes, delete",
        background: "#1e293b",
        color: "#f1f5f9",
      });
      if (confirmDelete.isConfirmed) {
        setButtonLoading(btn, true);
        try {
          let response = await fetchWithTimeout(
            window.location.origin +
              `/tenants/${tenantId}/payment-history/${entryId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              },
            }
          );
          if (response.ok) {
            await loadTenants();
            renderPaymentModal(tenantId);
            Toast.fire({ icon: "success", title: "Payment Deleted" });
          }
        } catch (err) {
          Toast.fire({ icon: "error", title: err.message });
        } finally {
          setButtonLoading(btn, false);
        }
      }
    }
  }
});

// ----- BULK MODE & CSV EXPORT -----
const enterBulkModeBtn = document.getElementById("enter-bulk-mode-btn");
const bulkModeButtons = document.getElementById("bulk-mode-buttons");
const markSelectedBtn = document.getElementById("mark-selected-paid-btn");
const cancelBulkBtn = document.getElementById("cancel-bulk-mode-btn");
function enterBulkMode() {
  if (window.isBulkMode) return;
  window.isBulkMode = true;
  updateTenantList(tenantArray);
  enterBulkModeBtn.style.display = "none";
  bulkModeButtons.style.display = "flex";
}
function exitBulkMode() {
  if (!window.isBulkMode) return;
  window.isBulkMode = false;
  updateTenantList(tenantArray);
  enterBulkModeBtn.style.display = "block";
  bulkModeButtons.style.display = "none";
}
enterBulkModeBtn.addEventListener("click", enterBulkMode);
cancelBulkBtn.addEventListener("click", exitBulkMode);
window.exitBulkMode = exitBulkMode;
markSelectedBtn.addEventListener("click", async (event) => {
  const btn = event.target;
  setButtonLoading(btn, true);
  try {
    const selected = Array.from(
      document.querySelectorAll(".tenant-select:checked")
    ).map((cb) => cb.dataset.id);
    if (selected.length === 0) {
      Toast.fire({ icon: "warning", title: "No tenants selected" });
      return;
    }
    const result = await Swal.fire({
      title: "Confirm Bulk Action",
      text: `Mark ${
        selected.length
      } tenant(s) as paid for ${getCurrentMonth()}?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#3b82f6",
      confirmButtonText: "Yes, mark paid",
    });
    if (!result.isConfirmed) return;
    const response = await fetchWithTimeout(
      window.location.origin + "/tenants/bulk-mark-paid",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ tenantIds: selected }),
      }
    );
    if (response.ok) {
      await loadTenants();
      if (window.isBulkMode) {
        enterBulkModeBtn.style.display = "none";
        bulkModeButtons.style.display = "flex";
      }
      Toast.fire({ icon: "success", title: "Marked Paid" });
    } else {
      Toast.fire({ icon: "error", title: "Bulk mark failed" });
    }
  } catch (err) {
    Toast.fire({ icon: "error", title: err.message });
  } finally {
    setButtonLoading(btn, false);
  }
});

// CSV Export
function convertToCSV(data) {
  const headers = Object.keys(data[0]);
  const csvRows = [];
  csvRows.push(headers.join(","));
  for (const row of data) {
    const values = headers.map((header) => {
      let val = row[header] !== undefined ? row[header] : "";
      if (typeof val === "string") {
        val = val.replace(/"/g, '""');
        if (val.includes(",") || val.includes("\n") || val.includes('"')) {
          val = `"${val}"`;
        }
      }
      return val;
    });
    csvRows.push(values.join(","));
  }
  return csvRows.join("\n");
}
function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
function exportToCSV(includeLateOnly = false) {
  let tenantsToExport = [...tenantArray];
  if (includeLateOnly) {
    tenantsToExport = tenantsToExport.filter((tenant) => {
      const currentRecord = getCurrentPaymentRecord(tenant);
      const balance = currentRecord.remainingBalance ?? tenant.rent;
      const isPaid = currentRecord.paid && balance <= 0;
      if (isPaid) return false;
      if (balance > tenant.rent) return true;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDateForTenant = currentRecord.dueDate || tenant.entryDate;
      const due = new Date(dueDateForTenant);
      due.setHours(0, 0, 0, 0);
      return due < today;
    });
    if (tenantsToExport.length === 0) {
      Toast.fire({ icon: "info", title: "No late tenants" });
      return;
    }
  }
  const exportData = tenantsToExport.map((tenant) => {
    const currentRecord = getCurrentPaymentRecord(tenant);
    const waterCharge = currentRecord.waterCharge || 0;
    const garbageCharge = currentRecord.garbageCharge || 0;
    return {
      Name: tenant.name,
      Rent: tenant.rent,
      "Water Charge": waterCharge,
      "Garbage Charge": garbageCharge,
      "Total Due": tenant.rent + waterCharge + garbageCharge,
      Phone: tenant.phoneNumber || "",
      House: tenant.houseNumber || "",
      Notes: tenant.notes || "",
      "Entry Date": formatDate(tenant.entryDate) || "",
      "Due Date": formatDate(currentRecord.dueDate) || "",
      Status: currentRecord.paid ? "Paid" : "Unpaid",
      "Amount Paid":
        currentRecord.amountPaid !== undefined ? currentRecord.amountPaid : 0,
      "Remaining Balance":
        currentRecord.remainingBalance !== undefined
          ? currentRecord.remainingBalance
          : tenant.rent,
      "Date Paid": currentRecord.datePaid
        ? formatDate(currentRecord.datePaid)
        : "",
    };
  });
  const csvContent = convertToCSV(exportData);
  const currentMonth = getCurrentMonth();
  const filename = includeLateOnly
    ? `late_tenants_${currentMonth}.csv`
    : `all_tenants_${currentMonth}.csv`;
  downloadCSV(csvContent, filename);
}

// ----- OVERLAY CLICK (close all modals) -----
document.getElementById("modal-overlay").addEventListener("click", () => {
  if (window._closeGlobalSettingsModal) window._closeGlobalSettingsModal();
  document.getElementById("tenant-actions-modal").style.display = "none";
  document.getElementById("profile-modal").style.display = "none";

  document.getElementById("payment-modal").style.display = "none";
  document.getElementById("utilities-modal").style.display = "none";
  document.getElementById("modal-overlay").style.display = "none";
  document.body.classList.remove("modal-open");
});

// ----- LOGOUT -----
document.querySelector("#logout-btn").addEventListener("click", async () => {
  const result = await Swal.fire({
    title: "Logout?",
    text: "Are you sure you want to log out?",
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#3b82f6",
    confirmButtonText: "Yes, logout",
  });
  if (result.isConfirmed) {
    localStorage.removeItem("token");
    window.location.href = "login.html";
  }
});

// ----- ADD TENANT -----
let searchInput = document.querySelector(".search-tenants");
let tenantsInputs = document.querySelector(".tenants-inputs");
tenantsInputs.addEventListener("click", async (event) => {
  if (event.target.classList.contains("add-tenant-button")) {
    const addBtn = event.target;
    if (!tenantName.value || !rentAmount.value) {
      Toast.fire({
        icon: "warning",
        title: "Missing Fields",
        text: "Please fill in tenant name and rent amount.",
      });
      return;
    }

    const entryDateValue = entryDateInput.value;
    const dueDayValue = dueDayInput.value;

    if (!entryDateValue) {
      Swal.fire({
        icon: "error",
        title: "Missing Entry Date",
        text: "Please select an entry date.",
        confirmButtonColor: "#3b82f6",
      });
      return;
    }

    // If due day is empty, check global default
    let finalDueDay = dueDayValue ? parseInt(dueDayValue) : null;
    if (!finalDueDay || finalDueDay < 1 || finalDueDay > 31) {
      const defaultDay = globalSettings.defaultDueDay;
      if (!defaultDay || defaultDay < 1 || defaultDay > 31) {
        Swal.fire({
          icon: "error",
          title: "Due Day Required",
          text: "Please either enter a due day (1‑31) or set a valid default due day in Global Settings (⚙️).",
          confirmButtonColor: "#3b82f6",
          background: "#1e293b",
          color: "#f1f5f9",
        });
        return;
      }
      finalDueDay = defaultDay;
    }

    setButtonLoading(addBtn, true);
    try {
      const includeDeposit =
        document.getElementById("include-deposit-checkbox")?.checked || false;
      const rent = Number(rentAmount.value);
      let response = await fetchWithTimeout(
        window.location.origin + "/tenants",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            name: tenantName.value,
            rent: rent,
            entryDate: entryDateValue,
            houseNumber: houseNumber.value,
            phoneNumber: phoneNumber.value,
            notes: tenantNotes.value,
            dueDay: finalDueDay,
            depositPeriod: includeDeposit
              ? parseInt(
                  document.getElementById("deposit-period-input").value
                ) || 1
              : 1,
          }),
        }
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message);
      }
      const newTenant = await response.json();

      await loadTenants();
      await new Promise((resolve) => setTimeout(resolve, 50));
      updateTenantList(tenantArray);
      Toast.fire({ icon: "success", title: "Tenant Added" });
      tenantName.value = "";
      houseNumber.value = "";
      phoneNumber.value = "";
      tenantNotes.value = "";
      dueDayInput.value = "";
      tenantName.focus();
    } catch (err) {
      let msg = err.message;
      if (msg === "Failed to fetch") {
        msg = "Network error. Please check your connection.";
      }
      Toast.fire({ icon: "error", title: "Add Failed", text: msg });
    } finally {
      setButtonLoading(addBtn, false);
    }
  }
});

document
  .getElementById("include-deposit-checkbox")
  .addEventListener("change", function () {
    const wrapper = document.getElementById("deposit-period-wrapper");
    if (wrapper) wrapper.style.display = this.checked ? "block" : "none";
  });

// ----- FILTER & SORT -----
function applyFiltersAndSort() {
  let result = [...tenantArray];
  const filterValue = document.getElementById("filter-select").value;
  const sortValue = document.getElementById("sort-select").value;
  const searchTerm = searchInput.value.toLowerCase();

  if (filterValue === "paid")
    result = result.filter((t) => getCurrentPaymentRecord(t).paid);
  else if (filterValue === "unpaid")
    result = result.filter((t) => !getCurrentPaymentRecord(t).paid);
  else if (filterValue === "late") {
    result = result.filter((t) => {
      const rec = getCurrentPaymentRecord(t);
      return isLate(rec.dueDate, rec.paid, t);
    });
  } else if (filterValue === "missing-water") {
    const currentMonth = getCurrentMonth();
    result = result.filter((tenant) => {
      return !(tenant.waterMeterReadings || []).some(
        (r) => r.month === currentMonth
      );
    });
  }

  if (sortValue === "rent-high") result.sort((a, b) => b.rent - a.rent);
  else if (sortValue === "rent-low") result.sort((a, b) => a.rent - b.rent);

  if (searchTerm) {
    result = result.filter(
      (t) =>
        t.name.toLowerCase().includes(searchTerm) ||
        (t.phoneNumber && t.phoneNumber.toLowerCase().includes(searchTerm)) ||
        (t.houseNumber && t.houseNumber.toLowerCase().includes(searchTerm))
    );
  }

  updateTenantList(result);
}
document
  .getElementById("filter-select")
  .addEventListener("change", applyFiltersAndSort);
document
  .getElementById("sort-select")
  .addEventListener("change", applyFiltersAndSort);
let searchTimeout;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(applyFiltersAndSort, 200);
});
// ----- MONTH PICKER & SET MONTH -----
document
  .querySelector(".tenants-div")
  .addEventListener("click", async (event) => {
    if (event.target.classList.contains("tenant-actions-btn")) {
      showTenantActionsModal(event.target.dataset.id);
    }
  });

// ----- CLOSE MODAL BUTTONS -----

document.getElementById("close-profile-modal").addEventListener("click", () => {
  document.getElementById("profile-modal").style.display = "none";
  document.getElementById("modal-overlay").style.display = "none";
  document.body.classList.remove("modal-open");
});
document.getElementById("close-tenant-modal").addEventListener("click", () => {
  document.getElementById("tenant-actions-modal").style.display = "none";
  document.getElementById("modal-overlay").style.display = "none";
  document.body.classList.remove("modal-open");
});
document.getElementById("close-payment-modal").addEventListener("click", () => {
  document.getElementById("payment-modal").style.display = "none";
  document.getElementById("modal-overlay").style.display = "none";
  document.body.classList.remove("modal-open");
});
document
  .getElementById("close-utilities-modal")
  .addEventListener("click", () => {
    document.getElementById("utilities-modal").style.display = "none";
    document.getElementById("modal-overlay").style.display = "none";
    document.body.classList.remove("modal-open");
  });

// ----- PROFILE MODAL SAVE -----
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
    </div>`;
    } else if (event.target.id === "cancel-profile-edit") {
      document.querySelector("#profile-display").style.display = "block";
      document.querySelector("#profile-edit").style.display = "none";
    } else if (event.target.id === "save-profile-edit") {
      const saveBtn = event.target;
      setButtonLoading(saveBtn, true);
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
        let response = await fetchWithTimeout(
          window.location.origin + `/tenants/${tenantId}`,
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
          Toast.fire({ icon: "success", title: "Profile Updated" });
        }
      } catch (err) {
        Toast.fire({ icon: "error", title: err.message });
      } finally {
        setButtonLoading(saveBtn, false);
      }
    }
  });

// ----- RESIZE HANDLER -----
window.addEventListener("resize", () => {
  if (window.innerWidth <= 768 && window.isBulkMode) {
    exitBulkMode();
  }
});

function importTenantsFromCSV() {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".csv";
  fileInput.click();
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const tenants = results.data;
        if (tenants.length === 0) {
          Toast.fire({ icon: "warning", title: "CSV file is empty" });
          return;
        }
        let previewHtml = `<div style="max-height: 300px; overflow-y: auto;"><table style="width:100%; border-collapse: collapse;"><tr style="border-bottom: 1px solid var(--border);"><th>Name</th><th>Phone</th><th>House</th><th>Rent</th><th>Due Date</th></tr>`;
        tenants.slice(0, 10).forEach((t) => {
          previewHtml += `<tr><td>${t.name || ""}</td><td>${
            t.phoneNumber || ""
          }</td><td>${t.houseNumber || ""}</td><td>${t.rent || ""}</td><td>${
            t.dueDate || ""
          }</td></tr>`;
        });
        if (tenants.length > 10)
          previewHtml += `<tr><td colspan="5" style="text-align:center;">... and ${
            tenants.length - 10
          } more</td></tr>`;
        previewHtml += `</table></div>`;
        const result = await Swal.fire({
          title: `Import ${tenants.length} tenants?`,
          html: previewHtml,
          icon: "question",
          showCancelButton: true,
          confirmButtonColor: "#3b82f6",
          confirmButtonText: "Yes, import",
          background: "#1e293b",
          color: "#f1f5f9",
        });
        if (result.isConfirmed) {
          try {
            const response = await fetchWithTimeout(
              window.location.origin + "/tenants/import",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${localStorage.getItem("token")}`,
                },
                body: JSON.stringify({ tenants }),
              }
            );
            const data = await response.json();

            if (response.ok) {
              let msg = `Imported ${data.created} tenants.`;
              if (data.errors) msg += ` ${data.errors.length} skipped.`;
              Toast.fire({ icon: "success", title: msg });
              await loadTenants();
            } else {
              Toast.fire({
                icon: "error",
                title: data.message || "Import failed",
              });
            }
          } catch (err) {
            Toast.fire({ icon: "error", title: err.message });
          }
        }
      },
      error: (err) => {
        Toast.fire({ icon: "error", title: "Failed to parse CSV" });
      },
    });
  });
}

async function updateArchivedBadge() {
  try {
    const response = await fetchWithTimeout(
      window.location.origin + "/tenants/archived/count",
      {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      }
    );
    if (response.ok) {
      const data = await response.json();
      const btn = document.getElementById("toggle-archived-btn");
      if (btn) {
        btn.textContent = showArchived
          ? `👁️ Hide Archived (${data.count})`
          : `📦 Show Archived (${data.count})`;
      }
    }
  } catch (err) {
    console.warn("Failed to fetch archived count", err);
  }
}

// ----- ESC KEY TO CLOSE MODALS -----
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modals = [
      "tenant-actions-modal",
      "profile-modal",
      "history-modal",
      "payment-modal",
      "utilities-modal",
    ];
    modals.forEach((modalId) => {
      const modal = document.getElementById(modalId);
      if (modal && modal.style.display === "block")
        modal.style.display = "none";
    });
    if (window._closeGlobalSettingsModal) window._closeGlobalSettingsModal();
    const overlay = document.getElementById("modal-overlay");
    if (overlay) overlay.style.display = "none";
    document.body.classList.remove("modal-open");
  }
});

// ----- COPY PHONE NUMBER FROM PROFILE MODAL -----
document.addEventListener("click", async (e) => {
  const copyBtn = e.target.closest(".copy-phone-btn");
  if (!copyBtn) return;
  const phone = copyBtn.dataset.phone;
  if (!phone) return;
  e.stopPropagation();
  try {
    await navigator.clipboard.writeText(phone);
    Toast.fire({ icon: "success", title: "Copied!", text: phone, timer: 1500 });
  } catch (err) {
    Toast.fire({ icon: "error", title: "Copy failed" });
  }
});

// ----- LANDLORD PROFILE BUTTON -----
document
  .getElementById("landlord-profile-btn")
  .addEventListener("click", () => {
    showLandlordProfileModal();
  });

// ----- TOGGLE ARCHIVED TENANTS -----
document
  .getElementById("toggle-archived-btn")
  .addEventListener("click", async () => {
    showArchived = !showArchived;
    const indicator = document.getElementById("archive-indicator");
    if (indicator) {
      indicator.style.display = showArchived ? "block" : "none";
    }
    await loadTenants();
    const btn = document.getElementById("toggle-archived-btn");
    btn.textContent = showArchived ? "👁️ Hide Archived" : "📦 Show Archived";
  });

// ----- ARCHIVED TENANT ACTIONS (Gear button) -----
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".archived-actions-btn");
  if (!btn) return;
  const tenantId = btn.dataset.id;
  const tenant = tenantArray.find((t) => t._id === tenantId);
  if (!tenant) return;

  const { isConfirmed, isDenied } = await Swal.fire({
    title: `Actions for ${tenant.name}`,
    icon: "question",
    iconColor: "#f59e0b",
    html: `
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 16px;">
        <button id="swal-restore-btn" style="background: #10b981; color: white; border: none; padding: 12px; border-radius: 40px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: transform 0.1s;">↩️ Restore Tenant</button>
        <button id="swal-delete-btn" style="background: #ef4444; color: white; border: none; padding: 12px; border-radius: 40px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: transform 0.1s;">🗑️ Delete Permanently</button>
      </div>
    `,
    showCancelButton: true,
    cancelButtonText: "Cancel",
    showConfirmButton: false,
    background: "#1e293b",
    color: "#f1f5f9",
    didOpen: () => {
      const restoreBtn = document.getElementById("swal-restore-btn");
      const deleteBtn = document.getElementById("swal-delete-btn");
      if (restoreBtn) {
        restoreBtn.onclick = () => Swal.clickConfirm();
        restoreBtn.onmouseenter = () =>
          (restoreBtn.style.transform = "scale(1.02)");
        restoreBtn.onmouseleave = () =>
          (restoreBtn.style.transform = "scale(1)");
      }
      if (deleteBtn) {
        deleteBtn.onclick = () => Swal.clickDeny();
        deleteBtn.onmouseenter = () =>
          (deleteBtn.style.transform = "scale(1.02)");
        deleteBtn.onmouseleave = () => (deleteBtn.style.transform = "scale(1)");
      }
    },
  });

  if (isConfirmed) {
    // Restore
    setButtonLoading(btn, true);
    try {
      const response = await fetchWithTimeout(
        window.location.origin + `/tenants/${tenantId}/restore`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );
      if (response.ok) {
        await loadTenants();
        Toast.fire({ icon: "success", title: "Tenant restored" });
      } else {
        Toast.fire({ icon: "error", title: "Restore failed" });
      }
    } catch (err) {
      Toast.fire({ icon: "error", title: err.message });
    } finally {
      setButtonLoading(btn, false);
    }
  } else if (isDenied) {
    // Delete permanently
    const confirm = await Swal.fire({
      title: "Permanently Delete?",
      text: "This action cannot be undone. All payment history will be lost.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      confirmButtonText: "Yes, delete forever",
      background: "#1e293b",
      color: "#f1f5f9",
    });
    if (confirm.isConfirmed) {
      setButtonLoading(btn, true);
      try {
        const response = await fetchWithTimeout(
          window.location.origin + `/tenants/${tenantId}/permanent`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }
        );
        if (response.ok) {
          await loadTenants();
          Toast.fire({ icon: "success", title: "Tenant deleted permanently" });
        } else {
          Toast.fire({ icon: "error", title: "Delete failed" });
        }
      } catch (err) {
        Toast.fire({ icon: "error", title: err.message });
      } finally {
        setButtonLoading(btn, false);
      }
    }
  }
});
// ----- IMPORT/EXPORT MODAL (direct, robust) -----
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("DOMContentLoaded", () => {
    const indicator = document.getElementById("archive-indicator");
    if (indicator) indicator.style.display = "none";
  });

  const importExportModal = document.getElementById("import-export-modal");
  const overlay = document.getElementById("modal-overlay");
  const openBtn = document.getElementById("data-import-export-btn");
  const closeModal = () => {
    if (importExportModal) importExportModal.style.display = "none";
    if (overlay) overlay.style.display = "none";
    document.body.classList.remove("modal-open");
  };

  if (openBtn) {
    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (importExportModal) {
        importExportModal.style.display = "block";
        if (overlay) overlay.style.display = "block";
        document.body.classList.add("modal-open");
      } else {
        console.error("Import/export modal not found!");
      }
    });
  } else {
    console.error("Button #data-import-export-btn not found!");
  }

  // Close buttons
  const closeBtns = ["close-import-export-modal", "close-import-export-footer"];
  closeBtns.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", closeModal);
  });

  // Export All Tenants (as PDF)
  const exportAllBtn = document.getElementById("export-all-data-btn");
  if (exportAllBtn) {
    exportAllBtn.addEventListener("click", () => {
      const token = localStorage.getItem("token");
      const url =
        window.location.origin +
        `/tenants/export/statement?type=all&token=${encodeURIComponent(token)}`;
      window.open(url, "_blank");
      closeModal();
    });
  }

  // Export Late Tenants (as PDF)
  const exportLateBtn = document.getElementById("export-late-data-btn");
  if (exportLateBtn) {
    exportLateBtn.addEventListener("click", () => {
      const token = localStorage.getItem("token");
      const url =
        window.location.origin +
        `/tenants/export/statement?type=late&token=${encodeURIComponent(
          token
        )}`;
      window.open(url, "_blank");
      closeModal();
    });
  }

  // Import
  const importBtn = document.getElementById("import-data-btn");
  if (importBtn) {
    importBtn.addEventListener("click", () => {
      importTenantsFromCSV();
      closeModal();
    });
  }
});

function updateStatusBar() {
  const statusBar = document.getElementById("status-bar");
  if (!statusBar) return;

  const currentMonth = getCurrentMonth();

  // Count tenants missing water reading for current month
  const tenantsMissingWater = tenantArray.filter((tenant) => {
    return !(tenant.waterMeterReadings || []).some(
      (r) => r.month === currentMonth
    );
  });
  const missingCount = tenantsMissingWater.length;

  // Check garbage fee
  const garbageFeeSet = globalSettings.garbageFee > 0;

  let html = "";

  if (missingCount > 0) {
    html += `
      <div class="status-bar-item">
        <span>💧 ${missingCount} tenant${
      missingCount !== 1 ? "s" : ""
    } missing water reading for ${currentMonth}</span>
        <button id="status-bar-water-action">Show tenants</button>
      </div>
    `;
  }

  if (!garbageFeeSet) {
    html += `
      <div class="status-bar-item">
        <span>🗑️ Garbage fee not set (charges will be 0)</span>
        <button id="status-bar-garbage-action">Set fee</button>
      </div>
    `;
  }

  if (html) {
    statusBar.innerHTML = html;
    statusBar.style.display = "flex";

    // Attach event listeners
    const waterBtn = document.getElementById("status-bar-water-action");
    if (waterBtn) {
      waterBtn.addEventListener("click", () => {
        // Apply filter: show only tenants missing water reading
        const filterSelect = document.getElementById("filter-select");
        if (filterSelect) {
          // Add a temporary filter option if not present
          let option = Array.from(filterSelect.options).find(
            (opt) => opt.value === "missing-water"
          );
          if (!option) {
            option = document.createElement("option");
            option.value = "missing-water";
            option.textContent = "🚰 Missing Water Reading";
            filterSelect.appendChild(option);
          }
          filterSelect.value = "missing-water";
          applyFiltersAndSort();
          Toast.fire({
            icon: "info",
            title: "Filter applied",
            text: "Select 'All' in the filter menu to clear.",
            timer: 4000,
          });
        }
      });
    }

    const garbageBtn = document.getElementById("status-bar-garbage-action");
    if (garbageBtn) {
      garbageBtn.addEventListener("click", () => {
        showGlobalSettingsModal();
      });
    }
  } else {
    statusBar.style.display = "none";
  }
}

if (window.location.search.includes("dev=true")) {
  document.querySelector(".set-month-row").style.display = "flex";
} else {
  document.querySelector(".set-month-row").style.display = "none";
}
