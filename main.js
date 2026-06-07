// ========================
//   main.js – STABLE VERSION (all features, no perf hacks)
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
let tenantEmailInput = document.querySelector(".tenant-email");
let userProfile = { name: "", email: "", phone: "", landlordName: "" };

function getAppToday() {
  let result;

  // 1) Prefer the dev date
  if (devModeActive && currentDevDate) {
    const [y, m, d] = currentDevDate.split("-").map(Number);
    result = new Date(Date.UTC(y, m - 1, d));
    return result;
  }

  // 2) Use server‑provided currentAppDate
  if (!currentAppDate) {
    const now = new Date();
    result = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    return result;
  }

  // 3) Fallback to server date
  const d = new Date(currentAppDate);
  result = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
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
      const balance = Number(data.balance);
      const costPerMsg = 0.8;
      const estimatedMessages = Math.floor(balance / costPerMsg);

      let badge = document.getElementById("sms-balance-badge");
      if (!badge) {
        badge = document.createElement("div");
        badge.id = "sms-balance-badge";
        badge.style.cssText = `
          padding: 8px 12px;
          margin-bottom: 8px;
          background: rgba(16, 185, 129, 0.15);
          border-left: 3px solid var(--success);
          border-radius: 0px;
          color: var(--success);
          font-weight: 600;
          font-size: 0.85rem;
          text-align: center;
          user-select: none;
        `;
        const dropdown = document.getElementById("topbar-menu-dropdown");
        if (dropdown) {
          dropdown.insertBefore(badge, dropdown.firstChild);
        }
      }
      badge.textContent = `💰 ${balance.toLocaleString()} KES credit (≈ ${estimatedMessages} messages)`;
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
  const d = new Date(currentAppDate);
  if (isNaN(d.getTime())) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(currentAppDate)) return currentAppDate;
    return new Date().toISOString().slice(0, 10);
  }
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
  const paramDate = urlParams.get("devDate");
  currentDevDate = paramDate || new Date().toISOString().split("T")[0];

  const originalFetchWithTimeout = fetchWithTimeout;
  fetchWithTimeout = async function (url, options = {}, timeout = 10000) {
    if (currentDevDate) {
      options.headers = options.headers || {};
      options.headers["X-Dev-Date"] = currentDevDate;
    }
    return originalFetchWithTimeout(url, options, timeout);
  };

  function updateDevUrl(newDate) {
    const newParams = new URLSearchParams(window.location.search);
    newParams.set("dev", "true");
    newParams.set("devDate", newDate);
    window.history.replaceState({}, "", `?${newParams.toString()}`);
  }

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
          await loadTenants();
          try {
            await fetchWithTimeout(window.location.origin + "/tenants/sync", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              },
            });
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
          const newParams = new URLSearchParams();
          newParams.set("dev", "true");
          window.history.replaceState({}, "", `?${newParams.toString()}`);
          await loadTenants();
          Toast.fire({ icon: "info", title: "Using real date" });
        });
      }
    }
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
  autoRemindersEnabled
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
  currentAppDate = data.currentDate;
}

let showArchived = false;

