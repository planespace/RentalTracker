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
let globalSettings = { garbageFee: 0, waterRatePerUnit: 0, totalHouses: 0 };

let userProfile = { name: "", email: "", phone: "", landlordName: "" };

function getAppToday() {
  let result;

  // 1) Prefer the dev date
  if (devModeActive && currentDevDate) {
    const [y, m, d] = currentDevDate.split("-").map(Number);
    result = new Date(Date.UTC(y, m - 1, d));
    console.log(
      `[getAppToday] DEV active → using dev date ${currentDevDate} → ${result.toISOString()}`
    );
    return result;
  }

  // 2) Use server‑provided currentAppDate
  if (!currentAppDate) {
    const now = new Date();
    result = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    console.log(
      `[getAppToday] no currentAppDate → real UTC today → ${result.toISOString()}`
    );
    return result;
  }

  // 3) Fallback to server date
  const d = new Date(currentAppDate);
  result = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  console.log(
    `[getAppToday] using server currentAppDate (${currentAppDate}) → ${result.toISOString()}`
  );
  return result;
}
async function fetchAndDisplaySmsBalance() {
  try {
    const res = await fetchWithTimeout(
      window.location.origin + "/tenants/sms-balance",
      {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      }
    );
    const data = await res.json();
    if (data.balance !== undefined && data.balance !== null) {
      let badge = document.getElementById("sms-balance-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.id = "sms-balance-badge";
        badge.style.marginLeft = "12px";
        badge.style.fontSize = "0.75rem";
        badge.style.background = "#10b98120";
        badge.style.padding = "4px 10px";
        badge.style.borderRadius = "40px";
        badge.style.fontWeight = "500";
        const bulkBtn = document.getElementById("bulk-sms-btn");
        if (bulkBtn)
          bulkBtn.parentNode.insertBefore(badge, bulkBtn.nextSibling);
      }
      badge.textContent = `💰 ${data.balance.toLocaleString()} KES credit`;
    }
  } catch (err) {
    console.warn("Cannot fetch SMS balance");
  }
}

function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  defaultDueDay,
  totalHouses,
  autoRemindersEnabled,
  reminderTemplate
) {
  const response = await fetchWithTimeout(
    window.location.origin + "/tenants/settings",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify({
        garbageFee,
        waterRatePerUnit,
        defaultDueDay,
        totalHouses,
        autoRemindersEnabled,
        reminderTemplate,
      }),
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
  try {
    const resp = await fetchWithTimeout(window.location.origin + "/tenants", {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (resp.ok) {
      const tenants = await resp.json();
      // Only run the safety sync if we are NOT in dev mode
      if (!devModeActive) {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const needsSync = tenants.some(
          (t) => !t.paymentHistory?.some((e) => e.month === currentMonth)
        );
        if (needsSync) {
          await fetchWithTimeout(window.location.origin + "/tenants/sync", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          });
        }
      }
    }
  } catch (err) {
    console.warn("Background sync check failed", err);
  }

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
    applyFiltersAndSort();
    updateCharts();
    populateMonthSelector();
    setMonthPickerDefault();
    updateAllTimeStats(tenantArray);
    updateArchivedBadge();
    updateStatusBar();
    updateOccupancy();
    fetchAndDisplaySmsBalance();
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
  const today = getAppToday();
  return months.map((targetMonth) => {
    // For each target month, we want the total overdue that existed at the end of that month.
    // Overdue = sum of remainingBalance for months whose due date < last day of targetMonth.
    // Use the end of targetMonth as the "today" for that historical date.
    const [year, mon] = targetMonth.split("-").map(Number);
    const endOfMonth = new Date(year, mon, 0); // last day of targetMonth, local midnight
    endOfMonth.setHours(0, 0, 0, 0);

    let totalOverdue = 0;
    for (let tenant of tenantArray) {
      // Use the same overdue logic as getTenantPastDueAmount, but with endOfMonth as the snapshot date.
      const overdue = getTenantPastDueAmount(tenant, endOfMonth);
      totalOverdue += overdue;
    }
    return totalOverdue;
  });
}
function updateCharts() {
  // ---------- Donut chart (paid = no overdue balance) ----------
  let paid = 0,
    unpaid = 0;
  const today = getAppToday();

  for (let tenant of tenantArray) {
    const pastDue = getTenantPastDueAmount(tenant, today);
    if (pastDue === 0) paid++;
    else unpaid++;
  }

  const donutCtx = document.getElementById("paidDonutChart").getContext("2d");
  const donutData = [paid, unpaid];
  if (paidDonutChart) {
    paidDonutChart.destroy();
  }
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
      // Expected: totalDue from the charge entry (if exists)
      const chargeEntry = tenant.paymentHistory.find(
        (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
      );
      if (chargeEntry) {
        expectedSum += chargeEntry.totalDue || 0;
      } else {
        // Fallback only if no charge entry (should rarely happen)
        expectedSum += tenant.rent + (globalSettings.garbageFee || 0);
      }
      // Collected: sum of all payment entries for that month
      const paidEntries = tenant.paymentHistory.filter(
        (e) => e.month === month && e.amountPaid > 0
      );
      collectedSum += paidEntries.reduce((sum, e) => sum + e.amountPaid, 0);
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
  const billingMonth = getCurrentBillingMonthForTenant(tenant);
  let records = tenant.paymentHistory.filter((r) => r.month === billingMonth);
  if (records.length === 0) {
    const computedDueDate = getTenantNextDueDate(tenant);
    return {
      month: billingMonth,
      paid: false,
      datePaid: null,
      dueDate: computedDueDate,
    };
  }
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
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(dueDay, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}
function getTenantNextDueDate(tenant) {
  const today = getAppToday();
  const todayStr = today.toISOString().slice(0, 10); // UTC YYYY-MM-DD

  const months = [...new Set(tenant.paymentHistory.map((e) => e.month))].sort();
  for (let month of months) {
    const entries = tenant.paymentHistory.filter((e) => e.month === month);
    entries.sort((a, b) => {
      const aTime = a.datePaid ? new Date(a.datePaid).getTime() : 0;
      const bTime = b.datePaid ? new Date(b.datePaid).getTime() : 0;
      return aTime - bTime;
    });
    const latest = entries[entries.length - 1];
    if (!latest.dueDate) continue;
    const dueDate = new Date(latest.dueDate);
    const dueStr = dueDate.toISOString().slice(0, 10); // UTC YYYY-MM-DD
    if (dueStr >= todayStr) return dueStr;
  }

  // Fallback – use current billing month's due date
  const currentMonth = getCurrentMonth();
  return getDueDateForMonthLocal(tenant, currentMonth);
}

function isLate(dueDate, paid, tenant) {
  const today = getAppToday(); // UTC midnight Date
  const todayStr = today.toISOString().slice(0, 10); // "2026-05-06"

  const latestByMonth = new Map();
  for (let entry of tenant.paymentHistory || []) {
    const existing = latestByMonth.get(entry.month);
    if (!existing) {
      latestByMonth.set(entry.month, entry);
    } else {
      const aTime = entry.datePaid ? new Date(entry.datePaid).getTime() : 0;
      const bTime = existing.datePaid
        ? new Date(existing.datePaid).getTime()
        : 0;
      if (
        aTime > bTime ||
        (aTime === bTime && entry._id.toString() > existing._id.toString())
      ) {
        latestByMonth.set(entry.month, entry);
      }
    }
  }

  for (let entry of latestByMonth.values()) {
    if (entry.remainingBalance > 0 && entry.dueDate) {
      const dueDate = new Date(entry.dueDate); // UTC
      const dueStr = dueDate.toISOString().slice(0, 10); // "2026-05-05"
      if (dueStr < todayStr) return true;
    }
  }

  if (paid) return false;
  if (!dueDate) return false;
  const due = new Date(dueDate);
  return due.toISOString().slice(0, 10) < todayStr;
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

function getTenantBalance(tenant) {
  // Mirrors the logic in renderTenant (ui.js) – active month, sum charges - paid
  const today = getAppToday();
  let activeMonth = null;
  for (let entry of tenant.paymentHistory || []) {
    const due = normalizeDueDate(entry.dueDate);
    if (due && due > today) {
      activeMonth = entry.month;
      break;
    }
  }
  if (!activeMonth) activeMonth = getCurrentMonth();

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
    totalCharges += tenant.rent;
    const settings = globalSettings || { garbageFee: 0 };
    totalCharges += settings.garbageFee || 0;
  }

  let balance = totalCharges - totalPaid;
  if (balance === 0 && tenant.paymentHistory.length === 0) {
    balance = tenant.rent;
  }
  return balance;
}
function getTenantPastDueAmount(tenant, todayDate) {
  const today = new Date(todayDate);
  const todayUTC = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const todayStr = todayUTC.toISOString().slice(0, 10);

  console.log(`🔍 OVERDUE DEBUG for ${tenant.name}`);
  console.log(`   today (UTC): ${todayStr}`);

  const months = [...new Set(tenant.paymentHistory.map((e) => e.month))].sort();
  let lastPastBalance = 0;
  let foundPast = false;

  for (const month of months) {
    const entries = tenant.paymentHistory.filter((e) => e.month === month);
    entries.sort((a, b) => {
      const aTime = a.datePaid ? new Date(a.datePaid).getTime() : 0;
      const bTime = b.datePaid ? new Date(b.datePaid).getTime() : 0;
      return aTime - bTime;
    });
    const latest = entries[entries.length - 1];
    if (!latest || !latest.dueDate) {
      console.log(`   Month ${month}: no due date, skipping`);
      continue;
    }

    const due = new Date(latest.dueDate);
    const dueStr = due.toISOString().slice(0, 10);
    console.log(
      `   Month ${month}: due=${dueStr}, remainingBalance=${latest.remainingBalance}, totalDue=${latest.totalDue}`
    );

    // STOP at the current billing month
    if (dueStr >= todayStr) {
      console.log(
        `   ⛔ STOP at ${month} (due ${dueStr} >= today ${todayStr})`
      );
      break;
    }

    // This month is past due
    lastPastBalance = latest.remainingBalance;
    foundPast = true;
    console.log(`   ✅ Past due: using balance ${lastPastBalance}`);
  }

  const result = foundPast ? Math.max(0, lastPastBalance) : 0;
  console.log(`   🏁 FINAL overdue = ${result}`);
  return result;
}
window.getTenantPastDueAmount = getTenantPastDueAmount;

// ========================
//   EXPECTED & COLLECTED FOR A GIVEN MONTH
// ========================

function getExpectedForMonth(tenant, monthStr, settings) {
  // Try to get the charge entry (amountPaid === 0 and no datePaid)
  const chargeEntry = tenant.paymentHistory.find(
    (e) => e.month === monthStr && (e.amountPaid || 0) === 0 && !e.datePaid
  );
  if (chargeEntry) return chargeEntry.totalDue || 0;
  // Fallback compute (should rarely happen)
  let depositExtra = 0;
  if (tenant.deposit && tenant.depositPeriod) {
    const firstMonth = tenant.paymentHistory.map((e) => e.month).sort()[0];
    if (firstMonth) {
      const [fy, fm] = firstMonth.split("-").map(Number);
      const endDate = new Date(fy, fm - 1 + tenant.depositPeriod - 1, 1);
      const lastDepMonth = `${endDate.getFullYear()}-${String(
        endDate.getMonth() + 1
      ).padStart(2, "0")}`;
      if (monthStr <= lastDepMonth) {
        depositExtra = Math.round(tenant.rent / tenant.depositPeriod);
      }
    }
  }
  const baseRent = tenant.rent + depositExtra;
  const waterCharge =
    tenant.waterMeterReadings?.find((r) => r.month === monthStr)?.cost || 0;
  const garbage =
    (settings && settings.garbageFee) || globalSettings?.garbageFee || 0;
  return baseRent + waterCharge + garbage;
}

function getCollectedForMonth(tenant, monthStr) {
  return tenant.paymentHistory
    .filter((e) => e.month === monthStr && e.amountPaid > 0)
    .reduce((sum, e) => sum + e.amountPaid, 0);
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
      // Only focus the name input when there are truly zero tenants in the system
      if (tenantArray.length === 0) {
        const nameInput = document.querySelector(".tenant-name");
      }
    }
  });
}
function getCurrentBillingMonthForTenant(tenant) {
  const today = getAppToday();
  const todayUTC = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  );
  const todayStr = `${todayUTC.getUTCFullYear()}-${String(
    todayUTC.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(todayUTC.getUTCDate()).padStart(2, "0")}`;
  const months = [...new Set(tenant.paymentHistory.map((e) => e.month))].sort();
  for (let month of months) {
    const entry = tenant.paymentHistory.find((e) => e.month === month);
    if (!entry || !entry.dueDate) continue;
    const dueUTC = new Date(entry.dueDate);
    const dueStr = `${dueUTC.getUTCFullYear()}-${String(
      dueUTC.getUTCMonth() + 1
    ).padStart(2, "0")}-${String(dueUTC.getUTCDate()).padStart(2, "0")}`;
    if (dueStr >= todayStr) return month;
  }
  return months.length ? months[months.length - 1] : getCurrentMonth();
}