async function loadTenants() {
  try {
    const resp = await fetchWithTimeout(window.location.origin + "/tenants", {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (resp.ok) {
      const tenants = await resp.json();
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
    const [year, mon] = targetMonth.split("-").map(Number);
    const endOfMonth = new Date(year, mon, 0);
    endOfMonth.setHours(0, 0, 0, 0);

    let totalOverdue = 0;
    for (let tenant of tenantArray) {
      const overdue = getTenantPastDueAmount(tenant, endOfMonth);
      totalOverdue += overdue;
    }
    return totalOverdue;
  });
}
function updateCharts() {
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

  const months = getLast6Months();
  let expectedData = [];
  let collectedData = [];

  months.forEach((month) => {
    let expectedSum = 0;
    let collectedSum = 0;
    tenantArray.forEach((tenant) => {
      const chargeEntry = tenant.paymentHistory.find(
        (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
      );
      if (chargeEntry) {
        expectedSum += chargeEntry.totalDue || 0;
      } else {
        expectedSum += tenant.rent + (globalSettings.garbageFee || 0);
      }
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
  const todayStr = today.toISOString().slice(0, 10);

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
    const dueStr = dueDate.toISOString().slice(0, 10);
    if (dueStr >= todayStr) return dueStr;
  }

  const currentMonth = getCurrentMonth();
  return getDueDateForMonthLocal(tenant, currentMonth);
}

function isLate(dueDate, paid, tenant) {
  const today = getAppToday();
  const todayStr = today.toISOString().slice(0, 10);

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
      const dueDate = new Date(entry.dueDate);
      const dueStr = dueDate.toISOString().slice(0, 10);
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

function getTenantPastDueAmount(tenant, todayDate) {
  const today = new Date(todayDate);
  const todayUTC = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const todayStr = todayUTC.toISOString().slice(0, 10);

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
      continue;
    }

    // Check if this month has the special "new tenant" flag
    const chargeEntry = entries.find(
      (e) => (e.amountPaid || 0) === 0 && !e.datePaid
    );
    const isFirstMonthWithFlag =
      chargeEntry &&
      chargeEntry.initialPastDue &&
      chargeEntry.remainingBalance > 0;

    const due = new Date(latest.dueDate);
    const dueStr = due.toISOString().slice(0, 10);

    // If it's not the forced‑past‑due first month, stop at the current billing month
    if (!isFirstMonthWithFlag && dueStr >= todayStr) {
      break;
    }

    lastPastBalance = latest.remainingBalance;
    foundPast = true;
  }

  return foundPast ? Math.max(0, lastPastBalance) : 0;
}
window.getTenantPastDueAmount = getTenantPastDueAmount;

function getExpectedForMonth(tenant, monthStr, settings) {
  const chargeEntry = tenant.paymentHistory.find(
    (e) => e.month === monthStr && (e.amountPaid || 0) === 0 && !e.datePaid
  );
  if (chargeEntry) return chargeEntry.totalDue || 0;
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

// ─────────────────────────────────────────────────────
//   FULL PAYMENT MODAL (compact table with credit tags)
// ─────────────────────────────────────────────────────
function renderPaymentModal(tenantId) {
  let tenant = tenantArray.find((t) => t._id === tenantId);
  if (!tenant) return;

  // Safety guard
  if (!tenant.paymentHistory || !Array.isArray(tenant.paymentHistory)) {
    tenant.paymentHistory = [];
  }

  let currentMonth = getCurrentMonth();
  if (!tenant.paymentHistory.some((e) => e.month === currentMonth)) {
    if (tenant.paymentHistory.length > 0) {
      currentMonth = tenant.paymentHistory[0].month;
    }
  }

  const hasWaterReading = (tenant.waterMeterReadings || []).some(
    (r) => r.month === currentMonth
  );

  const warningBanner = !hasWaterReading
    ? `
    <div id="water-reading-warning" style="
      background: #fbbf2420;
      border-left: 5px solid #fbbf24;
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 500;
      color: #fbbf24;
    ">
      <span>⚠️ No water reading for ${currentMonth}. Water charges = 0.</span>
      <button id="dismiss-water-warning" style="
        background: transparent;
        border: none;
        color: #fbbf24;
        font-size: 1.4rem;
        cursor: pointer;
        padding: 0 8px;
        line-height: 1;
      ">✕</button>
    </div>
  `
    : "";

  const html = `
    <style>
      .payment-compact-table {
        width: 100%;
        table-layout: fixed;
        border-collapse: separate;
        border-spacing: 0 6px;
        background: transparent;
        word-break: break-word;
      }
      .payment-compact-table thead th {
        text-align: center;
        padding: 12px 8px;
        font-size: 0.85rem;
        font-weight: 700;
        letter-spacing: 0.4px;
        color: #94a3b8;
        border-bottom: 2px solid #334155;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .payment-row-main {
        cursor: pointer;
        transition: background 0.15s;
        background: #1e293b;
        border-radius: 12px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.25);
      }
      .payment-row-main:hover {
        background: #273548;
      }
      .payment-row-main td {
        padding: 14px 8px;
        text-align: center;
        font-size: 1rem;
        font-weight: 500;
        vertical-align: middle;
        border: none;
        overflow-wrap: break-word;
      }
      .payment-row-main td:first-child {
        border-radius: 12px 0 0 12px;
        font-weight: 700;
      }
      .payment-row-main td:last-child {
        border-radius: 0 12px 12px 0;
      }
      .amount-paid { color: #4ade80; font-weight: 700; }
      .amount-zero { color: #64748b; }
      .status-fully-paid { color: #4ade80; font-weight: 700; }
      .status-unpaid { color: #f87171; font-weight: 700; }
      .status-overpaid { color: #60a5fa; font-weight: 700; }
      .balance-positive { color: #f87171; font-weight: 700; }
      .balance-zero { color: #4ade80; font-weight: 700; }
      .balance-negative { color: #c084fc; font-weight: 700; }
      .left-net {
        font-weight: 700;
        display: block;
      }
      .left-credit-tag {
        font-size: 0.7rem;
        color: #38bdf8;
        margin-top: 2px;
        display: block;
      }
      .expand-arrow {
        display: inline-block;
        transition: transform 0.2s;
        font-size: 1.3rem;
        color: #94a3b8;
      }
      .credit-transfer-row td {
        padding: 4px 0;
        text-align: center;
        font-size: 0.75rem;
        color: #38bdf8;
        background: transparent;
        font-weight: 500;
        border: none;
        opacity: 0.85;
      }
      .payment-row-detail td {
        padding: 0;
        background: #0f172a;
        border-radius: 0 0 12px 12px;
        border-bottom: 2px solid #334155;
        word-break: break-word;
        overflow-x: hidden;
      }
      .detail-content {
        padding: 16px 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        color: #cbd5e1;
        font-size: 0.9rem;
      }
      .charge-line {
        color: #f1f5f9;
        font-weight: 600;
        font-size: 0.95rem;
        background: #1e293b;
        padding: 8px 12px;
        border-radius: 8px;
      }
      .credit-note {
        color: #38bdf8;
        font-weight: 500;
        font-size: 0.85rem;
        background: #38bdf815;
        padding: 4px 10px;
        border-radius: 20px;
        display: inline-block;
      }
      .payment-detail-line {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        padding: 8px 12px;
        background: #1e293b;
        border-radius: 8px;
        font-size: 0.85rem;
      }
      .payment-detail-line span:first-child {
        font-weight: 600;
        color: #f1f5f9;
      }
      .payment-detail-line span.mp {
        color: #38bdf8;
        font-weight: 500;
      }
      .payment-detail-line span.balance {
        font-weight: 600;
      }

      /* prevent inner scroll */
      .payment-history-wrapper,
      .payment-history-scroll,
      #payment-history-list {
        max-height: none !important;
        overflow-y: visible !important;
      }

      @media (max-width: 500px) {
        .payment-row-main td {
          font-size: 0.85rem;
          padding: 12px 4px;
        }
        .detail-content {
          padding: 12px 10px;
        }
      }
    </style>

    ${warningBanner}
    <div style="
      background: rgba(59,130,246,0.12);
      border-left: 5px solid #3b82f6;
      border-radius: 12px;
      padding: 10px 16px;
      margin-bottom: 16px;
      font-size: 0.85rem;
      color: #93c5fd;
    ">
      ℹ️ Tap a month row to see the breakdown.
    </div>

    <div class="payment-add-section">
      <h4 style="color:#f1f5f9; margin-bottom:12px;">Add Payment</h4>
      <div class="payment-add-row">
        <label style="color:#cbd5e1;">Amount(KSH):</label>
        <input type="number" id="pay-amount" step="any" placeholder="0.00"
          style="padding:10px; border-radius:8px; border:1px solid #334155; background:#1e293b; color:#f1f5f9; width:100%;">
      </div>
      <div class="payment-add-row" style="margin-top:10px;">
        <label style="color:#cbd5e1;">Date Paid:</label>
        <input type="date" id="pay-date" value="${new Date()
          .toISOString()
          .slice(0, 10)}"
          style="padding:10px; border-radius:8px; border:1px solid #334155; background:#1e293b; color:#f1f5f9; width:100%;">
      </div>
      <div class="payment-add-row" style="margin-top:10px;">
        <label style="color:#cbd5e1;">M‑Pesa Ref:</label>
        <input type="text" id="pay-mpesa" placeholder="Optional"
          style="padding:10px; border-radius:8px; border:1px solid #334155; background:#1e293b; color:#f1f5f9; width:100%;">
      </div>
      <button id="add-payment-btn" class="modal-action-btn"
        style="margin-top:16px; width:100%; background:#3b82f6; color:white; font-weight:bold; padding:12px; border-radius:12px;">
        ➕ Add Payment
      </button>
    </div>

    <hr style="border-color:#334155; margin:20px 0;">

    <!-- Legend -->
    <div style="
      background: rgba(255,255,255,0.03);
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 10px 14px;
      margin-bottom: 12px;
      font-size: 0.75rem;
      color: #94a3b8;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    ">
      <span><strong style="color:#f1f5f9;">Left</strong> = amount owed for this month (credit already applied).</span>
      <span><strong style="color:#f1f5f9;">Balance</strong> = total owed across all months (negative = credit).</span>
    </div>

    <div id="payment-history-list" class="payment-history-list"></div>
  `;

  document.getElementById("payment-content").innerHTML = html;

  // Dismiss warning
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

  let firstMonth = null;
  if (sortedHistory.length > 0) {
    const byMonth = [...sortedHistory].sort((a, b) =>
      a.month.localeCompare(b.month)
    );
    firstMonth = byMonth[0].month;
  }

  const today = getAppToday();
  const todayStr = today.toISOString().slice(0, 10);

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
    activeMonth = getCurrentMonth();
  }

  sortedHistory = sortedHistory.filter((entry) => {
    if (entry.month === firstMonth) return true;
    return entry.month <= activeMonth;
  });

  // Group entries by month
  const uniqueMonths = [...new Set(sortedHistory.map((e) => e.month))]
    .sort()
    .reverse();

  // monthsOrder must be oldest-first (chronological) so that
  // the credit transfer row correctly identifies the older month
  const monthsOrder = [...uniqueMonths].reverse();

  const leftByMonth = new Map();
  let previousCumulative = 0;
  for (const month of monthsOrder) {
    const chargeEntry = sortedHistory.find(
      (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
    );
    if (!chargeEntry) continue;
    const cumulative = chargeEntry.remainingBalance;
    const monthLeft = Math.max(0, cumulative) - Math.max(0, previousCumulative);
    leftByMonth.set(month, monthLeft);
    previousCumulative = cumulative;
  }

  // Helper: charge breakdown
  function getChargeBreakdown(month) {
    const chargeEntry = sortedHistory.find(
      (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
    );
    if (!chargeEntry) return "";
    let deposit = 0;
    if (tenant.deposit && tenant.depositPeriod) {
      const first = getTenantFirstMonth(tenant);
      if (first) {
        const [fy, fm] = first.split("-").map(Number);
        const firstDate = new Date(Date.UTC(fy, fm - 1, 1));
        const lastDepDate = new Date(
          Date.UTC(fy, fm - 1 + tenant.depositPeriod, 0)
        );
        const [cy, cm] = month.split("-").map(Number);
        const checkDate = new Date(Date.UTC(cy, cm - 1, 1));
        if (checkDate >= firstDate && checkDate <= lastDepDate) {
          deposit = Math.round(tenant.rent / tenant.depositPeriod);
        }
      }
    }
    const trueRent = (chargeEntry.baseRent || tenant.rent) - deposit;
    const water = chargeEntry.waterCharge || 0;
    const garbage = chargeEntry.garbageCharge || 0;
    const parts = [];
    if (trueRent > 0) parts.push(`Rent ${trueRent.toLocaleString()}`);
    if (deposit > 0) parts.push(`Deposit ${deposit.toLocaleString()}`);
    if (garbage > 0) parts.push(`Garbage ${garbage.toLocaleString()}`);
    if (water > 0) parts.push(`Water ${water.toLocaleString()}`);
    return parts.join(" · ");
  }

  // ---- Build the table ----
  let container = document.getElementById("payment-history-list");
  let tableHtml = `
    <table class="payment-compact-table">
      <thead>
        <tr><th>Month</th><th>Total</th><th>Paid</th><th>Left</th><th>Balance</th><th></th></tr>
      </thead>
      <tbody>
  `;

  for (const month of uniqueMonths) {
    const chargeEntry = sortedHistory.find(
      (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
    );
    if (!chargeEntry) continue;

    const totalDue =
      chargeEntry.totalDue ||
      (chargeEntry.baseRent || 0) +
        (chargeEntry.waterCharge || 0) +
        (chargeEntry.garbageCharge || 0) ||
      0;

    const paymentsThisMonth = sortedHistory.filter(
      (e) => e.month === month && e.amountPaid > 0
    );
    const paid = paymentsThisMonth.reduce((sum, e) => sum + e.amountPaid, 0);

    const cumulative = chargeEntry.remainingBalance;
    const monthLeft = leftByMonth.get(month) || 0;
    const expectedLeft = totalDue - paid;

    const creditUsedAmount =
      paid < totalDue ? Math.max(0, expectedLeft - Math.max(0, monthLeft)) : 0;

    // ---- Left cell ----
    let leftDisplay = "";
    let leftClass = "";
    if (paid >= totalDue) {
      if (cumulative < 0) {
        leftDisplay = `Over +${Math.abs(cumulative).toLocaleString()}`;
        leftClass = "status-overpaid";
      } else {
        leftDisplay = "Fully paid";
        leftClass = "status-fully-paid";
      }
    } else {
      if (monthLeft === 0 && expectedLeft > 0) {
        leftDisplay = `<span class="left-net" style="color:#4ade80;">0</span><span class="left-credit-tag">${creditUsedAmount.toLocaleString()} credit</span>`;
        leftClass = "status-fully-paid";
      } else if (monthLeft > 0) {
        leftDisplay = `<span class="left-net" style="color:#f87171;">${monthLeft.toLocaleString()}</span>`;
        if (creditUsedAmount > 0) {
          leftDisplay += `<span class="left-credit-tag">${creditUsedAmount.toLocaleString()} credit</span>`;
        }
        leftClass = "status-unpaid";
      }
    }

    // ---- Balance column ----
    let balanceClass = "";
    let balanceText = "";
    if (cumulative > 0) {
      balanceText = cumulative.toLocaleString();
      balanceClass = "balance-positive";
    } else if (cumulative < 0) {
      balanceText = `+${Math.abs(cumulative).toLocaleString()}`;
      balanceClass = "balance-negative";
    } else {
      balanceText = "0";
      balanceClass = "balance-zero";
    }

    const paidDisplay = paid > 0 ? paid.toLocaleString() : "—";

    const rowId = `row-${month.replace(/[^a-zA-Z0-9]/g, "")}`;
    const detailId = `detail-${month.replace(/[^a-zA-Z0-9]/g, "")}`;

    // Main row
    tableHtml += `
      <tr class="payment-row-main" data-month="${month}" id="${rowId}">
        <td>${month}</td>
        <td>${totalDue.toLocaleString()}</td>
        <td class="${
          paid > 0 ? "amount-paid" : "amount-zero"
        }">${paidDisplay}</td>
        <td class="${leftClass}">${leftDisplay}</td>
        <td class="${balanceClass}">${balanceText}</td>
        <td><span class="expand-arrow">▸</span></td>
      </tr>`;

    // Detail row
    tableHtml += `
      <tr class="payment-row-detail" id="${detailId}" style="display:none;">
        <td colspan="6">
          <div class="detail-content">
            <div class="charge-line"><strong>Charges:</strong> ${getChargeBreakdown(
              month
            )}</div>
            ${paymentsThisMonth
              .map((p) => {
                const pBalance = p.remainingBalance;
                const balClass =
                  pBalance > 0
                    ? "balance-positive"
                    : pBalance < 0
                    ? "balance-negative"
                    : "balance-zero";
                const balText =
                  pBalance < 0
                    ? `+${Math.abs(pBalance).toLocaleString()}`
                    : pBalance.toLocaleString();
                return `<div class="payment-detail-line">
                <span>↳ ${p.amountPaid.toLocaleString()} on ${
                  p.datePaid ? formatDate(p.datePaid) : "—"
                }</span>
                ${
                  p.mpesaRef
                    ? `<span class="mp">M-Pesa: ${p.mpesaRef}</span>`
                    : ""
                }
                <span class="balance ${balClass}">bal: ${balText}</span>
                <button class="actions-btn" data-id="${p._id}" data-month="${
                  p.month
                }" data-amount="${p.amountPaid}" data-date="${
                  p.datePaid || ""
                }" data-mpesa="${
                  p.mpesaRef || ""
                }" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#94a3b8;padding:4px 6px;min-width:30px;">⚙️</button>
              </div>`;
              })
              .join("")}
            ${
              creditUsedAmount > 0
                ? `<div class="credit-note">${creditUsedAmount.toLocaleString()} credit from previous month</div>`
                : ""
            }
          </div>
        </td>
      </tr>`;

    // Credit transfer row
    if (creditUsedAmount > 0) {
      const idx = monthsOrder.indexOf(month);
      const olderMonth = idx > 0 ? monthsOrder[idx - 1] : null;
      if (olderMonth) {
        tableHtml += `
          <tr class="credit-transfer-row">
            <td colspan="6">
              ← KES ${creditUsedAmount.toLocaleString()} credit from ${olderMonth}
            </td>
          </tr>
        `;
      }
    }
  }

  tableHtml += `</tbody></table>`;
  container.innerHTML = tableHtml;

  // Expand/collapse logic
  const mainRows = container.querySelectorAll(".payment-row-main");
  mainRows.forEach((row) => {
    row.addEventListener("click", function () {
      const month = this.dataset.month;
      const detailRow = document.getElementById(
        `detail-${month.replace(/[^a-zA-Z0-9]/g, "")}`
      );
      const arrow = this.querySelector(".expand-arrow");
      if (!detailRow) return;
      if (
        detailRow.style.display === "none" ||
        detailRow.style.display === ""
      ) {
        container
          .querySelectorAll(".payment-row-detail")
          .forEach((r) => (r.style.display = "none"));
        container
          .querySelectorAll(".expand-arrow")
          .forEach((a) => (a.style.transform = "rotate(0deg)"));
        detailRow.style.display = "table-row";
        arrow.style.transform = "rotate(90deg)";
      } else {
        detailRow.style.display = "none";
        arrow.style.transform = "rotate(0deg)";
      }
    });
  });
}
// ─────────────────────────────────────────────────────

// ----- UTILITIES MODAL (Meter Reading) -----
async function showUtilitiesModal(tenantId) {
  const tenant = tenantArray.find((t) => t._id === tenantId);
  if (!tenant) return;
  const currentMonth = getCurrentMonth();
  const waterRate = globalSettings.waterRatePerUnit || 0;

  const readings = [...(tenant.waterMeterReadings || [])].sort((a, b) =>
    a.month.localeCompare(b.month)
  );

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
      <div class="utility-row"><label>Previous Reading:</label><span id="prev-reading-display">${prevReading}</span> <a href="#" id="override-previous-link" style="font-size:0.8rem; color:var(--accent-cyan); margin-left:10px;">Override</a></div>
<div class="utility-row" id="override-previous-row" style="display:none;">
  <label>Override Previous:</label><input type="number" id="override-previous-input" step="0.1" placeholder="Enter manual previous">
</div>
<div class="utility-row"><label>Current Reading:</label><input type="number" id="meter-reading" step="0.1" placeholder="Enter current reading"></div>
<div class="utility-row"><label>Exempt Units:</label><input type="number" id="exempt-units" step="0.1" placeholder="Optional, e.g., 1.2"></div>
        <div class="utility-row"><label>Units Used:</label><span id="units-used">0</span></div>
        <div class="utility-row"><label>Water Cost (KSH):</label><span id="water-cost">0</span></div>
        <div class="utility-actions">
          <button id="save-utilities-btn" class="modal-action-btn">Save Reading</button>
          <button id="cancel-utilities-btn" class="modal-action-btn danger">Close</button>
        </div>
      </div>
  `;

  if (readings.length > 0) {
    html += `<h4>📜 Reading History</h4>
      <div style="overflow-x: auto;">
        <table style="width:100%; border-collapse: collapse;">
          <thead>
            <tr><th>Month</th><th>Reading</th><th>Units</th><th>Cost</th><th></th></tr>
          </thead>
          <tbody>`;
    readings.forEach((reading, index) => {
      // Use the stored units and cost – they already include the effect of override & exempt
      const storedUnits = reading.unitsUsed;
      const storedCost = reading.cost;

      // Fallback only if stored values are missing (shouldn't happen after recalc)
      let units, cost;
      if (storedUnits != null && storedCost != null) {
        units = storedUnits;
        cost = storedCost;
      } else {
        const prev = index > 0 ? readings[index - 1].reading : 0;
        units = reading.reading - prev;
        cost = units * (reading.rate || waterRate);
      }

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
    let prevRead = getPreviousReadingForMonth(selectedMonth);

    // Check for manual override
    const overrideInput = document.getElementById("override-previous-input");
    if (overrideInput && overrideInput.value) {
      prevRead = parseFloat(overrideInput.value) || 0;
    }

    const current = parseFloat(readingInput.value) || 0;
    let units = current - prevRead;

    // Subtract exempt units
    const exemptInput = document.getElementById("exempt-units");
    if (exemptInput && exemptInput.value) {
      units = Math.max(0, units - (parseFloat(exemptInput.value) || 0));
    }

    unitsSpan.textContent = units > 0 ? units : 0;
    costSpan.textContent = (units > 0 ? units * waterRate : 0).toFixed(2);
    prevDisplay.textContent = prevRead;
  }

  // Override toggle
  const overrideLink = document.getElementById("override-previous-link");
  const overrideRow = document.getElementById("override-previous-row");
  if (overrideLink && overrideRow) {
    overrideLink.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (overrideRow.style.display === "none") {
        overrideRow.style.display = "flex";
        overrideLink.textContent = "Use auto";
      } else {
        overrideRow.style.display = "none";
        overrideLink.textContent = "Override";
        document.getElementById("override-previous-input").value = "";
      }
    });
  }

  const overrideInput = document.getElementById("override-previous-input");
  if (overrideInput) {
    overrideInput.addEventListener("input", updateCalc);
  }
  const exemptInput = document.getElementById("exempt-units");
  if (exemptInput) {
    exemptInput.addEventListener("input", updateCalc);
  }

  if (readingInput) readingInput.addEventListener("input", updateCalc);
  if (readingMonthInput)
    readingMonthInput.addEventListener("change", updateCalc);
  if (prevDisplay) prevDisplay.textContent = prevReading;

  const handleReadingActions = async (e) => {
    const btn = e.target.closest(".reading-actions-btn");
    if (!btn) return;

    const id = btn.dataset.id;
    const month = btn.dataset.month;
    const currentReading = parseFloat(btn.dataset.reading);
    const tid = tenant._id;

    // Get the full reading object so we can pre‑fill override/exempt
    const readingObj = (tenant.waterMeterReadings || []).find(
      (r) => r._id.toString() === id
    );
    const currentOverride = readingObj?.previousOverride ?? "";
    const currentExempt = readingObj?.exemptUnits ?? 0;

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
      // ---- Edit with all fields ----
      const { value: formValues } = await Swal.fire({
        title: `Edit Reading for ${month}`,
        html: `
        <div style="display:flex;flex-direction:column;gap:12px;text-align:left;">
          <div>
            <label style="display:block;margin-bottom:4px;color:#cbd5e1;">Current Reading</label>
            <input id="swal-reading" class="swal2-input" type="number" value="${currentReading}" step="0.1">
          </div>
          <div>
            <label style="display:block;margin-bottom:4px;color:#cbd5e1;">Override Previous (optional)</label>
            <input id="swal-override" class="swal2-input" type="number" value="${currentOverride}" step="0.1" placeholder="Leave empty for auto">
          </div>
          <div>
            <label style="display:block;margin-bottom:4px;color:#cbd5e1;">Exempt Units (optional)</label>
            <input id="swal-exempt" class="swal2-input" type="number" value="${currentExempt}" step="0.1" placeholder="0">
          </div>
        </div>
      `,
        showCancelButton: true,
        confirmButtonText: "Update",
        confirmButtonColor: "#3b82f6",
        cancelButtonColor: "#475569",
        background: "#1e293b",
        color: "#f1f5f9",
        preConfirm: () => {
          const read = document.getElementById("swal-reading").value;
          const ovr = document.getElementById("swal-override").value;
          const exm = document.getElementById("swal-exempt").value;
          if (!read || isNaN(Number(read)) || Number(read) < 0) {
            Swal.showValidationMessage("Enter a valid reading");
            return false;
          }
          if (ovr && Number(read) < Number(ovr)) {
            Swal.showValidationMessage(
              "Reading cannot be less than the override value"
            );
            return false;
          }
          return {
            reading: Number(read),
            previousOverride: ovr ? Number(ovr) : null,
            exemptUnits: exm ? Number(exm) : 0,
          };
        },
      });

      if (formValues) {
        setButtonLoading(btn, true);
        try {
          const response = await fetchWithTimeout(
            window.location.origin + `/tenants/${tid}/meter-reading/${id}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              },
              body: JSON.stringify(formValues),
            }
          );
          if (response.ok) {
            const resp = await fetchWithTimeout(
              window.location.origin + "/tenants",
              {
                headers: {
                  Authorization: `Bearer ${localStorage.getItem("token")}`,
                },
              }
            );
            if (resp.ok) {
              tenantArray = await resp.json();
              updateTenantList(tenantArray);
              updateStats(tenantArray);
              const paymentModal = document.getElementById("payment-modal");
              if (paymentModal && paymentModal.style.display === "block") {
                renderPaymentModal(window.currentActionsTenantId);
              }
              showUtilitiesModal(tid);
            }
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
      // Delete – unchanged
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
            window.location.origin + `/tenants/${tid}/meter-reading/${id}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              },
            }
          );
          if (response.ok) {
            await loadTenants();
            const paymentModal = document.getElementById("payment-modal");
            if (paymentModal && paymentModal.style.display === "block") {
              renderPaymentModal(window.currentActionsTenantId);
            }
            showUtilitiesModal(tid);
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
  };

  const utilitiesContent = document.getElementById("utilities-content");
  utilitiesContent.removeEventListener("click", handleReadingActions);
  utilitiesContent.addEventListener("click", handleReadingActions);
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
  <button id="resend-overdue-reminders-btn" class="modal-action-btn" style="background: #f59e0b;">📢 Resend Overdue Reminders Now</button>
</div>

<div style="display: flex; flex-direction: column; gap: 6px;">
  <button id="resend-email-reminders-btn" class="modal-action-btn" style="background: #f59e0b;">📧 Resend Overdue Emails Now</button>
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

  const autoRemindersCheckbox = document.getElementById(
    "global-auto-reminders"
  );
  if (autoRemindersCheckbox) {
    const oldListener = autoRemindersCheckbox._listener;
    if (oldListener)
      autoRemindersCheckbox.removeEventListener("change", oldListener);

    const handleAutoReminderChange = async (e) => {
      const isChecked = e.target.checked;

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

        const ok = await updateGlobalSettingsOnServer(
          garbageFee,
          waterRatePerUnit,
          defaultDueDay,
          totalHouses,
          isChecked
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
            await fetchGlobalSettings();
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

    if (e.target.id === "change-rent-btn") {
      const { value: newRent } = await Swal.fire({
        title: "Change Rent for All Tenants",
        input: "number",
        inputLabel: "New Rent Amount (KSH)",
        inputAttributes: { min: "1", step: "any" },
        inputValue: globalSettings.defaultDueDay || 1,
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

    if (e.target.id === "resend-email-reminders-btn") {
      const btn = e.target;
      setButtonLoading(btn, true);
      try {
        const response = await fetchWithTimeout(
          window.location.origin +
            "/tenants/trigger-email-reminders?force=true",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }
        );
        const data = await response.json();
        if (response.ok) {
          const sent = (data.results || []).filter((r) => r.success).length;
          Toast.fire({
            icon: "success",
            title: `Email reminders sent to ${sent} tenant(s).`,
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

      const autoRemindersEnabled = document.getElementById(
        "global-auto-reminders"
      ).checked;

      try {
        const ok = await updateGlobalSettingsOnServer(
          garbageFee,
          waterRatePerUnit,
          defaultDueDay,
          totalHouses,
          autoRemindersEnabled
        );
        if (ok) {
          await fetchGlobalSettings();
          await loadTenants();
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
    document.getElementById("tenant-actions-modal").style.display = "none";
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

    if (
      !globalSettings.waterRatePerUnit ||
      globalSettings.waterRatePerUnit <= 0
    ) {
      Toast.fire({
        icon: "warning",
        title: "Water rate not set",
        text: "Please configure the water rate in Global Settings first.",
      });
      return;
    }

    const tenant = tenantArray.find((t) => t._id === tenantId);
    const allReadings = (tenant?.waterMeterReadings || []).sort((a, b) =>
      a.month.localeCompare(b.month)
    );
    let prevReading = 0;
    for (const r of allReadings) {
      if (r.month < selectedMonth) prevReading = r.reading;
      else break;
    }

    // Use the override value if provided, otherwise fall back to the auto‑calculated previous
    const overrideInput = document.getElementById("override-previous-input");
    const overrideVal = overrideInput?.value;
    const effectivePrevious = overrideVal ? Number(overrideVal) : prevReading;

    if (reading < effectivePrevious) {
      Toast.fire({
        icon: "error",
        title: `Reading cannot be less than previous reading (${effectivePrevious})`,
      });
      setButtonLoading(e.target, false);
      return;
    }

    const exemptVal = document.getElementById("exempt-units")?.value;

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
          body: JSON.stringify({
            month: selectedMonth,
            reading,
            previousOverride: overrideVal ? Number(overrideVal) : null,
            exemptUnits: exemptVal ? Number(exemptVal) : 0,
          }),
        }
      );
      const resp = await fetchWithTimeout(window.location.origin + "/tenants", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (resp.ok) {
        tenantArray = await resp.json();
        updateTenantList(tenantArray);
        updateStats(tenantArray);

        const paymentModal = document.getElementById("payment-modal");
        if (paymentModal && paymentModal.style.display === "block") {
          renderPaymentModal(window.currentActionsTenantId);
        }

        showUtilitiesModal(window.currentActionsTenantId);
      }
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

  if (e.target.closest("#modal-send-sms")) {
    showIndividualSmsModal(window.currentActionsTenantId);
  }

  if (e.target.closest("#modal-send-email")) {
    showEmailModal(window.currentActionsTenantId);
  }

  if (e.target.id === "add-payment-btn") {
    const btn = e.target;
    const tenantId = window.currentActionsTenantId;
    const amount = parseFloat(document.getElementById("pay-amount").value);
    const date = document.getElementById("pay-date").value;
    const mpesaRef = document.getElementById("pay-mpesa").value;

    if (isNaN(amount) || amount < 0) {
      Toast.fire({ icon: "warning", title: "Invalid Amount" });
      return;
    }

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

function generateBalanceMessage(tenant) {
  const today = getAppToday();
  const totalOutstanding = getTenantTotalOutstanding(tenant);
  const currentMonth = getCurrentBillingMonthForTenant(tenant);
  const expected = getExpectedForMonth(tenant, currentMonth, globalSettings);
  const dueDate = getTenantNextDueDate(tenant);
  const credit = totalOutstanding < 0 ? Math.abs(totalOutstanding) : 0;

  function formatMonth(ym) {
    const [y, m] = ym.split("-");
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return months[parseInt(m) - 1] + " " + y;
  }

  function formatDueDate(dateVal) {
    if (!dateVal) return "";
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return "";
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return d.getUTCDate() + " " + months[d.getUTCMonth()];
  }

  const dueStr = formatDueDate(dueDate);

  const getMonthCharges = (month) => {
    const chargeEntry = tenant.paymentHistory.find(
      (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
    );
    if (chargeEntry) {
      const firstMonth = getTenantFirstMonth(tenant);
      let depositAmount = 0;
      if (tenant.deposit && tenant.depositPeriod && firstMonth) {
        const [fy, fm] = firstMonth.split("-").map(Number);
        const firstDate = new Date(Date.UTC(fy, fm - 1, 1));
        const lastDepDate = new Date(
          Date.UTC(fy, fm - 1 + tenant.depositPeriod, 0)
        );
        const [cy, cm] = month.split("-").map(Number);
        const checkDate = new Date(Date.UTC(cy, cm - 1, 1));
        if (checkDate >= firstDate && checkDate <= lastDepDate) {
          depositAmount = Math.round(tenant.rent / tenant.depositPeriod);
        }
      }
      const pureRent = (chargeEntry.baseRent || tenant.rent) - depositAmount;
      return {
        rent: pureRent,
        water: chargeEntry.waterCharge || 0,
        garbage: chargeEntry.garbageCharge || 0,
        deposit: depositAmount,
        total: chargeEntry.totalDue || expected,
        remaining: chargeEntry.remainingBalance,
        dueDate: chargeEntry.dueDate,
      };
    }
    return {
      rent: tenant.rent,
      water: 0,
      garbage: 0,
      deposit: 0,
      total: expected,
      remaining: expected,
      dueDate: null,
    };
  };

  function chargeBreakdown(charge, omitRent = false) {
    const parts = [];
    if (!omitRent || charge.rent > 0)
      parts.push(`Rent: KES ${charge.rent.toLocaleString()}`);
    if (charge.deposit > 0)
      parts.push(`Deposit: KES ${charge.deposit.toLocaleString()}`);
    if (charge.garbage > 0)
      parts.push(`Garbage: KES ${charge.garbage.toLocaleString()}`);
    if (charge.water > 0)
      parts.push(`Water: KES ${charge.water.toLocaleString()}`);
    return parts.join(", ");
  }

  const allMonths = [
    ...new Set(tenant.paymentHistory.map((e) => e.month)),
  ].sort();
  const overdueMonths = [];
  let previousCumulative = 0;
  let beforeCurrentCumulative = 0;

  for (const month of allMonths) {
    const charge = getMonthCharges(month);
    if (!charge.dueDate) continue;

    if (month === currentMonth) {
      beforeCurrentCumulative = previousCumulative;
    }

    const currentCumulative = charge.remaining;
    const standalone = currentCumulative - previousCumulative;
    previousCumulative = currentCumulative;

    const dueDateObj = new Date(charge.dueDate);
    if (dueDateObj < today && standalone > 0) {
      overdueMonths.push({ month, charge, standalone });
    }
  }

  if (
    beforeCurrentCumulative === 0 &&
    allMonths.length > 0 &&
    allMonths[allMonths.length - 1] !== currentMonth
  ) {
    beforeCurrentCumulative = previousCumulative;
  }

  const currentCharge = getMonthCharges(currentMonth);
  const paymentsThisMonth = tenant.paymentHistory.filter(
    (e) => e.month === currentMonth && e.amountPaid > 0
  );
  const paidThisMonth = paymentsThisMonth.reduce(
    (sum, e) => sum + e.amountPaid,
    0
  );

  function currentMonthSentence(prefix = "Current month ") {
    const monthLabel = prefix + formatMonth(currentMonth) + ":";
    const totalStr = `KES ${currentCharge.total.toLocaleString()}`;
    const details = chargeBreakdown(currentCharge, false);
    return `${monthLabel} ${totalStr} (${details})`;
  }

  if (overdueMonths.length === 0) {
    if (credit > 0) {
      if (paidThisMonth >= currentCharge.total) {
        return (
          `Dear ${tenant.name}, ` +
          `you have a credit of KES ${credit.toLocaleString()}. ` +
          `No overdue payments. ` +
          `${currentMonthSentence()} – fully paid. ` +
          `Due by ${dueStr}. Thank you!`
        );
      } else {
        const leftToFullyPay = Math.max(0, currentCharge.total - paidThisMonth);
        const afterCredit = Math.max(0, leftToFullyPay - credit);
        const coverText =
          afterCredit === 0
            ? `your credit covers it`
            : `your credit reduces what's needed to KES ${afterCredit.toLocaleString()}`;
        return (
          `Dear ${tenant.name}, ` +
          `you have a credit of KES ${credit.toLocaleString()}. ` +
          `No overdue payments. ` +
          `${currentMonthSentence()}, ${coverText}. ` +
          `Due by ${dueStr}. Thank you!`
        );
      }
    }

    if (paidThisMonth >= currentCharge.total) {
      return (
        `Dear ${tenant.name}, ` +
        `all payments are up to date – nothing is owed. ` +
        `${currentMonthSentence()} – fully paid. ` +
        `Thank you for paying on time!`
      );
    }

    const left = currentCharge.remaining;
    const paidText =
      paidThisMonth > 0
        ? `paid KES ${paidThisMonth.toLocaleString()}, left KES ${left.toLocaleString()}`
        : `nothing paid yet, left KES ${left.toLocaleString()}`;

    return (
      `Dear ${tenant.name}, ` +
      `you are up to date – no overdue payments. ` +
      `${currentMonthSentence()}, ${paidText}. ` +
      `Due by ${dueStr}. Thank you!`
    );
  }

  let msg = `Dear ${tenant.name}, here's your rent summary. `;

  const overdueParts = overdueMonths.map(({ month, charge, standalone }) => {
    const breakdown = chargeBreakdown(charge, false);
    return `${formatMonth(
      month
    )} KES ${standalone.toLocaleString()} remaining (Total: KES ${charge.total.toLocaleString()}, ${breakdown})`;
  });
  msg += `Overdue: ${overdueParts.join(", ")}. `;

  const totalOverdue = overdueMonths.reduce((sum, m) => sum + m.standalone, 0);
  msg += `Total overdue: KES ${totalOverdue.toLocaleString()}. `;

  if (credit > 0) {
    const netOverdue = Math.max(0, totalOverdue - credit);
    msg += `You have a credit of KES ${credit.toLocaleString()}, so your net overdue payment is KES ${netOverdue.toLocaleString()}. `;
  }

  const standaloneCurrent = currentCharge.remaining - beforeCurrentCumulative;
  const leftCurrent = Math.max(0, standaloneCurrent);
  const paidText =
    paidThisMonth > 0
      ? `paid KES ${paidThisMonth.toLocaleString()}, left KES ${leftCurrent.toLocaleString()}`
      : `nothing paid yet, left KES ${leftCurrent.toLocaleString()}`;

  msg += `${currentMonthSentence()}, ${paidText}. `;
  msg += `Due by ${dueStr}. `;
  msg += `Please clear your overdue balance. Thank you!`;

  return msg;
}

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
            email: tenantEmailInput?.value || "",
            depositPeriod: includeDeposit
              ? parseInt(
                  document.getElementById("deposit-period-input").value
                ) || 1
              : 0,

            newTenant:
              document.getElementById("new-tenant-checkbox")?.checked ?? true,
          }),
        }
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message);
      }
      const newTenant = await response.json();
      console.log(
        "NEW TENANT FROM SERVER:",
        JSON.stringify(newTenant, null, 2)
      ); // 👈 ADD THIS
      await loadTenants();
      console.log(
        "TENANT ARRAY AFTER RELOAD:",
        tenantArray.map((t) => t.name)
      ); // 👈 ADD THIS
      Toast.fire({ icon: "success", title: "Tenant Added" });
      tenantName.value = "";
      houseNumber.value = "";
      phoneNumber.value = "";
      tenantNotes.value = "";

      tenantEmailInput.value = "";
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
    result.sort((a, b) => {
      const ha = String(a.houseNumber || "").trim();
      const hb = String(b.houseNumber || "").trim();
      return ha.localeCompare(hb, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }

  const searchType =
    document.getElementById("search-type-select")?.value || "all";

  if (searchTerm) {
    result = result.filter((t) => {
      const matchName = t.name.toLowerCase().includes(searchTerm);
      const matchPhone =
        t.phoneNumber && t.phoneNumber.toLowerCase().includes(searchTerm);
      const matchHouse =
        t.houseNumber &&
        t.houseNumber.trim().toLowerCase() === searchTerm.trim().toLowerCase();

      switch (searchType) {
        case "name":
          return matchName;
        case "phone":
          return matchPhone;
        case "house":
          return matchHouse;
        default:
          return matchName || matchPhone || matchHouse;
      }
    });
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
document
  .getElementById("search-type-select")
  .addEventListener("change", applyFiltersAndSort);
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

 <div class="profile-field"><label>Email:</label> <input type="email" id="edit-email" value="${
   tenant.email || ""
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
              email: document.getElementById("edit-email")?.value || "",
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

  const closeBtns = ["close-import-export-modal", "close-import-export-footer"];
  closeBtns.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", closeModal);
  });

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

  const tenantsMissingWater = tenantArray.filter((tenant) => {
    return !(tenant.waterMeterReadings || []).some(
      (r) => r.month === currentMonth
    );
  });
  const missingCount = tenantsMissingWater.length;

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

    const waterBtn = document.getElementById("status-bar-water-action");
    if (waterBtn) {
      waterBtn.addEventListener("click", () => {
        const filterSelect = document.getElementById("filter-select");
        if (filterSelect) {
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
    tenant.paymentHistory.forEach((record) => {
      if (record.amountPaid) allTimeCollected += record.amountPaid;
    });

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

function getTenantTotalOutstanding(tenant) {
  if (!tenant.paymentHistory || tenant.paymentHistory.length === 0) {
    return tenant.rent;
  }
  const sorted = [...tenant.paymentHistory].sort((a, b) => {
    if (a.month !== b.month) return a.month.localeCompare(b.month);
    const aTime = a.datePaid ? new Date(a.datePaid).getTime() : 0;
    const bTime = b.datePaid ? new Date(b.datePaid).getTime() : 0;
    return aTime - bTime;
  });
  return sorted[sorted.length - 1].remainingBalance;
}

// ─────────────────────────────────────────────────────
//   SHORT BALANCE MESSAGE (single SMS, all use cases)
// ─────────────────────────────────────────────────────
function generateShortBalanceMessage(tenant) {
  const today = getAppToday();
  const overdue = getTenantPastDueAmount(tenant, today);
  const currentMonth = getCurrentBillingMonthForTenant(tenant);
  const dueDate = getTenantNextDueDate(tenant);
  const currentTotal = getExpectedForMonth(
    tenant,
    currentMonth,
    globalSettings
  );
  const totalOutstanding = getTenantTotalOutstanding(tenant);
  const credit = totalOutstanding < 0 ? Math.abs(totalOutstanding) : 0;

  function formatDueDate(dateVal) {
    if (!dateVal) return "";
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return "";
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return d.getUTCDate() + " " + months[d.getUTCMonth()];
  }

  const dueStr = formatDueDate(dueDate);

  // Find charge entries for current and previous month
  const currentCharge = (tenant.paymentHistory || []).find(
    (e) => e.month === currentMonth && (e.amountPaid || 0) === 0 && !e.datePaid
  );

  if (!currentCharge) {
    return `Dear ${
      tenant.name
    }, no payments recorded yet. Current month KES ${currentTotal.toLocaleString()} due by ${dueStr}. Thank you!`;
  }

  const cumulative = currentCharge.remainingBalance;
  const allMonthsSorted = [
    ...new Set((tenant.paymentHistory || []).map((e) => e.month)),
  ].sort();
  const currentIndex = allMonthsSorted.indexOf(currentMonth);
  const previousMonth =
    currentIndex > 0 ? allMonthsSorted[currentIndex - 1] : null;
  let previousCumulative = 0;
  if (previousMonth) {
    const prevCharge = (tenant.paymentHistory || []).find(
      (e) =>
        e.month === previousMonth && (e.amountPaid || 0) === 0 && !e.datePaid
    );
    if (prevCharge) {
      previousCumulative = prevCharge.remainingBalance;
    }
  }

  const monthLeft = Math.max(0, cumulative) - Math.max(0, previousCumulative);

  // Overdue branch
  if (overdue > 0) {
    return `Dear ${
      tenant.name
    }, total overdue KES ${overdue.toLocaleString()}. Current month KES ${currentTotal.toLocaleString()} due by ${dueStr}. Please pay overdue.`;
  }

  // No overdue – fully covered (by payments or credit)
  if (monthLeft === 0) {
    if (credit > 0) {
      return `Dear ${
        tenant.name
      }, no overdue, KES ${credit.toLocaleString()} credit on your account. Thank you!`;
    }
    // Fully paid – no due date needed
    return `Dear ${tenant.name}, all payments up to date, including this month. Thank you!`;
  }

  // Still owes something for current month
  return `Dear ${
    tenant.name
  }, no overdue, KES ${monthLeft.toLocaleString()} still to pay this month. Due by ${dueStr}. Thank you!`;
}
// ─────────────────────────────────────────────────────

// ----- INDIVIDUAL SMS MODAL (with segment cost) -----
async function showIndividualSmsModal(tenantId, prefillMessage = "") {
  const tenant = tenantArray.find((t) => t._id === tenantId);
  if (!tenant) return;

  const templates = {
    thanks: `Dear ${tenant.name}, thank you for your payment. Have a great day!`,
    quickBalance: generateShortBalanceMessage(tenant),
  };

  const { value: message } = await Swal.fire({
    title: `📱 Send SMS to ${tenant.name}`,
    html: `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <select id="individual-template" style="padding: 10px; border-radius: 40px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border);">
          <option value="custom">✏️ Custom message</option>
          <option value="thanks">🙏 Thank you</option>
          <option value="quickBalance">⚡ Quick Balance (short)</option>
        </select>
        <textarea id="individual-message" rows="5" placeholder="Type your message here..." style="padding: 12px; border-radius: 20px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); width: 100%;">${escapeHtml(
          prefillMessage
        )}</textarea>
        <div style="font-size: 0.75rem; color: var(--text-muted); text-align: right;" id="ind-char-counter">0 chars | 0 SMS</div>
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
      const charSpan = document.getElementById("ind-char-counter");

      const updateCounter = () => {
        const len = textarea.value.length;
        const segments = Math.max(1, Math.ceil(len / 160));
        charSpan.innerHTML = `${len} chars | ${segments} SMS <span style="color:${
          len > 160 ? "#f87171" : "inherit"
        };">(${segments * 0.8} KES)</span>`;
      };
      textarea.addEventListener("input", updateCounter);
      updateCounter();

      templateSelect.addEventListener("change", () => {
        const val = templateSelect.value;
        if (val === "custom") {
          textarea.value = "";
        } else if (val === "quickBalance") {
          textarea.value = templates.quickBalance;
        } else {
          textarea.value = templates[val] || "";
        }
        updateCounter();
      });
    },
  });

  if (!message) return;

  const segments = Math.max(1, Math.ceil(message.length / 160));
  const cost = segments * 0.8;

  const confirm = await Swal.fire({
    title: "📨 Confirm SMS",
    html: `
      <div style="text-align: center;">
        <div style="font-size: 1.1rem; margin-bottom: 16px;">You are about to send an SMS to <strong>${escapeHtml(
          tenant.name
        )}</strong>.</div>
        <div style="background: linear-gradient(135deg, #10b98120, #3b82f620); padding: 16px; border-radius: 24px; margin: 16px 0;">
          <div style="font-size: 2rem; font-weight: 800; color: #fbbf24;">KES ${cost.toFixed(
            2
          )}</div>
          <div style="font-size: 0.85rem; color: var(--text-secondary);">${segments} SMS × KES 0.80</div>
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
    confirmButtonText: `Yes, send (KES ${cost.toFixed(2)})`,
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
function generateDetailedBalanceHtml(tenant, landlordName = "Your Landlord") {
  const logoUrl = "https://rentaltracker.onrender.com/images/logo1.png"; // your logo

  const today = getAppToday();
  const overdue = getTenantPastDueAmount(tenant, today); // total overdue (respects initialPastDue)
  const totalOutstanding = getTenantTotalOutstanding(tenant);
  const credit = totalOutstanding < 0 ? Math.abs(totalOutstanding) : 0;

  // Build structured rows for all months
  const allMonths = [
    ...new Set(tenant.paymentHistory.map((e) => e.month)),
  ].sort();
  const rows = [];

  // Compute standalone left for each month (same logic as payment modal)
  const leftByMonth = new Map();
  let prevCumulative = 0;
  for (const month of allMonths) {
    const chargeEntry = tenant.paymentHistory.find(
      (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
    );
    if (!chargeEntry) continue;
    const cumulative = chargeEntry.remainingBalance;
    const monthLeft = Math.max(0, cumulative) - Math.max(0, prevCumulative);
    leftByMonth.set(month, monthLeft);
    prevCumulative = cumulative;
  }

  // Determine deposit period
  const firstMonth = allMonths.length > 0 ? allMonths[0] : null;
  let depositEndMonth = null;
  if (
    firstMonth &&
    tenant.deposit &&
    tenant.depositPeriod &&
    tenant.depositPeriod > 0
  ) {
    const [fy, fm] = firstMonth.split("-").map(Number);
    const endDate = new Date(Date.UTC(fy, fm - 1 + tenant.depositPeriod, 0));
    depositEndMonth = `${endDate.getUTCFullYear()}-${String(
      endDate.getUTCMonth() + 1
    ).padStart(2, "0")}`;
  }

  // Gather data for each month
  for (const month of allMonths) {
    const chargeEntry = tenant.paymentHistory.find(
      (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
    );
    if (!chargeEntry) continue;

    const rentAmount = tenant.rent;
    let depositInstalment = 0;
    if (
      firstMonth &&
      tenant.deposit &&
      tenant.depositPeriod &&
      month >= firstMonth &&
      month <= depositEndMonth
    ) {
      depositInstalment = Math.round(tenant.rent / tenant.depositPeriod);
    }

    const waterCharge = chargeEntry.waterCharge || 0;
    const garbageCharge = chargeEntry.garbageCharge || 0;
    const totalDue =
      chargeEntry.totalDue ||
      rentAmount + depositInstalment + waterCharge + garbageCharge;

    const paymentsThisMonth = tenant.paymentHistory.filter(
      (e) => e.month === month && e.amountPaid > 0
    );
    const paid = paymentsThisMonth.reduce((sum, e) => sum + e.amountPaid, 0);

    const monthLeft = leftByMonth.get(month) || 0;
    const dueDate = chargeEntry.dueDate ? new Date(chargeEntry.dueDate) : null;

    // ---------- FIX: respect initialPastDue flag ----------
    const isPastDueByDate = dueDate && dueDate < today && monthLeft > 0;
    const isInitialPastDue = chargeEntry.initialPastDue && monthLeft > 0;
    const isOverdue = isPastDueByDate || isInitialPastDue;

    const balance = chargeEntry.remainingBalance;

    let status = "";
    if (balance <= 0) {
      status = "Paid";
    } else if (isOverdue) {
      status = "Overdue";
    } else {
      status = "Pending";
    }

    rows.push({
      month,
      rentAmount,
      depositInstalment,
      waterCharge,
      garbageCharge,
      totalDue,
      paid,
      balance: monthLeft,
      cumulative: balance,
      status,
      isOverdue,
    });
  }

  // Build table rows
  let tableRows = "";
  for (const r of rows) {
    const rowBg = r.isOverdue ? "#fff5f5" : "transparent";
    const statusColor = r.isOverdue ? "#d32f2f" : "#2e7d32";
    tableRows += `
      <tr style="background:${rowBg};">
        <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important; font-weight:600;">${
          r.month
        }</td>
        <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important;">${r.rentAmount.toLocaleString()}</td>
        <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important;">${
          r.depositInstalment > 0 ? r.depositInstalment.toLocaleString() : "—"
        }</td>
        <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important;">${r.waterCharge.toLocaleString()}</td>
        <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important;">${r.garbageCharge.toLocaleString()}</td>
        <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important; font-weight:600;">${r.totalDue.toLocaleString()}</td>
        <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important;">${
          r.paid > 0 ? r.paid.toLocaleString() : "—"
        }</td>
        <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important; font-weight:700; ${
          r.balance > 0 ? "color:#d32f2f;" : "color:#2e7d32;"
        }">${r.balance.toLocaleString()}</td>
        <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important; font-weight:700; color:${statusColor};">${
      r.status
    }</td>
      </tr>`;
  }

  // Use the correct overdue amount (already computed by getTenantPastDueAmount)
  const totalOverdue = overdue; // <-- this is the real overdue, matches the row overdue flags now

  let note = "";
  if (overdue > 0) {
    note = `<div style="background:#fff5f5; border-left:5px solid #d32f2f; padding:18px 24px; border-radius:10px; margin-top:28px; text-align:center;">
              <p style="margin:0; font-size:18px; font-weight:700; color:#d32f2f;">Total overdue: KES ${totalOverdue.toLocaleString()}</p>
              <p style="margin:6px 0 0; font-size:15px; color:#b71c1c;">Please pay at your earliest convenience.</p>
            </div>`;
  } else if (credit > 0) {
    note = `<div style="background:#e8f5e9; border-left:5px solid #2e7d32; padding:18px 24px; border-radius:10px; margin-top:28px; text-align:center;">
              <p style="margin:0; font-size:18px; font-weight:700; color:#2e7d32;">You have a credit of KES ${credit.toLocaleString()}.</p>
              <p style="margin:6px 0 0; font-size:15px; color:#1b5e20;">Thank you!</p>
            </div>`;
  } else {
    note = `<div style="background:#e8f5e9; border-left:5px solid #2e7d32; padding:18px 24px; border-radius:10px; margin-top:28px; text-align:center;">
              <p style="margin:0; font-size:18px; font-weight:700; color:#2e7d32;">All payments are up to date. Thank you!</p>
            </div>`;
  }

  // Full professional email template
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rent Statement</title>
</head>
<body style="margin:0; padding:0; background:#f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <div style="max-width:800px; margin:20px auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(0,0,0,0.08);">
    
    <!-- Header with Logo -->
    <div style="background:#0f172a; padding:36px 24px; text-align:center;">
      <img src="${logoUrl}" alt="Logo" style="height:50px; margin-bottom:15px; display:block; margin-left:auto; margin-right:auto;" />
      <h1 style="margin:0; font-size:28px; font-weight:800; color:#ffffff; letter-spacing:0.8px;">RENTAL TRACKER</h1>
      <p style="margin:8px 0 0; font-size:18px; color:#cbd5e1; font-weight:400;">Monthly Rent Statement</p>
      <p style="margin:6px 0 0; font-size:16px; color:#94a3b8;">Landlord: ${escapeHtml(
        landlordName
      )}</p>
    </div>

    <!-- Body -->
    <div style="padding:36px 24px;">
      <p style="font-size:17px; color:#1e293b; margin-bottom:4px; font-weight:500;">Dear ${escapeHtml(
        tenant.name
      )},</p>
      <p style="font-size:16px; color:#475569; line-height:1.6; margin-bottom:20px;">Here is your detailed rent statement. Please review and arrange any outstanding payments.</p>

      <!-- Table -->
      <table style="width:100%; border-collapse:collapse; font-size:16px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Month</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Rent</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Deposit</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Water</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Garbage</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Total</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Paid</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Balance</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>

      ${note}

      <p style="font-size:15px; color:#64748b; margin-top:35px; text-align:center; line-height:1.6;">
        If you have any questions, please contact your landlord.<br>
        This statement was generated on ${today.toLocaleDateString()}.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#0f172a; padding:20px 24px; text-align:center;">
      <p style="margin:0; font-size:13px; color:#94a3b8;">&copy; ${new Date().getFullYear()} Rental Tracker. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

async function showEmailModal(tenantId) {
  const tenant = tenantArray.find((t) => t._id === tenantId);
  if (!tenant) return;

  if (!tenant.email) {
    Toast.fire({
      icon: "warning",
      title: "No email address",
      text: "Please add an email address for this tenant first.",
    });
    return;
  }

  const templates = {
    thanks: `Dear ${tenant.name},\nThank you for your payment. Have a great day!`,
    quickBalance: generateShortBalanceMessage(tenant),
    detailedBalance: generateDetailedBalanceHtml(
      tenant,
      userProfile.landlordName || userProfile.name || "Your Landlord"
    ),
  };

  const { value: formValues } = await Swal.fire({
    title: `📧 Send Email to ${tenant.name}`,
    html: `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <select id="email-template" style="padding: 10px; border-radius: 40px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border);">
          <option value="custom">✏️ Custom message</option>
          <option value="thanks">🙏 Thank you</option>
          <option value="quickBalance">⚡ Quick Balance</option>
          <option value="detailedBalance">📋 Detailed Balance</option>
        </select>
        <input id="email-subject" class="swal2-input" placeholder="Subject" value="Rent Update" style="margin:0;">
        <textarea id="email-body" rows="6" placeholder="Type your message..." style="padding:12px; border-radius:20px; background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border); width:100%;"></textarea>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: "Send Email",
    confirmButtonColor: "#10b981",
    cancelButtonText: "Cancel",
    background: "#1e293b",
    color: "#f1f5f9",
    preConfirm: () => {
      const subject = document.getElementById("email-subject").value.trim();
      const body = document.getElementById("email-body").value.trim();
      if (!subject || !body) {
        Swal.showValidationMessage("Subject and message are required");
        return false;
      }
      return { subject, message: body };
    },
    didOpen: () => {
      const templateSelect = document.getElementById("email-template");
      const subjectInput = document.getElementById("email-subject");
      const bodyArea = document.getElementById("email-body");

      templateSelect.addEventListener("change", () => {
        const val = templateSelect.value;
        if (val === "custom") {
          bodyArea.value = "";
          subjectInput.value = "Rent Update";
        } else if (val === "quickBalance") {
          subjectInput.value = "Rent Balance";
          bodyArea.value = templates.quickBalance;
        } else if (val === "detailedBalance") {
          subjectInput.value = "Your Rent Statement";
          bodyArea.value = templates.detailedBalance;
        } else if (val === "thanks") {
          subjectInput.value = "Thank You";
          bodyArea.value = templates.thanks;
        }
      });
    },
  });

  if (!formValues) return;

  const btn = document.getElementById("modal-send-email");
  setButtonLoading(btn, true);
  try {
    const response = await fetchWithTimeout(
      window.location.origin + "/tenants/send-emails",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          tenantIds: [tenantId],
          subject: formValues.subject,
          message: formValues.message,
        }),
      }
    );
    const data = await response.json();
    if (response.ok) {
      const success = (data.results || [])[0]?.success;
      if (success) {
        Toast.fire({ icon: "success", title: "Email sent" });
      } else {
        Toast.fire({ icon: "error", title: "Failed to send email" });
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

function showBulkEmailModal() {
  let tenants = [...tenantArray].filter((t) => t.email);
  if (tenants.length === 0) {
    Toast.fire({ icon: "warning", title: "No tenants with email addresses." });
    return;
  }

  tenants.sort((a, b) => {
    const ha = String(a.houseNumber || "").trim();
    const hb = String(b.houseNumber || "").trim();
    return ha.localeCompare(hb, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  const html = `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <select id="email-bulk-template" style="width:100%;padding:10px;border-radius:40px;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border);">
        <option value="custom">✏️ Custom message</option>
        <option value="thanks">🙏 Thank you</option>
        <option value="quickBalance">⚡ Quick Balance</option>
        <option value="detailedBalance">📋 Detailed Balance</option>
      </select>
      <input id="email-bulk-subject" class="swal2-input" placeholder="Subject" value="Rent Update" style="margin:0;">
      <textarea id="email-bulk-body" rows="5" placeholder="Type your message..." style="padding:10px;border-radius:10px;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border);width:100%;resize:vertical;"></textarea>
      <div id="email-bulk-note" style="display:none;background:rgba(6,182,212,0.1);border-left:3px solid var(--accent-cyan);padding:10px;border-radius:8px;color:var(--text-secondary);font-size:0.85rem;">
        Each tenant will receive a personalised balance email.
      </div>
      <div style="background:var(--bg-tertiary);border-radius:12px;border:1px solid var(--border);">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--border);background:var(--bg-elevated);">
              <th style="padding:10px 4px;width:35px;"></th>
              <th style="padding:10px 4px;">House</th>
              <th style="padding:10px 4px;">Name</th>
              <th style="padding:10px 4px;">Email</th>
            </tr>
          </thead>
          <tbody>
            ${tenants
              .map(
                (t) => `
              <tr style="border-bottom:1px solid var(--border);">
                <td style="padding:10px 4px;text-align:center;">
                  <input type="checkbox" class="email-tenant-select" data-id="${
                    t._id
                  }" style="width:18px;height:18px;accent-color:#10b981;">
                </td>
                <td style="padding:10px 4px;text-align:center;">${escapeHtml(
                  t.houseNumber || "—"
                )}</td>
                <td style="padding:10px 4px;text-align:center;">${escapeHtml(
                  t.name
                )}</td>
                <td style="padding:10px 4px;text-align:center;">${escapeHtml(
                  t.email
                )}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  Swal.fire({
    title: "📧 Send Email to Tenants",
    html,
    showCancelButton: true,
    confirmButtonText: "Send",
    confirmButtonColor: "#10b981",
    cancelButtonColor: "#ef4444",
    background: "#1e293b",
    color: "#f1f5f9",
    width: "auto",
    customClass: { popup: "fullscreen-sms-modal" },
    didOpen: () => {
      const templateSelect = document.getElementById("email-bulk-template");
      const subjectInput = document.getElementById("email-bulk-subject");
      const bodyArea = document.getElementById("email-bulk-body");
      const balanceNote = document.getElementById("email-bulk-note");

      templateSelect.addEventListener("change", () => {
        const val = templateSelect.value;
        if (val === "custom") {
          bodyArea.style.display = "block";
          subjectInput.style.display = "block";
          bodyArea.value = "";
          subjectInput.value = "Rent Update";
          balanceNote.style.display = "none";
        } else if (val === "thanks") {
          bodyArea.style.display = "block";
          subjectInput.style.display = "block";
          subjectInput.value = "Thank You";
          bodyArea.value = "Thank you for your payment. Have a great day!";
          balanceNote.style.display = "none";
        } else if (val === "quickBalance") {
          bodyArea.style.display = "none";
          subjectInput.style.display = "none";
          balanceNote.style.display = "block";
        } else if (val === "detailedBalance") {
          bodyArea.style.display = "none";
          subjectInput.style.display = "none";
          balanceNote.style.display = "block";
        }
      });
    },
    preConfirm: async () => {
      const selected = Array.from(
        document.querySelectorAll(".email-tenant-select:checked")
      ).map((cb) => cb.dataset.id);
      if (selected.length === 0) {
        Swal.showValidationMessage("Select at least one tenant.");
        return false;
      }
      const subject = document
        .getElementById("email-bulk-subject")
        .value.trim();
      const body = document.getElementById("email-bulk-body").value.trim();
      const templateValue = document.getElementById(
        "email-bulk-template"
      ).value;
      return {
        tenantIds: selected,
        subject,
        message: body,
        isBalanceMode: templateValue === "quickBalance",
        isDetailed: templateValue === "detailedBalance",
      };
    },
  }).then(async (result) => {
    if (!result.isConfirmed) return;
    const { tenantIds, subject, message, isBalanceMode, isDetailed } =
      result.value;

    const btn = document.getElementById("bulk-email-btn");
    setButtonLoading(btn, true);
    try {
      let summary = "";

      if (isBalanceMode) {
        // Quick Balance – personalised short messages
        const selectedTenants = tenants.filter((t) =>
          tenantIds.includes(t._id)
        );
        let successCount = 0;
        const failedNames = [];
        for (const tenant of selectedTenants) {
          const personalisedMsg = generateShortBalanceMessage(tenant);
          try {
            const res = await fetchWithTimeout(
              window.location.origin + "/tenants/send-emails",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${localStorage.getItem("token")}`,
                },
                body: JSON.stringify({
                  tenantIds: [tenant._id],
                  subject: "Rent Balance",
                  message: personalisedMsg,
                }),
              }
            );
            const data = await res.json();
            if (data.results?.[0]?.success) {
              successCount++;
            } else {
              failedNames.push(tenant.name);
            }
          } catch (err) {
            failedNames.push(tenant.name);
          }
        }
        summary = `Sent to ${successCount} tenant(s).`;
        if (failedNames.length)
          summary += ` Failed for: ${failedNames.join(", ")}.`;
      } else if (isDetailed) {
        // Detailed Balance – professional HTML emails
        const selectedTenants = tenants.filter((t) =>
          tenantIds.includes(t._id)
        );
        let successCount = 0;
        const failedNames = [];
        for (const tenant of selectedTenants) {
          const personalisedMsg = generateDetailedBalanceHtml(
            tenant,
            userProfile.landlordName || userProfile.name || "Your Landlord"
          );
          try {
            const res = await fetchWithTimeout(
              window.location.origin + "/tenants/send-emails",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${localStorage.getItem("token")}`,
                },
                body: JSON.stringify({
                  tenantIds: [tenant._id],
                  subject: "Your Rent Statement",
                  message: personalisedMsg,
                }),
              }
            );
            const data = await res.json();
            if (data.results?.[0]?.success) {
              successCount++;
            } else {
              failedNames.push(tenant.name);
            }
          } catch (err) {
            failedNames.push(tenant.name);
          }
        }
        summary = `Sent to ${successCount} tenant(s).`;
        if (failedNames.length)
          summary += ` Failed for: ${failedNames.join(", ")}.`;
      } else {
        // Custom / Thanks – one message to all selected
        const response = await fetchWithTimeout(
          window.location.origin + "/tenants/send-emails",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({ tenantIds, subject, message }),
          }
        );
        const data = await response.json();
        if (response.ok) {
          let sent = (data.results || []).filter((r) => r.success).length;
          summary = `Sent to ${sent} tenants.`;
          const failed = (data.results || []).filter((r) => !r.success);
          if (failed.length)
            summary += ` Failed for: ${failed
              .map((f) => f.tenant)
              .join(", ")}.`;
        } else {
          summary = data.message || "Failed to send";
        }
      }
      Toast.fire({ icon: "success", title: summary });
    } catch (err) {
      Toast.fire({ icon: "error", title: err.message });
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

// ----- EMAIL LOGS MODAL -----
function showEmailLogsModal() {
  Swal.fire({
    title: "📧 Email Logs",
    html: '<div style="text-align:center;padding:20px;">Loading...</div>',
    showCloseButton: true,
    showConfirmButton: false,
    background: "#1e293b",
    color: "#f1f5f9",
    didOpen: async () => {
      try {
        const response = await fetchWithTimeout("/tenants/email-logs", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });
        if (!response.ok) throw new Error("Failed to fetch email logs");
        let logs = await response.json();

        // Sort newest first
        logs.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const groups = [];
        let currentLabel = "";
        let currentGroup = [];

        for (const log of logs) {
          const sentDate = new Date(log.sentAt);
          sentDate.setHours(0, 0, 0, 0);
          let label = "";
          if (sentDate.getTime() === today.getTime()) {
            label = "Today";
          } else if (sentDate.getTime() === yesterday.getTime()) {
            label = "Yesterday";
          } else {
            label = sentDate.toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            });
          }

          if (label !== currentLabel) {
            if (currentGroup.length > 0)
              groups.push({ label: currentLabel, logs: currentGroup });
            currentLabel = label;
            currentGroup = [log];
          } else {
            currentGroup.push(log);
          }
        }
        if (currentGroup.length > 0)
          groups.push({ label: currentLabel, logs: currentGroup });

        let tableRows = "";
        if (groups.length === 0) {
          tableRows = `<tr><td colspan="5" style="text-align:center;padding:40px;">📭 No email logs found</td></tr>`;
        } else {
          groups.forEach((group) => {
            tableRows += `<tr class="sms-group-header"><td colspan="5">${group.label}</td></tr>`;
            group.logs.forEach((log) => {
              const d = new Date(log.sentAt);
              const timeStr = d.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              });
              const shortMsg =
                log.body.length > 50
                  ? log.body.substring(0, 50) + "…"
                  : log.body;
              tableRows += `
                <tr>
                  <td>${escapeHtml(log.tenantName)}</td>
                  <td>${escapeHtml(log.email)}</td>
                  <td class="msg-cell">${escapeHtml(shortMsg)}</td>
                  <td><span class="status-badge ${log.status}">${
                log.status
              }</span></td>
                  <td>${timeStr}</td>
                </tr>
              `;
            });
          });
        }

        const html = `
          <div class="sms-logs-root">
            <div class="sms-logs-header" style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--border, #334155);background:var(--bg-elevated, #1e293b);">
              <h2 style="margin:0;font-size:1.2rem;font-weight:600;color:var(--text-primary, #f1f5f9);">📧 Email Delivery Logs</h2>
              <button id="clear-email-logs-btn" style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid #ef4444;padding:4px 12px;border-radius:20px;font-size:0.8rem;font-weight:600;cursor:pointer;transition:0.15s;">Clear</button>
            </div>
            <div class="sms-logs-body">
              <table class="sms-logs-table">
                <thead>
                  <tr><th>Tenant</th><th>Email</th><th>Subject</th><th>Status</th><th>Time</th></tr>
                </thead>
                <tbody>${tableRows}</tbody>
              </table>
            </div>
          </div>
        `;

        Swal.update({ html });

        // Clear button
        const clearBtn = document.getElementById("clear-email-logs-btn");
        if (clearBtn) {
          clearBtn.addEventListener("click", async () => {
            const confirm = await Swal.fire({
              title: "Clear all email logs?",
              text: "This cannot be undone.",
              icon: "warning",
              showCancelButton: true,
              confirmButtonColor: "#ef4444",
              confirmButtonText: "Yes, clear all",
              background: "#1e293b",
              color: "#f1f5f9",
            });
            if (confirm.isConfirmed) {
              try {
                await fetchWithTimeout("/tenants/email-logs", {
                  method: "DELETE",
                  headers: {
                    Authorization: `Bearer ${localStorage.getItem("token")}`,
                  },
                });
                Swal.close();
                showEmailLogsModal();
              } catch (err) {
                Toast.fire({ icon: "error", title: "Failed to clear logs" });
              }
            }
          });
        }
      } catch (err) {
        Swal.update({
          html: '<div style="text-align:center;padding:20px;">Failed to load email logs.</div>',
        });
      }
    },
  });
}