function updateStats(tenantArray) {
  document.querySelector(
    ".current-month"
  ).innerHTML = `Current Month&Year: ${getCurrentMonth()}`;
  document.querySelector(
    ".stats-subtitle"
  ).textContent = `📅 Statistics for: ${getCurrentMonth()}`;

  let totalOwed = 0;
  let paidTenantsCount = 0;
  let expectedCurrentMonth = 0;
  let collectedCurrentMonth = 0;
  let collectionRate = 0;
  const today = getAppToday();
  const settings = globalSettings;

  for (let tenant of tenantArray) {
    const overdue = getTenantPastDueAmount(tenant, today);
    if (overdue > 0) {
      totalOwed += overdue;
    } else {
      paidTenantsCount++;
    }

    const billingMonth = getCurrentBillingMonthForTenant(tenant);
    expectedCurrentMonth += getExpectedForMonth(tenant, billingMonth, settings);
    collectedCurrentMonth += getCollectedForMonth(tenant, billingMonth);
  }

  collectionRate =
    expectedCurrentMonth === 0
      ? 0
      : Math.round((collectedCurrentMonth / expectedCurrentMonth) * 100);

  document.querySelector(
    ".total-owed"
  ).textContent = `Total past due: ${formatCurrency(totalOwed)}`;
  document.querySelector(
    ".total-paid-tenants"
  ).textContent = `Paid tenants: ${paidTenantsCount}`;
  document.querySelector(
    ".total-expected-rent"
  ).textContent = `Expected this month: ${formatCurrency(
    expectedCurrentMonth
  )}`;
  document.querySelector(
    ".total-paid-rent"
  ).textContent = `Collected this month: ${formatCurrency(
    collectedCurrentMonth
  )}`;
  document.querySelector(
    ".collection-rate"
  ).textContent = `Collection rate: ${collectionRate}%`;
  document.querySelector(".total-late-tenants").textContent = `Late tenants: ${
    tenantArray.length - paidTenantsCount
  }`;

  // Clear unwanted stats
  const totalTenantsEl = document.querySelector(".total-tenants");
  const totalUnpaidEl = document.querySelector(".total-unpaid-tenants");
  const highestDebtorEl = document.querySelector(".highest-debtor");
  if (totalTenantsEl) totalTenantsEl.textContent = "";
  if (totalUnpaidEl) totalUnpaidEl.textContent = "";
  if (highestDebtorEl) highestDebtorEl.textContent = "";
}