// Open the bulk SMS modal
document.getElementById("bulk-sms-btn").addEventListener("click", () => {
  const btn = document.getElementById("bulk-sms-btn");
  const currentUserId = userProfile._id || userProfile.id || null;
  let tenants = [...tenantArray];
  if (tenants.length === 0) {
    Toast.fire({ icon: "warning", title: "No tenants to message." });
    return;
  }

  tenants.sort((a, b) => {
    const ha = String(a.houseNumber || "").trim();
    const hb = String(b.houseNumber || "").trim();
    return ha.localeCompare(hb, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  const today = getAppToday();
  const costPerMsg = 0.8;

  let html = `
  <div style="display: flex; flex-direction: column; gap: 16px;">
    <div>
<select id="sms-template-bulk" style="width: 100%; padding: 10px; border-radius: 40px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); margin-bottom: 8px;">
  <option value="custom">✏️ Custom message</option>
  <option value="thanks">🙏 Thank you (after payment)</option>
  <option value="quickBalance">⚡ Quick Balance (short)</option>
</select>
      <textarea id="sms-message" rows="4" placeholder="Type your message here..." style="width:100%; padding: 10px; font-size: 0.95rem; border-radius: 10px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); resize: vertical;"></textarea>
      <div id="balance-note" style="display:none; background: rgba(6,182,212,0.1); border-left: 3px solid var(--accent-cyan); padding: 10px; border-radius: 8px; color: var(--text-secondary); font-size: 0.85rem;">
  Each tenant will receive a personalised balance message.
</div>
      <div id="sms-char-counter" style="text-align: right; font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">0 characters</div>
    </div>

    <div style="display: flex; gap: 12px; justify-content: flex-start; padding: 0 4px;">
      <button id="sms-select-all" style="background: linear-gradient(135deg, #3b82f6, #2563eb); border: none; color: white; padding: 8px 20px; border-radius: 40px; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: 0.1s;">✓ Select All</button>
      <button id="sms-select-late" style="background: linear-gradient(135deg, #f59e0b, #d97706); border: none; color: white; padding: 8px 20px; border-radius: 40px; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: 0.1s;">⚠️ Select Late</button>
    </div>

    <div>
    <div style="background: var(--bg-tertiary); border-radius: 12px; border: 1px solid var(--border);">
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
    /* ========== MOBILE (max 768px) ========== */
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
    /* ========== DESKTOP (min 769px) ========== */
    @media (min-width: 769px) {
      .fullscreen-sms-modal {
        width: 85% !important;
        max-width: 1100px !important;
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
    .fullscreen-sms-modal .swal2-html-container > div > div {
      overflow-x: visible !important;
    }
  `;
      document.head.appendChild(style);

      const selectAllBtn = document.getElementById("sms-select-all");
      if (selectAllBtn) {
        selectAllBtn.addEventListener("click", () => {
          const allCheckboxes = document.querySelectorAll(".sms-tenant-select");
          const allChecked = Array.from(allCheckboxes).every(
            (cb) => cb.checked
          );
          const newState = !allChecked;
          allCheckboxes.forEach((cb) => {
            cb.checked = newState;
            cb.dispatchEvent(new Event("change"));
          });
          selectAllBtn.textContent = newState
            ? "✕ Deselect All"
            : "✓ Select All";
        });
      }

      const selectLateBtn = document.getElementById("sms-select-late");
      if (selectLateBtn) {
        selectLateBtn.addEventListener("click", () => {
          const allCheckboxes = document.querySelectorAll(".sms-tenant-select");
          const overdueCbs = Array.from(allCheckboxes).filter(
            (cb) => parseFloat(cb.dataset.overdue) > 0
          );
          const allOverdueChecked = overdueCbs.every((cb) => cb.checked);
          const newState = !allOverdueChecked;
          overdueCbs.forEach((cb) => {
            cb.checked = newState;
            cb.dispatchEvent(new Event("change"));
          });
          selectLateBtn.textContent = newState
            ? "✕ Deselect Late"
            : "⚠️ Select Late";
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
          if (val === "balance") {
            msgTextarea.style.display = "none";
            msgTextarea.value = "";
            const balanceNote = document.getElementById("balance-note");
            if (balanceNote) balanceNote.style.display = "block";
            updateCost();
          } else {
            msgTextarea.style.display = "block";
            const balanceNote = document.getElementById("balance-note");
            if (balanceNote) balanceNote.style.display = "none";
            updateCost();
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
            msgTextarea.dispatchEvent(new Event("input"));
          }
        });
      }

      const updateCost = () => {
        const selected = document.querySelectorAll(
          ".sms-tenant-select:checked"
        ).length;
        const totalCost = selected * costPerMsg;
        const costDiv = document.getElementById("sms-cost-estimate");
        const templateValue =
          document.getElementById("sms-template-bulk").value;
        const isBalanceMode = templateValue === "balance";

        if (selected === 0) {
          costDiv.innerHTML = "📊 Select tenants to see total cost";
        } else {
          let note = "";
          if (isBalanceMode) {
            note = ` <span style="color:#fbbf24; font-size:0.75rem;">(Balance enquiries may cost more for long messages)</span>`;
          }
          costDiv.innerHTML = `💰 <strong>Total cost: KES ${totalCost.toFixed(
            2
          )}</strong> (${selected} message${
            selected !== 1 ? "s" : ""
          } × KES ${costPerMsg})${note}`;
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
      const templateValue = document.getElementById("sms-template-bulk").value;
      const isBalanceMode = templateValue === "balance";

      if (selected.length === 0) {
        Swal.showValidationMessage("Select at least one tenant.");
        return false;
      }

      if (!isBalanceMode && !message.trim()) {
        Swal.showValidationMessage("Message cannot be empty.");
        return false;
      }

      const totalCost = selected.length * costPerMsg;

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
          <div style="font-size: 0.9rem; color: var(--text-primary, #f1f5f9); word-break: break-word;">${
            isBalanceMode
              ? "Each tenant will receive a personalised balance breakdown."
              : `“${escapeHtml(message.substring(0, 100))}${
                  message.length > 100 ? "…" : ""
                }”`
          }</div>
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
        buttonsStyling: false,
      });

      if (!confirm.isConfirmed) {
        Swal.showValidationMessage("Cancelled");
        return false;
      }
      return { tenantIds: selected, message, isBalanceMode };
    },
  }).then(async (result) => {
    if (result.isConfirmed) {
      const { tenantIds, message, isBalanceMode } = result.value;

      setButtonLoading(btn, true);
      try {
        let summary = "";
        if (isBalanceMode) {
          const selectedTenants = tenants.filter((t) =>
            tenantIds.includes(t._id)
          );
          let successCount = 0;
          const failedNames = [];
          for (const tenant of selectedTenants) {
            const personalisedMsg = generateShortBalanceMessage(tenant);
            try {
              const res = await fetchWithTimeout(
                window.location.origin + "/tenants/send-sms",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("token")}`,
                  },
                  body: JSON.stringify({
                    tenantIds: [tenant._id],
                    message: personalisedMsg,
                  }),
                }
              );
              const data = await res.json();
              if (data.results?.[0]?.success) {
                successCount++;
              } else {
                failedNames.push(tenant.name);
              }
            } catch (err) {
              failedNames.push(tenant.name);
            }
          }
          summary = `Sent to ${successCount} tenant(s).`;
          if (failedNames.length)
            summary += ` Failed for: ${failedNames.join(", ")}.`;
        } else {
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
            let sent = (data.results || []).filter((r) => r.success).length;
            summary = `Sent to ${sent} tenants.`;
            const failed = (data.results || []).filter((r) => !r.success);
            if (failed.length)
              summary += ` Failed for: ${failed
                .map((f) => f.tenant)
                .join(", ")}.`;
          } else {
            summary = data.message || "Failed to send";
          }
        }
        Toast.fire({ icon: "success", title: summary });
      } catch (err) {
        Toast.fire({ icon: "error", title: err.message });
      } finally {
        setButtonLoading(btn, false);
      }
    }
  });
});

document.getElementById("bulk-email-btn").addEventListener("click", () => {
  showBulkEmailModal();
});

// ----- SMS LOGS BUTTON (updated: date categories, clear all, sorted newest first) -----
const smsLogsBtn = document.getElementById("sms-logs-btn");

document.getElementById("email-logs-btn").addEventListener("click", () => {
  showEmailLogsModal();
});

if (smsLogsBtn) {
  smsLogsBtn.addEventListener("click", async () => {
    try {
      const response = await fetchWithTimeout("/tenants/sms-logs", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!response.ok) throw new Error("Failed to fetch logs");
      let logs = await response.json();

      // Sort newest first
      logs.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));

      // ---- Group logs by date category ----
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const groups = []; // array of { label, logs[] }
      let currentLabel = "";
      let currentGroup = [];

      for (const log of logs) {
        const sentDate = new Date(log.sentAt);
        sentDate.setHours(0, 0, 0, 0);
        let label = "";
        if (sentDate.getTime() === today.getTime()) {
          label = "Today";
        } else if (sentDate.getTime() === yesterday.getTime()) {
          label = "Yesterday";
        } else {
          label = sentDate.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          });
        }

        if (label !== currentLabel) {
          if (currentGroup.length > 0) {
            groups.push({ label: currentLabel, logs: currentGroup });
          }
          currentLabel = label;
          currentGroup = [log];
        } else {
          currentGroup.push(log);
        }
      }
      if (currentGroup.length > 0) {
        groups.push({ label: currentLabel, logs: currentGroup });
      }

      // Build table rows with group headers
      let tableRows = "";
      if (groups.length === 0) {
        tableRows = `<tr><td colspan="5" style="text-align:center; padding:40px;">📭 No SMS logs found</td></tr>`;
      } else {
        groups.forEach((group) => {
          // Group header row
          tableRows += `
            <tr class="sms-group-header">
              <td colspan="5">${group.label}</td>
            </tr>
          `;
          group.logs.forEach((log) => {
            const d = new Date(log.sentAt);
            const timeStr = d.toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            });
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
                <td>${timeStr}</td>
              </tr>
            `;
          });
        });
      }

      const html = `
        <div class="sms-logs-root">
          <div class="sms-logs-header" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-bottom: 1px solid var(--border, #334155); background: var(--bg-elevated, #1e293b);">
            <h2 style="margin:0; font-size:1.2rem; font-weight:600; color: var(--text-primary, #f1f5f9);">📜 SMS Delivery Logs</h2>
            <button id="clear-sms-logs-btn" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid #ef4444; padding:4px 12px; border-radius:20px; font-size:0.8rem; font-weight:600; cursor:pointer; transition:0.15s;">Clear</button>
          </div>
          <div class="sms-logs-body">
            <table class="sms-logs-table">
              <thead>
                <tr><th>Tenant</th><th>Phone</th><th>Message</th><th>Status</th><th>Time</th></tr>
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
          // Inject the premium styles (same as before, plus group header style)
          const style = document.createElement("style");
          style.textContent = `
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
            .sms-logs-root {
              display: flex;
              flex-direction: column;
              height: 100%;
              width: 100%;
              background: var(--bg-secondary);
            }
            .sms-logs-header {
              flex-shrink: 0;
            }
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

            /* Group header */
            .sms-group-header td {
              background: #1e293b;
              color: #94a3b8;
              font-weight: 700;
              font-size: 0.8rem;
              padding: 8px 12px;
              text-align: left;
              border-bottom: 1px solid #334155;
            }

            #clear-sms-logs-btn:hover {
              background: #ef4444;
              color: white;
            }

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

          // Clear all logs button handler
          const clearBtn = document.getElementById("clear-sms-logs-btn");
          if (clearBtn) {
            clearBtn.addEventListener("click", async () => {
              const confirm = await Swal.fire({
                title: "Clear all SMS logs?",
                text: "This cannot be undone.",
                icon: "warning",
                showCancelButton: true,
                confirmButtonColor: "#ef4444",
                confirmButtonText: "Yes, clear all",
                background: "#1e293b",
                color: "#f1f5f9",
              });
              if (confirm.isConfirmed) {
                try {
                  await fetchWithTimeout("/tenants/sms-logs", {
                    method: "DELETE",
                    headers: {
                      Authorization: `Bearer ${localStorage.getItem("token")}`,
                    },
                  });
                  Swal.close();
                  smsLogsBtn.click(); // reopen with fresh data
                } catch (err) {
                  Toast.fire({ icon: "error", title: "Failed to clear logs" });
                }
              }
            });
          }
        },
      });
    } catch (err) {
      Toast.fire({ icon: "error", title: "Failed to load SMS logs" });
    }
  });
}