function updateOccupancy() {
  const total = globalSettings.totalHouses || 0;
  const occupied = tenantArray.length;
  const el = document.getElementById("occupancy-indicator");
  if (!el) return;
  if (total > 0) {
    el.textContent = `🏠 ${occupied} / ${total} houses occupied`;
    el.style.display = "";
  } else {
    el.style.display = "none";
  }
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

  const today = getAppToday(); // UTC midnight Date
  const todayStr = today.toISOString().slice(0, 10); // "2026-05-06"

  // Determine the active billing month (first month whose due date is ≥ today)
  let activeMonth = null;
  for (let entry of sortedHistory) {
    if (!entry.dueDate) continue;
    const dueDate = new Date(entry.dueDate);
    const dueStr = dueDate.toISOString().slice(0, 10);
    if (dueStr >= todayStr) {
      activeMonth = entry.month;
      break;
    }
  }
  if (!activeMonth) {
    // all due dates are past – active is the current calendar month
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
    const isChargeEntry = (entry.amountPaid || 0) === 0 && !entry.datePaid;

    // For charge entries, show the **original total due** (never changes)
    // For payment entries, show the running remaining balance after the payment
    let displayBalance;
    if (isChargeEntry) {
      displayBalance =
        entry.totalDue ||
        entry.baseRent +
          (entry.waterCharge || 0) +
          (entry.garbageCharge || 0) ||
        0;
    } else {
      displayBalance = entry.remainingBalance;
      // Overpayment visual: if negative, show "+" and absolute value
      if (displayBalance < 0) {
        const hasLaterPositive = sortedHistory.some(
          (e) => e.month > entry.month && e.remainingBalance > 0
        );
        if (hasLaterPositive) displayBalance = 0; // hide overpayment if later months still unpaid
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
    <span class="record-month">${entry.month}${
      isChargeEntry ? " ⚡Charge" : ""
    }</span>
    <span class="record-amount-paid">${
      isChargeEntry ? "—" : entry.amountPaid.toLocaleString()
    }</span>
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
    ${
      isChargeEntry
        ? `<span class="charge-lock" title="System charge – not editable">🔒</span>`
        : `<button class="actions-btn" data-id="${entry._id}" data-month="${
            entry.month
          }" data-amount="${entry.amountPaid}" data-date="${
            entry.datePaid || ""
          }" data-mpesa="${entry.mpesaRef || ""}">⚙️</button>`
    }
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
      <h4 style="margin-bottom: 0; text-align: center;">⚙️ Global Settings</h4>
      
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
      
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="color: var(--text-secondary); font-size: 0.9rem;">Total Houses</label>
        <input type="number" id="global-total-houses" min="0" value="${
          globalSettings.totalHouses || 0
        }" class="swal2-input" style="margin: 0;">
      </div>

   <!-- Big checkbox for auto reminders -->
<div style="display: flex; flex-direction: column; align-items: center; gap: 8px; margin: 16px 0;">
  <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
    <input type="checkbox" id="global-auto-reminders" style="width: 28px; height: 28px; transform: scale(1.1); accent-color: #10b981;" ${
      globalSettings.autoRemindersEnabled !== false ? "checked" : ""
    }>

   

    <span style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary);">Send automatic overdue reminders</span>
  </label>
  <span style="font-size: 0.8rem; color: var(--text-muted); text-align: center;">Daily check for unpaid tenants (costs ~KES 0.80 per message)</span>
</div>


 


 <div style="display: flex; flex-direction: column; gap: 6px;">
  <label style="color: var(--text-secondary); font-size: 0.9rem;">✏️ Auto‑reminder SMS Template</label>
  <textarea id="global-reminder-template" rows="3" style="padding: 10px; border-radius: 16px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border);">${
    globalSettings.reminderTemplate || ""
  }</textarea>
  <small style="color: var(--text-muted);">Use {name}, {amount}, {dueDate}, {monthsCount}</small>
</div>






<div style="display: flex; flex-direction: column; gap: 6px;">
  <button id="resend-overdue-reminders-btn" class="modal-action-btn" style="background: #f59e0b;">📢 Resend Overdue Reminders Now</button>
</div>

      <div style="display: flex; flex-direction: column; gap: 6px;">
        <button id="change-due-day-btn" class="modal-action-btn" style="background: var(--accent-cyan);">📅 Change Due Day for All Tenants</button>
      </div>




      <div style="display: flex; flex-direction: column; gap: 6px;">
        <button id="change-rent-btn" class="modal-action-btn" style="background: var(--accent-cyan);">💰 Change Rent for All Tenants</button>
      </div>
      
     <div class="utility-actions" style="margin-top: 8px; display: flex; justify-content: center; gap: 12px;">
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

  // After setting innerHTML
  // After setting innerHTML, find the auto reminders checkbox
  const autoRemindersCheckbox = document.getElementById(
    "global-auto-reminders"
  );
  if (autoRemindersCheckbox) {
    // Remove any existing listener to avoid duplicates
    const oldListener = autoRemindersCheckbox._listener;
    if (oldListener)
      autoRemindersCheckbox.removeEventListener("change", oldListener);

    const handleAutoReminderChange = async (e) => {
      const isChecked = e.target.checked;

      // If enabling, show cost estimate (just as info, no immediate send)
      if (isChecked) {
        try {
          let countUrl = window.location.origin + "/tenants/overdue-count";
          if (currentDevDate) countUrl += `?devDate=${currentDevDate}`;
          const res = await fetchWithTimeout(countUrl, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          });
          const data = await res.json();
          const overdueCount = data.count || 0;
          const totalCost = overdueCount * 0.8;

          await Swal.fire({
            title: "Auto‑reminders enabled",
            html: `
              <div style="text-align: center;">
                <p>Automatic daily reminders are now <strong>ON</strong>.</p>
                <div style="background: linear-gradient(135deg, #f59e0b20, #3b82f620); padding: 16px; border-radius: 20px; margin: 12px 0;">
                  <div style="font-size: 1.6rem; font-weight: 800; color: #fbbf24;">KES ${totalCost.toFixed(
                    2
                  )}</div>
                  <div style="font-size: 0.8rem;">Estimated next run cost (${overdueCount} messages × KES 0.80)</div>
                </div>
                <p class="swal2-text" style="font-size: 0.85rem;">Reminders are sent <strong>once per billing month</strong> for each overdue tenant, daily at 8:00 AM.</p>
                <p style="font-size: 0.8rem; margin-top: 8px;">You can also click the<strong>📢 Resend Overdue Reminders</strong> button to send immediately.</p>
              </div>
            `,
            icon: "success",
            confirmButtonText: "Got it",
            confirmButtonColor: "#10b981",
            background: "#1e293b",
            color: "#f1f5f9",
          });
        } catch (err) {
          Toast.fire({
            icon: "warning",
            title: "Could not fetch overdue count",
          });
        }
      }

      // Save the setting immediately (no SMS sent)
      setButtonLoading(e.target, true);
      try {
        const garbageFee =
          parseFloat(document.getElementById("global-garbage").value) || 0;
        const waterRatePerUnit =
          parseFloat(document.getElementById("global-waterrate").value) || 0;
        const defaultDueDay =
          parseInt(document.getElementById("global-default-due-day").value) ||
          1;
        const totalHouses =
          parseInt(document.getElementById("global-total-houses").value) || 0;
        const reminderTemplate = document.getElementById(
          "global-reminder-template"
        ).value;

        const ok = await updateGlobalSettingsOnServer(
          garbageFee,
          waterRatePerUnit,
          defaultDueDay,
          totalHouses,
          isChecked,
          reminderTemplate
        );

        if (ok) {
          await fetchGlobalSettings();
          Toast.fire({
            icon: "success",
            title: `Auto‑reminders ${isChecked ? "enabled" : "disabled"}`,
          });
        } else {
          Toast.fire({ icon: "error", title: "Failed to save setting" });
          e.target.checked = !isChecked;
        }
      } catch (err) {
        Toast.fire({ icon: "error", title: err.message });
        e.target.checked = !isChecked;
      } finally {
        setButtonLoading(e.target, false);
      }
    };

    autoRemindersCheckbox.addEventListener("change", handleAutoReminderChange);
    autoRemindersCheckbox._listener = handleAutoReminderChange;
  }

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

    // ----- NEW: Change Rent for All Tenants -----
    if (e.target.id === "change-rent-btn") {
      const { value: newRent } = await Swal.fire({
        title: "Change Rent for All Tenants",
        input: "number",
        inputLabel: "New Rent Amount (KSH)",
        inputAttributes: { min: "1", step: "any" },
        inputValue: globalSettings.defaultDueDay || 1, // placeholder
        showCancelButton: true,
        confirmButtonText: "Update All",
        confirmButtonColor: "#3b82f6",
        background: "#1e293b",
        color: "#f1f5f9",
        inputValidator: (val) => {
          if (!val || Number(val) <= 0) return "Enter a valid positive amount";
        },
      });

      if (newRent) {
        setButtonLoading(e.target, true);
        try {
          const res = await fetchWithTimeout(
            window.location.origin + "/tenants/bulk-change-rent",
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              },
              body: JSON.stringify({ newRent: Number(newRent) }),
            }
          );
          if (res.ok) {
            await loadTenants();
            Toast.fire({
              icon: "success",
              title: `Rent updated to ${newRent}`,
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
    if (e.target.id === "resend-overdue-reminders-btn") {
      const btn = e.target;
      setButtonLoading(btn, true);
      try {
        // Fetch overdue count first
        let url = window.location.origin + "/tenants/overdue-count";
        if (currentDevDate) url += `?devDate=${currentDevDate}`;
        const countRes = await fetchWithTimeout(url, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });
        const countData = await countRes.json();
        const overdueCount = countData.count || 0;
        const totalCost = overdueCount * 0.8;

        if (overdueCount === 0) {
          Toast.fire({
            icon: "info",
            title: "No overdue tenants at the moment.",
          });
          setButtonLoading(btn, false);
          return;
        }

        const confirm = await Swal.fire({
          title: "📢 Resend Overdue Reminders",
          html: `
        <div style="text-align: center;">
          <div style="font-size: 1.1rem; margin-bottom: 16px;">You are about to send reminders to <strong>${overdueCount}</strong> tenant(s).</div>
          <div style="background: linear-gradient(135deg, #f59e0b20, #3b82f620); padding: 16px; border-radius: 24px; margin: 16px 0;">
            <div style="font-size: 2rem; font-weight: 800; color: #fbbf24;">KES ${totalCost.toFixed(
              2
            )}</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">Estimated cost (${overdueCount} messages × KES 0.80)</div>
          </div>
          <div style="font-size: 0.85rem; color: var(--text-muted);">This will send a reminder to each tenant who is currently overdue (once per billing month).</div>
        </div>
      `,
          icon: "question",
          showCancelButton: true,
          confirmButtonText: `Yes, resend to ${overdueCount} tenant(s)`,
          confirmButtonColor: "#f59e0b",
          cancelButtonText: "Cancel",
          background: "#1e293b",
          color: "#f1f5f9",
        });

        if (!confirm.isConfirmed) {
          setButtonLoading(btn, false);
          return;
        }

        // Now trigger the reminders
        let triggerUrl = window.location.origin + "/tenants/trigger-reminders";
        const params = new URLSearchParams();
        if (currentDevDate) params.append("devDate", currentDevDate);
        params.append("force", "true");
        if (params.toString()) triggerUrl += `?${params.toString()}`;

        const response = await fetchWithTimeout(triggerUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });

        const data = await response.json();
        if (response.ok) {
          const sent = (data.results || []).filter((r) => r.success).length;
          Toast.fire({
            icon: "success",
            title: `Reminders sent to ${sent} tenant(s).`,
          });
        } else {
          Toast.fire({
            icon: "error",
            title: data.message || "Failed to send",
          });
        }
      } catch (err) {
        Toast.fire({ icon: "error", title: err.message });
      } finally {
        setButtonLoading(btn, false);
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
      const totalHouses =
        parseInt(document.getElementById("global-total-houses").value) || 0;
      setButtonLoading(e.target, true);
      const reminderTemplate = document.getElementById(
        "global-reminder-template"
      ).value;

      const autoRemindersEnabled = document.getElementById(
        "global-auto-reminders"
      ).checked;

      try {
        const ok = await updateGlobalSettingsOnServer(
          garbageFee,
          waterRatePerUnit,
          defaultDueDay,
          totalHouses,
          autoRemindersEnabled,
          reminderTemplate
        );
        if (ok) {
          await fetchGlobalSettings();
          await loadTenants();
          updateTenantList(tenantArray); // extra safety
          updateStatusBar();
          updateOccupancy();
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

    // --- NEW CHECK ---
    if (
      !globalSettings.waterRatePerUnit ||
      globalSettings.waterRatePerUnit <= 0
    ) {
      Toast.fire({
        icon: "warning",
        title: "Water rate not set",
        text: "Please configure the water rate in Global Settings first.",
      });
      return; // stop execution
    }

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
    let url =
      window.location.origin +
      `/tenants/${
        window.currentActionsTenantId
      }/statement?token=${encodeURIComponent(token)}`;
    if (currentDevDate) {
      url += `&devDate=${currentDevDate}`;
    }
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

  if (e.target.id === "modal-send-sms") {
    showIndividualSmsModal(window.currentActionsTenantId);
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
        updateCharts();
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
      return getTenantPastDueAmount(tenant, getAppToday()) > 0;
    });
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
              : 0,
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

  if (filterValue === "late") {
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

  if (sortValue === "balance-high") {
    result.sort((a, b) => {
      const balA = getTenantPastDueAmount(a, getAppToday());
      const balB = getTenantPastDueAmount(b, getAppToday());
      return balB - balA;
    });
  } else if (sortValue === "balance-low") {
    result.sort((a, b) => {
      const balA = getTenantPastDueAmount(a, getAppToday());
      const balB = getTenantPastDueAmount(b, getAppToday());
      return balA - balB;
    });
  } else {
    // Default: natural alphanumeric sort by house number
    result.sort((a, b) => {
      const ha = String(a.houseNumber || "").trim();
      const hb = String(b.houseNumber || "").trim();
      return ha.localeCompare(hb, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }

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

  // Export All Tenants (as styled HTML in new tab)
  const exportAllBtn = document.getElementById("export-all-data-btn");
  if (exportAllBtn) {
    exportAllBtn.addEventListener("click", () => {
      const token = localStorage.getItem("token");
      let url =
        window.location.origin +
        `/tenants/export/statement?type=all&token=${encodeURIComponent(token)}`;
      if (currentDevDate) url += `&devDate=${currentDevDate}`;
      window.open(url, "_blank");
      closeModal();
    });
  }

  // Export Late Tenants (as styled HTML in new tab)
  const exportLateBtn = document.getElementById("export-late-data-btn");
  if (exportLateBtn) {
    exportLateBtn.addEventListener("click", () => {
      const token = localStorage.getItem("token");
      let url =
        window.location.origin +
        `/tenants/export/statement?type=late&token=${encodeURIComponent(
          token
        )}`;
      if (currentDevDate) url += `&devDate=${currentDevDate}`;
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

function updateAllTimeStats(tenantArray) {
  let allTimeOwed = 0;
  let allTimeCollected = 0;
  let highestDebtAmount = 0;
  let highestDebtor = null;
  const today = getAppToday();

  for (let tenant of tenantArray) {
    // Total collected – sum all payments ever made
    tenant.paymentHistory.forEach((record) => {
      if (record.amountPaid) allTimeCollected += record.amountPaid;
    });

    // Overdue balance (past billing months only)
    const overdue = getTenantPastDueAmount(tenant, today);
    if (overdue > 0) {
      allTimeOwed += overdue;
      if (overdue > highestDebtAmount) {
        highestDebtAmount = overdue;
        highestDebtor = tenant;
      }
    }
  }

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

async function showIndividualSmsModal(tenantId, prefillMessage = "") {
  const tenant = tenantArray.find((t) => t._id === tenantId);
  if (!tenant) return;

  const today = getAppToday();
  const overdue = window.getTenantPastDueAmount
    ? window.getTenantPastDueAmount(tenant, today)
    : 0;

  const templates = {
    payment: `Dear ${
      tenant.name
    }, your overdue rent is KES ${overdue.toLocaleString()}. Please pay to avoid penalties. Thank you.`,
    water: `Kindly provide your water meter reading for ${getCurrentMonth()} to help us generate an accurate bill.`,
    thanks: `Dear ${tenant.name}, thank you for your payment. Have a great day!`,
    reminder: `Reminder: Rent of KES ${tenant.rent.toLocaleString()} is due. Please pay by the due date to avoid penalties.`,
    moveOut: `Notice: Your tenancy at ${tenant.houseNumber} ends soon. Please ensure all dues are cleared and return keys by the agreed date.`,
  };

  const { value: message } = await Swal.fire({
    title: `📱 Send SMS to ${tenant.name}`,
    html: `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <select id="individual-template" style="padding: 10px; border-radius: 40px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border);">
          <option value="custom">✏️ Custom message</option>
          <option value="payment">💰 Payment reminder (avoid penalties)</option>
          <option value="water">💧 Water meter reading</option>
          <option value="thanks">🙏 Thank you</option>
          <option value="reminder">⏰ Gentle rent reminder</option>
          <option value="moveOut">🚪 Move out notice</option>
        </select>
        <textarea id="individual-message" rows="5" placeholder="Type your message here..." style="padding: 12px; border-radius: 20px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); width: 100%;">${escapeHtml(
          prefillMessage
        )}</textarea>
        <div style="font-size: 0.75rem; color: var(--text-muted); text-align: right;">Characters: <span id="ind-char-count">${
          prefillMessage.length
        }</span></div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: "Next",
    confirmButtonColor: "#3b82f6",
    cancelButtonText: "Cancel",
    background: "#1e293b",
    color: "#f1f5f9",
    customClass: { popup: "individual-sms-modal" },
    preConfirm: () => {
      const msg = document.getElementById("individual-message").value;
      if (!msg.trim()) {
        Swal.showValidationMessage("Message cannot be empty.");
        return false;
      }
      return msg;
    },
    didOpen: () => {
      const templateSelect = document.getElementById("individual-template");
      const textarea = document.getElementById("individual-message");
      const charSpan = document.getElementById("ind-char-count");

      const updateCounter = () => {
        charSpan.textContent = textarea.value.length;
      };
      textarea.addEventListener("input", updateCounter);
      updateCounter();

      templateSelect.addEventListener("change", () => {
        const val = templateSelect.value;
        if (val === "custom") {
          textarea.value = "";
        } else {
          textarea.value = templates[val] || "";
        }
        updateCounter();
      });
    },
  });

  if (!message) return;

  const confirm = await Swal.fire({
    title: "📨 Confirm SMS",
    html: `
      <div style="text-align: center;">
        <div style="font-size: 1.1rem; margin-bottom: 16px;">You are about to send an SMS to <strong>${escapeHtml(
          tenant.name
        )}</strong>.</div>
        <div style="background: linear-gradient(135deg, #10b98120, #3b82f620); padding: 16px; border-radius: 24px; margin: 16px 0;">
          <div style="font-size: 2rem; font-weight: 800; color: #fbbf24;">KES 0.80</div>
          <div style="font-size: 0.85rem; color: var(--text-secondary);">Estimated cost (1 message × KES 0.80)</div>
        </div>
        <div style="background: var(--bg-elevated, #1e293b); padding: 12px; border-radius: 20px; text-align: left;">
          <div style="font-weight: 600; margin-bottom: 5px;">📝 Message preview:</div>
          <div style="font-size: 0.9rem; word-break: break-word;">“${escapeHtml(
            message.substring(0, 100)
          )}${message.length > 100 ? "…" : ""}”</div>
        </div>
      </div>
    `,
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Yes, send (KES 0.80)",
    confirmButtonColor: "#10b981",
    cancelButtonText: "Cancel",
    background: "#1e293b",
    color: "#f1f5f9",
  });

  if (!confirm.isConfirmed) return;

  const btn = document.getElementById("modal-send-sms");
  setButtonLoading(btn, true);
  try {
    const response = await fetchWithTimeout(
      window.location.origin + "/tenants/send-sms",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ tenantIds: [tenantId], message }),
      }
    );
    const data = await response.json();
    if (response.ok) {
      const success = (data.results || [])[0]?.success;
      if (success) {
        Toast.fire({ icon: "success", title: "SMS sent successfully" });
      } else {
        Toast.fire({ icon: "error", title: "Failed to send SMS" });
      }
    } else {
      Toast.fire({ icon: "error", title: data.message || "Failed to send" });
    }
  } catch (err) {
    Toast.fire({ icon: "error", title: err.message });
  } finally {
    setButtonLoading(btn, false);
  }
}

// Open the bulk SMS modal

document.getElementById("bulk-sms-btn").addEventListener("click", () => {
  const btn = document.getElementById("bulk-sms-btn");
  let tenants = [...tenantArray];
  if (tenants.length === 0) {
    Toast.fire({ icon: "warning", title: "No tenants to message." });
    return;
  }

  // Sort by house number
  tenants.sort((a, b) => {
    const ha = String(a.houseNumber || "").trim();
    const hb = String(b.houseNumber || "").trim();
    return ha.localeCompare(hb, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  const today = getAppToday();
  const costPerMsg = 0.8; // KES

  // Build HTML – with selection buttons
  let html = `
  <div style="display: flex; flex-direction: column; gap: 16px;">
    <div>
  <select id="sms-template-bulk" style="width: 100%; padding: 10px; border-radius: 40px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); margin-bottom: 8px;">
  <option value="custom">✏️ Custom message</option>
  <option value="payment">💰 Payment reminder (avoid penalties)</option>
  <option value="water">💧 Water meter reading</option>
  <option value="thanks">🙏 Thank you (after payment)</option>
  <option value="reminder">⏰ Gentle rent reminder</option>
  <option value="late">⚠️ Late payment warning</option>
</select>
      <textarea id="sms-message" rows="4" placeholder="Type your message here..." style="width:100%; padding: 10px; font-size: 0.95rem; border-radius: 10px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); resize: vertical;"></textarea>
      <div id="sms-char-counter" style="text-align: right; font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">0 characters</div>
    </div>

    <!-- Selection buttons row (added) -->
    <div style="display: flex; gap: 12px; justify-content: flex-start; padding: 0 4px;">
      <button id="sms-select-all" style="background: linear-gradient(135deg, #3b82f6, #2563eb); border: none; color: white; padding: 8px 20px; border-radius: 40px; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: 0.1s;">✓ Select All</button>
      <button id="sms-select-late" style="background: linear-gradient(135deg, #f59e0b, #d97706); border: none; color: white; padding: 8px 20px; border-radius: 40px; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: 0.1s;">⚠️ Select Late</button>
    </div>

    <div>
      <div style="max-height: 65vh; overflow-x: auto; overflow-y: auto; background: var(--bg-tertiary); border-radius: 12px; border: 1px solid var(--border);">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border); background: var(--bg-elevated);">
              <th style="padding: 10px 4px; text-align: center; width: 35px;"> </th>
              <th style="padding: 10px 4px; text-align: center;">House</th>
              <th style="padding: 10px 4px; text-align: center;">Name</th>
              <th style="padding: 10px 4px; text-align: center;">Status</th>
              <th style="padding: 10px 4px; text-align: center;">Owed</th>
             </tr>
          </thead>
          <tbody>
`;

  tenants.forEach((tenant) => {
    const overdue = window.getTenantPastDueAmount
      ? window.getTenantPastDueAmount(tenant, today)
      : 0;
    const status = overdue > 0 ? "Past due" : "On time";
    const statusColor = overdue > 0 ? "#ef4444" : "#10b981";
    const balance = formatCurrency(overdue);
    const house = tenant.houseNumber || "—";
    html += `
    <tr style="border-bottom: 1px solid var(--border);">
      <td data-label="Select" style="padding: 10px 4px; text-align: center;">
        <input type="checkbox" class="sms-tenant-select" data-id="${
          tenant._id
        }" data-overdue="${overdue}" value="${
      tenant.name
    }" style="width: 18px; height: 18px; accent-color: #10b981;">
       </td>
      <td data-label="House" style="padding: 10px 4px; text-align: center;">${escapeHtml(
        house
      )}</td>
      <td data-label="Name" style="padding: 10px 4px; text-align: center;">${escapeHtml(
        tenant.name
      )}</td>
      <td data-label="Status" style="padding: 10px 4px; text-align: center; color: ${statusColor};">${status}</td>
      <td data-label="Owed" style="padding: 10px 4px; text-align: center;">${balance}</td>
     </tr>
  `;
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>
    <div id="sms-cost-estimate" style="text-align: center; font-size: 0.9rem; font-weight: bold; margin-top: 8px; padding: 8px; background: var(--bg-elevated); border-radius: 8px; color: var(--text-primary);">Select tenants to see total cost</div>
  </div>
`;

  Swal.fire({
    title: "📱 Send SMS to Tenants",
    html: html,
    showCancelButton: true,
    confirmButtonText: "Send",
    confirmButtonColor: "#10b981",
    cancelButtonColor: "#ef4444",
    background: "#1e293b",
    color: "#f1f5f9",
    width: "auto",
    customClass: { popup: "fullscreen-sms-modal" },
    didOpen: () => {
      const style = document.createElement("style");
      style.textContent = `
    /* ========== MOBILE (max 768px) – message top, table scrolls ========== */
    @media (max-width: 768px) {
      .fullscreen-sms-modal {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        max-width: 100vw !important;
        height: 100vh !important;
        max-height: 100vh !important;
        margin: 0 !important;
        padding: 0 !important;
        border-radius: 0 !important;
        background: var(--bg-secondary, #0f172a) !important;
        display: flex !important;
        flex-direction: column !important;
      }
      .fullscreen-sms-modal .swal2-html-container {
        flex: 1 !important;
        overflow-y: auto !important;
        padding: 8px 8px 16px 8px !important;
        margin: 0 !important;
      }
      /* Message textarea at the very top */
      textarea#sms-message {
        width: 100%;
        font-size: 16px !important;
        padding: 12px !important;
        margin-bottom: 16px;
        border-radius: 24px !important;
        background: var(--bg-tertiary, #0f172a);
        border: 1px solid var(--border, #334155);
        color: var(--text-primary, #f1f5f9);
      }
      /* Table – full width, no horizontal scroll */
      .fullscreen-sms-modal table {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        font-size: 14px;
        margin: 0;
      }
      .fullscreen-sms-modal th,
      .fullscreen-sms-modal td {
        padding: 10px 4px !important;
        text-align: center !important;
        vertical-align: middle !important;
        word-break: break-word;
      }
      .fullscreen-sms-modal th {
        font-size: 13px;
        background: var(--bg-elevated, #1e293b);
      }
      .fullscreen-sms-modal input[type="checkbox"] {
        width: 24px;
        height: 24px;
        transform: scale(1);
        cursor: pointer;
      }
      #sms-cost-estimate {
        margin: 12px 0 8px;
        padding: 10px;
        font-size: 14px;
      }
    }

    /* ========== DESKTOP (min 769px) – narrower modal, bigger table, no circular rings ========== */
    @media (min-width: 769px) {
      .fullscreen-sms-modal {
        width: 85% !important;          /* narrower than before */
        max-width: 1100px !important;   /* capped width */
        height: auto !important;
        max-height: 90vh !important;
        padding: 20px 24px !important;
        border-radius: 32px !important;
        background: var(--bg-secondary, #0f172a) !important;
      }
      .fullscreen-sms-modal .swal2-html-container {
        max-height: calc(90vh - 130px) !important;
        overflow-y: auto !important;
        padding: 8px 0 !important;
      }
      /* Bigger, premium table – no rounded corners on rows */
      .fullscreen-sms-modal table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        background: var(--bg-tertiary, #111827);
        border-radius: 20px;
        overflow: hidden;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      }
      .fullscreen-sms-modal th {
        background: linear-gradient(135deg, #1e293b, #0f172a);
        padding: 18px 12px;
        font-size: 0.95rem;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: #e2e8f0;
        font-weight: 700;
        border-bottom: 2px solid #38bdf8;
      }
      .fullscreen-sms-modal td {
        background: var(--bg-tertiary, #111827);
        padding: 16px 12px;
        border-bottom: 1px solid var(--border, #2d3a4e);
        font-size: 1rem;
        color: #f1f5f9;
        transition: background 0.2s;
      }
      .fullscreen-sms-modal tr:last-child td {
        border-bottom: none;
      }
      .fullscreen-sms-modal tr:hover td {
        background: #1e2a3a;
      }
      /* Remove any border-radius from cells (circular rings) */
      .fullscreen-sms-modal th,
      .fullscreen-sms-modal td {
        border-radius: 0 !important;
      }
      textarea#sms-message {
        font-size: 15px;
        padding: 14px 16px;
        border-radius: 28px;
        background: var(--bg-tertiary, #0f172a);
        border: 1px solid var(--border, #334155);
        color: var(--text-primary, #f1f5f9);
      }
      .fullscreen-sms-modal input[type="checkbox"] {
        width: 22px;
        height: 22px;
        transform: scale(1);
        cursor: pointer;
        accent-color: #10b981;
      }
      #sms-cost-estimate {
        font-size: 1rem;
        padding: 14px 20px;
        background: linear-gradient(135deg, #1e293b, #0f172a);
        border-radius: 60px;
        margin-top: 20px;
        font-weight: 600;
        text-align: center;
      }
    }

    /* ========== GLOBAL / COMMON ========== */
    textarea#sms-message {
      width: 100%;
      resize: vertical;
      font-family: inherit;
    }
    .fullscreen-sms-modal th, 
    .fullscreen-sms-modal td {
      text-align: center !important;
      vertical-align: middle !important;
    }
    #sms-cost-estimate {
      font-weight: 600;
    }
    /* Prevent overflow from container */
    .fullscreen-sms-modal .swal2-html-container > div > div {
      overflow-x: visible !important;
    }
  `;
      document.head.appendChild(style);

      // New: Select All button logic
      const selectAllBtn = document.getElementById("sms-select-all");
      if (selectAllBtn) {
        selectAllBtn.addEventListener("click", () => {
          const allCheckboxes = document.querySelectorAll(".sms-tenant-select");
          allCheckboxes.forEach((cb) => (cb.checked = true));
          // Trigger cost update
          const updateCostEvent = new Event("change");
          allCheckboxes.forEach((cb) => cb.dispatchEvent(updateCostEvent));
        });
      }

      // New: Select Late button logic (overdue > 0)
      const selectLateBtn = document.getElementById("sms-select-late");
      if (selectLateBtn) {
        selectLateBtn.addEventListener("click", () => {
          const allCheckboxes = document.querySelectorAll(".sms-tenant-select");
          allCheckboxes.forEach((cb) => {
            const overdue = parseFloat(cb.dataset.overdue) || 0;
            cb.checked = overdue > 0;
          });
          // Trigger cost update
          const updateCostEvent = new Event("change");
          allCheckboxes.forEach((cb) => cb.dispatchEvent(updateCostEvent));
        });
      }

      const textarea = document.getElementById("sms-message");
      const counter = document.getElementById("sms-char-counter");
      const updateCounter = () => {
        const len = textarea.value.length;
        counter.textContent = `${len} characters${
          len > 160 ? " (multiple messages)" : ""
        }`;
      };
      textarea.addEventListener("input", updateCounter);
      updateCounter();

      const templateSelect = document.getElementById("sms-template-bulk");
      const msgTextarea = document.getElementById("sms-message");
      if (templateSelect) {
        templateSelect.addEventListener("change", () => {
          const val = templateSelect.value;
          let newMsg = "";
          if (val === "payment") {
            newMsg =
              "Dear tenant, your rent payment is due. Please pay to avoid penalties. Thank you.";
          } else if (val === "water") {
            newMsg = `Kindly provide your water meter reading for ${getCurrentMonth()} to help us generate an accurate bill.`;
          } else if (val === "thanks") {
            newMsg = "Thank you for your payment. Have a great day!";
          } else if (val === "reminder") {
            newMsg = `Reminder: Rent is due on the scheduled date. Please pay on time to avoid penalties.`;
          } else if (val === "late") {
            newMsg = `URGENT: Your rent payment is past due. Please clear the outstanding amount immediately to avoid penalties.`;
          }
          if (newMsg) msgTextarea.value = newMsg;
          const event = new Event("input");
          msgTextarea.dispatchEvent(event);
        });
      }

      const updateCost = () => {
        const selected = document.querySelectorAll(
          ".sms-tenant-select:checked"
        ).length;
        const totalCost = selected * costPerMsg;
        const costDiv = document.getElementById("sms-cost-estimate");
        if (selected === 0) {
          costDiv.innerHTML = "📊 Select tenants to see total cost";
        } else {
          costDiv.innerHTML = `💰 <strong>Total cost: KES ${totalCost.toFixed(
            2
          )}</strong> (${selected} message${
            selected !== 1 ? "s" : ""
          } × KES ${costPerMsg})`;
        }
      };
      document
        .querySelectorAll(".sms-tenant-select")
        .forEach((cb) => cb.addEventListener("change", updateCost));
      updateCost();
    },
    preConfirm: async () => {
      const selected = Array.from(
        document.querySelectorAll(".sms-tenant-select:checked")
      ).map((cb) => cb.dataset.id);
      const message = document.getElementById("sms-message").value;
      if (selected.length === 0) {
        Swal.showValidationMessage("Select at least one tenant.");
        return false;
      }
      if (!message.trim()) {
        Swal.showValidationMessage("Message cannot be empty.");
        return false;
      }
      const totalCost = selected.length * costPerMsg;

      // Premium confirmation dialog
      const confirm = await Swal.fire({
        title: "📱 Confirm Bulk SMS",
        html: `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 16px; margin: 12px 0;">
        <div style="background: linear-gradient(135deg, #10b98120, #3b82f620); padding: 20px 24px; border-radius: 32px; width: 100%; text-align: center;">
          <div style="font-size: 2.2rem; font-weight: 800; color: #fbbf24;">KES ${totalCost.toFixed(
            2
          )}</div>
          <div style="font-size: 0.85rem; color: var(--text-secondary, #94a3b8); margin-top: 6px;">${
            selected.length
          } message${selected.length !== 1 ? "s" : ""} × KES 0.80</div>
        </div>
        <div style="background: var(--bg-elevated, #1e293b); padding: 14px 18px; border-radius: 24px; width: 100%;">
          <div style="font-weight: 600; margin-bottom: 6px; color: var(--accent-cyan, #38bdf8);">Message preview:</div>
          <div style="font-size: 0.9rem; color: var(--text-primary, #f1f5f9); word-break: break-word;">“${escapeHtml(
            message.substring(0, 100)
          )}${message.length > 100 ? "…" : ""}”</div>
        </div>
      </div>
    `,
        icon: "question",
        iconColor: "#fbbf24",
        showCancelButton: true,
        confirmButtonText: `Yes, send to ${selected.length} tenant${
          selected.length !== 1 ? "s" : ""
        }`,
        confirmButtonColor: "#10b981",
        cancelButtonText: "Cancel",
        cancelButtonColor: "#ef4444",
        background: "#1e293b",
        color: "#f1f5f9",
        backdrop: "rgba(0,0,0,0.7)",
        customClass: {
          popup: "premium-confirm-popup",
          confirmButton: "premium-confirm-btn",
          cancelButton: "premium-cancel-btn",
        },
        buttonsStyling: false, // We'll use our own CSS for buttons
      });

      if (!confirm.isConfirmed) {
        Swal.showValidationMessage("Cancelled");
        return false;
      }
      return { tenantIds: selected, message };
    },
  }).then(async (result) => {
    if (result.isConfirmed) {
      const { tenantIds, message } = result.value;
      setButtonLoading(btn, true);
      try {
        const response = await fetchWithTimeout(
          window.location.origin + "/tenants/send-sms",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({ tenantIds, message }),
          }
        );
        const data = await response.json();
        if (response.ok) {
          let summary = `Sent to ${
            (data.results || []).filter((r) => r.success).length
          } tenants.`;
          const failed = (data.results || []).filter((r) => !r.success);
          if (failed.length)
            summary += ` Failed for: ${failed
              .map((f) => f.tenant)
              .join(", ")}.`;
          Toast.fire({ icon: "success", title: summary });
        } else {
          Toast.fire({
            icon: "error",
            title: data.message || "Failed to send",
          });
        }
      } catch (err) {
        Toast.fire({ icon: "error", title: err.message });
      } finally {
        setButtonLoading(btn, false);
      }
    }
  });
});

document
  .getElementById("test-reminders-btn")
  .addEventListener("click", async () => {
    const btn = document.getElementById("test-reminders-btn");
    setButtonLoading(btn, true);
    try {
      // Build count URL with devDate (if any)
      let countUrl = window.location.origin + "/tenants/overdue-count";
      if (currentDevDate) countUrl += `?devDate=${currentDevDate}`;
      const countResponse = await fetchWithTimeout(countUrl, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const countData = await countResponse.json();
      const overdueCount = countData.count || 0;

      if (overdueCount === 0) {
        Toast.fire({
          icon: "info",
          title: "No overdue tenants at the moment.",
        });
        return;
      }

      const totalCost = overdueCount * 0.8;
      const confirm = await Swal.fire({
        title: "📨 Send Overdue Reminders",
        html: `
        <div style="text-align: center;">
          <div style="font-size: 1.2rem; margin-bottom: 16px;">You are about to send reminders to <strong>${overdueCount}</strong> tenant(s).</div>
          <div style="background: linear-gradient(135deg, #10b98120, #3b82f620); padding: 16px; border-radius: 16px; margin: 16px 0;">
            <div style="font-size: 2rem; font-weight: 700; color: #fbbf24;">KES ${totalCost.toFixed(
              2
            )}</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">Total cost (${overdueCount} message(s) × KES 0.80)</div>
          </div>
          <div style="font-size: 0.85rem; color: var(--text-muted);">A reminder will be sent to each overdue tenant.</div>
        </div>
      `,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: `Yes, send to ${overdueCount} tenant(s)`,
        confirmButtonColor: "#10b981",
        cancelButtonText: "Cancel",
        cancelButtonColor: "#ef4444",
        background: "#1e293b",
        color: "#f1f5f9",
      });

      if (!confirm.isConfirmed) {
        setButtonLoading(btn, false);
        return;
      }

      // Build trigger URL with devDate and force=true (to bypass reminderSentMonths)
      let triggerUrl =
        window.location.origin + "/tenants/trigger-reminders?force=true";
      if (currentDevDate) triggerUrl += `&devDate=${currentDevDate}`;
      const triggerResponse = await fetchWithTimeout(triggerUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const triggerData = await triggerResponse.json();
      if (triggerResponse.ok) {
        const successCount = (triggerData.results || []).filter(
          (r) => r.success
        ).length;
        Toast.fire({
          icon: "success",
          title: `Sent to ${successCount} tenant(s).`,
        });
      } else {
        Toast.fire({
          icon: "error",
          title: triggerData.message || "Failed to send reminders",
        });
      }
    } catch (err) {
      Toast.fire({ icon: "error", title: err.message });
    } finally {
      setButtonLoading(btn, false);
    }
  });

// ----- SMS LOGS BUTTON (Perfect layout) -----
const smsLogsBtn = document.getElementById("sms-logs-btn");
if (smsLogsBtn) {
  smsLogsBtn.addEventListener("click", async () => {
    try {
      const response = await fetchWithTimeout("/tenants/sms-logs", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!response.ok) throw new Error("Failed to fetch logs");
      const logs = await response.json();

      let tableRows = "";
      if (logs.length === 0) {
        tableRows = `<tr><td colspan="6" style="text-align:center; padding:40px;">📭 No SMS logs found</td></tr>`;
      } else {
        logs.forEach((log) => {
          const shortMsg =
            log.message.length > 50
              ? log.message.substring(0, 50) + "…"
              : log.message;
          tableRows += `
            <tr>
              <td>${escapeHtml(log.tenantName)}</td>
              <td>${escapeHtml(log.phoneNumber)}</td>
              <td class="msg-cell">${escapeHtml(shortMsg)}</td>
              <td><span class="status-badge ${log.status}">${
            log.status
          }</span></td>
              <td>${new Date(log.sentAt).toLocaleString()}</td>
             
            </tr>
          `;
        });
      }

      const html = `
        <div class="sms-logs-root">
          <div class="sms-logs-header">
            <h2>📜 SMS Delivery Logs</h2>
          </div>
          <div class="sms-logs-body">
            <table class="sms-logs-table">
              <thead>
                <tr><th>Tenant</th><th>Phone</th><th>Message</th><th>Status</th><th>Sent</th></tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </div>
      `;

      Swal.fire({
        html: html,
        showCloseButton: true,
        showConfirmButton: false,
        background: "transparent",
        width: "auto",
        customClass: {
          popup: "sms-logs-perfect",
          closeButton: "sms-logs-perfect-close",
        },
        didOpen: () => {
          const style = document.createElement("style");
          style.textContent = `
            /* Base modal */
            .sms-logs-perfect {
              padding: 0 !important;
              background: var(--bg-secondary, #0f172a) !important;
              overflow: hidden !important;
              display: flex !important;
              flex-direction: column !important;
            }
            .sms-logs-perfect .swal2-html-container {
              margin: 0 !important;
              padding: 0 !important;
              flex: 1 !important;
              display: flex !important;
              flex-direction: column !important;
            }
            /* Root container fills everything */
            .sms-logs-root {
              display: flex;
              flex-direction: column;
              height: 100%;
              width: 100%;
              background: var(--bg-secondary);
            }
            /* Header */
            .sms-logs-header {
              text-align: center;
              padding: 16px 20px;
              border-bottom: 1px solid var(--border, #334155);
              background: var(--bg-elevated, #1e293b);
              flex-shrink: 0;
            }
            .sms-logs-header h2 {
              margin: 0;
              font-size: 1.5rem;
              font-weight: 600;
              color: var(--text-primary, #f1f5f9);
            }
            /* Scrollable table body */
            .sms-logs-body {
              flex: 1;
              overflow-y: auto;
              padding: 0;
            }
            .sms-logs-table {
              width: 100%;
              border-collapse: collapse;
              text-align: center;
              font-size: 0.85rem;
            }
            .sms-logs-table th {
              background: var(--bg-elevated, #1e293b);
              padding: 14px 8px;
              font-size: 0.75rem;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: var(--text-secondary, #94a3b8);
              position: sticky;
              top: 0;
              border-bottom: 2px solid var(--border, #334155);
            }
            .sms-logs-table td {
              padding: 12px 8px;
              border-bottom: 1px solid var(--border-light, #2d3a4e);
              color: var(--text-primary, #f1f5f9);
            }
            .sms-logs-table td.msg-cell {
              max-width: 250px;
              word-break: break-word;
            }
            .status-badge {
              display: inline-block;
              padding: 4px 12px;
              border-radius: 40px;
              font-size: 0.7rem;
              font-weight: 600;
              text-transform: capitalize;
            }
            .status-badge.pending { background: #3b82f620; color: #3b82f6; }
            .status-badge.sent { background: #10b98120; color: #10b981; }
            .status-badge.delivered { background: #10b98120; color: #10b981; }
            .status-badge.failed { background: #ef444420; color: #ef4444; }

            /* Mobile: fullscreen, edges touch */
            @media (max-width: 768px) {
              .sms-logs-perfect {
                width: 100vw !important;
                max-width: 100vw !important;
                height: 100vh !important;
                max-height: 100vh !important;
                margin: 0 !important;
                border-radius: 0 !important;
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
              }
              .sms-logs-header {
                padding: 12px 12px;
              }
              .sms-logs-header h2 {
                font-size: 1.2rem;
              }
              .sms-logs-table th, .sms-logs-table td {
                font-size: 0.7rem;
                padding: 8px 4px;
              }
              .sms-logs-table td.msg-cell {
                max-width: 120px;
              }
              .sms-logs-perfect-close {
                right: 8px !important;
                top: 8px !important;
                font-size: 1.4rem !important;
                width: 32px !important;
                height: 32px !important;
                background: rgba(0,0,0,0.4) !important;
                border-radius: 50% !important;
              }
            }
            /* Desktop: nice margins, rounded, wider */
            @media (min-width: 769px) {
              .sms-logs-perfect {
                width: 95% !important;
                max-width: 1400px !important;
                height: auto !important;
                max-height: 90vh !important;
                border-radius: 32px !important;
                margin: 5vh auto !important;
                box-shadow: 0 20px 40px rgba(0,0,0,0.5) !important;
              }
              .sms-logs-header {
                padding: 20px 24px;
              }
              .sms-logs-header h2 {
                font-size: 1.8rem;
              }
              .sms-logs-body {
                max-height: calc(90vh - 85px);
              }
              .sms-logs-table th {
                padding: 18px 12px;
                font-size: 0.9rem;
              }
              .sms-logs-table td {
                padding: 16px 12px;
                font-size: 0.95rem;
              }
              .sms-logs-table td.msg-cell {
                max-width: 300px;
              }
              .sms-logs-perfect-close {
                right: 24px !important;
                top: 20px !important;
                font-size: 1.8rem !important;
                width: 40px !important;
                height: 40px !important;
                background: rgba(0,0,0,0.3) !important;
                border-radius: 50% !important;
                transition: 0.1s;
              }
              .sms-logs-perfect-close:hover {
                background: rgba(255,255,255,0.2) !important;
              }
            }
            /* Landscape on mobile: ensure full height */
            @media (orientation: landscape) and (max-width: 768px) {
              .sms-logs-perfect {
                height: 100vh !important;
              }
              .sms-logs-table td.msg-cell {
                max-width: 180px;
              }
            }
          `;
          document.head.appendChild(style);
        },
      });
    } catch (err) {
      Toast.fire({ icon: "error", title: "Failed to load SMS logs" });
    }
  });
}
