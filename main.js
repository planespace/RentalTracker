// ========================
//   main.js – STABLE VERSION (all features, no perf hacks)
// ========================

// ----- AUTH CHECK -----
const loginToken = localStorage.getItem("token");
if (!loginToken) {
  window.location.replace("login.html");
}

// ----- GLOBAL VARIABLES -----
let tenantInfoDiv = document.querySelector(".tenant-info-div");

let debtLineChart = null;
let paidDonutChart = null;
let trendLineChart = null;
let currentAppDate;
let tenantArray = [];
let globalSettings = { garbageFee: 0, waterRatePerUnit: 0, totalHouses: 0 };
let initialLoadComplete = false;
let userProfile = { name: "", email: "", phone: "", landlordName: "" };

let searchInput = document.querySelector(".search-tenants");
let tenantsInputs = document.querySelector(".tenants-inputs");

function getAppToday() {
  let result;
  if (devModeActive && currentDevDate) {
    // dev date – treat as Nairobi midnight
    result = new Date(currentDevDate + "T00:00:00+03:00");
    return result;
  }
  // Real Nairobi midnight
  const now = new Date();
  result = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  result = new Date(result.getTime() + 3 * 60 * 60 * 1000); // shift to Nairobi midnight
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
    const infoEl = document.getElementById("sms-balance-info");
    if (data.balance !== undefined && data.balance !== null && infoEl) {
      const balance = Number(data.balance);
      const costPerMsg = 0.8;
      const estimatedMessages = Math.floor(balance / costPerMsg);
      infoEl.textContent = `💰 ${balance.toLocaleString()} KES (≈ ${estimatedMessages} msgs)`;
    }
  } catch (err) {
    console.warn("Cannot fetch SMS balance");
  }
}

async function fetchAndDisplayEmailBalance() {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchWithTimeout(
        window.location.origin + "/tenants/email-usage",
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );
      const data = await res.json();
      const infoEl = document.getElementById("email-balance-info");
      if (data.remaining !== undefined && data.remaining !== null && infoEl) {
        infoEl.textContent = `✉️ ${data.remaining.toLocaleString()} emails left today`;
      }
      return; // success – stop retrying
    } catch (err) {
      if (attempt === maxRetries) {
        // All attempts failed – ignore silently (non‑critical)
        return;
      }
      // Wait 1 second before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
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
// ----- Global top‑bar loader (smooth shimmer) -----
(function () {
  const bar = document.createElement("div");
  bar.id = "top-loader";
  bar.innerHTML = `<div class="top-loader-shimmer"></div>`;

  // Inject the styles once
  const style = document.createElement("style");
  style.textContent = `
    #top-loader {
      position: fixed; top:0; left:0; width:100%; height:4px; z-index:99999;
      background: transparent;
      overflow: hidden;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.25s ease;
    }
    #top-loader.active {
      opacity: 1;
    }
    .top-loader-shimmer {
      width: 100%;
      height: 100%;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(56,189,248,0.4) 30%,
        rgba(56,189,248,0.7) 50%,
        rgba(56,189,248,0.4) 70%,
        transparent 100%
      );
      background-size: 200% 100%;
      animation: top-loader-slide 0.8s linear infinite;
    }
    @keyframes top-loader-slide {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `;
  document.head.appendChild(style);
  document.body.prepend(bar);

  let active = 0;
  let hideTimer = null;
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    active++;
    clearTimeout(hideTimer);
    bar.classList.add("active");

    const hide = () => {
      active--;
      if (active <= 0) {
        active = 0;
        // small delay so quick successive requests don't flicker the bar
        hideTimer = setTimeout(() => {
          bar.classList.remove("active");
        }, 200);
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

function wrapPremiumEmail(innerHtml, landlordName = "Landlord") {
  const today = new Date();
  const landlordPhone = userProfile.phone || "";
  const landlordEmail = userProfile.email || "";
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background:#F1F5F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width:700px; margin:30px auto; background:#FFFFFF; border-radius:24px; box-shadow: 0 8px 30px rgba(0,0,0,0.06);">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1E293B 0%, #0F172A 100%); padding:40px 24px 32px 24px; text-align:center; border-radius:24px 24px 0 0; border-bottom: 3px solid #38BDF8;">
      <h1 style="margin:0; font-size:30px; font-weight:800; color:#FFFFFF; letter-spacing:0.5px; line-height:1.2; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">PARADISE SUITES</h1>
      <p style="margin:14px 0 0; font-size:17px; color:#F1F5F9; font-weight:600;">Landlord: ${escapeHtml(
        landlordName
      )}</p>
      ${
        landlordPhone
          ? `<p style="margin:8px 0 0; font-size:16px; color:#F1F5F9; font-weight:500;">📞 ${escapeHtml(
              landlordPhone
            )}</p>`
          : ""
      }
      ${
        landlordEmail
          ? `<p style="margin:6px 0 0; font-size:16px; color:#F1F5F9; font-weight:500;">✉️ ${escapeHtml(
              landlordEmail
            )}</p>`
          : ""
      }
    </div>

    <!-- Body -->
    <div style="padding:32px 24px;">
      ${innerHtml}
    </div>

    <!-- 🎯 Footer – now clearly distinguishable -->
    <div style="background:#E2E8F0; padding:20px 24px; text-align:center; border-radius:0 0 24px 24px; border-top:1px solid #CBD5E1;">
      <p style="margin:0; font-size:14px; color:#1E293B; font-weight:500;">&copy; ${today.getFullYear()} Paradise Suites. All rights reserved.</p>
      <p style="margin:12px 0 0; font-size:13px; color:#B91C1C; font-weight:600;">🔒 We never send paybill numbers via email. Please ask the landlord or caretaker directly.</p>
    </div>
  </div>
</body>
</html>`;
}

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
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
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
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "info",
            title: "Using real date",
          });
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
  // Return cached profile instantly if available
  const cached = sessionStorage.getItem("userProfile");
  if (cached) {
    userProfile = JSON.parse(cached);
    return userProfile;
  }

  try {
    const response = await fetchWithTimeout(
      window.location.origin + "/auth/profile",
      {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      }
    );
    if (response.ok) {
      userProfile = await response.json();
      sessionStorage.setItem("userProfile", JSON.stringify(userProfile));
    }
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
  closeDropdownIfOpen();
  pushModalState();
  const html = `
    <div class="utilities-section" style="display: flex; flex-direction: column; gap: 16px; padding-bottom: calc(30px + env(safe-area-inset-bottom, 16px));">
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

      <!-- Save / Cancel ABOVE Change Password -->
      <div class="utility-actions" style="margin-top: 8px; display: flex; justify-content: center; gap: 12px;">
        <button id="save-landlord-profile" class="modal-action-btn">Save</button>
        <button id="cancel-landlord-profile" class="modal-action-btn danger">Cancel</button>
      </div>

      <!-- 🔒 Change Password section BELOW -->
      <hr style="border-color: var(--border); margin: 12px 0;">
      <h4 style="margin-bottom: 0;">🔒 Change Password</h4>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="color: var(--text-secondary); font-size: 0.9rem;">Old Password</label>
        <input type="password" id="old-password" class="swal2-input" style="margin: 0;" placeholder="Enter old password">
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="color: var(--text-secondary); font-size: 0.9rem;">New Password</label>
        <input type="password" id="new-password" class="swal2-input" style="margin: 0;" placeholder="Enter new password (min 6 characters)">
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="color: var(--text-secondary); font-size: 0.9rem;">Confirm New Password</label>
        <input type="password" id="confirm-password" class="swal2-input" style="margin: 0;" placeholder="Confirm new password">
      </div>
      <button id="change-password-btn" class="modal-action-btn" style="background: var(--accent-purple);">Update Password</button>
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
        sessionStorage.setItem("userProfile", JSON.stringify(userProfile));
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 2000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "success",
          title: "Profile updated",
        });
        closeModal();
      } catch (err) {
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: err.message || "Update failed",
        });
      } finally {
        setButtonLoading(e.target, false);
      }
    } else if (e.target.id === "cancel-landlord-profile") {
      closeModal();
    } else if (e.target.id === "change-password-btn") {
      const oldPassword = document.getElementById("old-password").value;
      const newPassword = document.getElementById("new-password").value;
      const confirmPassword = document.getElementById("confirm-password").value;

      if (!oldPassword || !newPassword || !confirmPassword) {
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: "All password fields are required.",
        });
        return;
      }

      if (newPassword !== confirmPassword) {
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: "Passwords do not match.",
        });
        return;
      }

      if (newPassword.length < 6) {
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: "Password must be at least 6 characters.",
        });
        return;
      }

      setButtonLoading(e.target, true);
      try {
        const response = await fetchWithTimeout("/auth/change-password", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({ oldPassword, newPassword }),
        });
        const data = await response.json();
        if (response.ok) {
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "success",
            title: "Password updated",
          });
          document.getElementById("old-password").value = "";
          document.getElementById("new-password").value = "";
          document.getElementById("confirm-password").value = "";
        } else {
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "error",
            title: data.message || "Failed to update password",
          });
        }
      } catch (err) {
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: err.message,
        });
      } finally {
        setButtonLoading(e.target, false);
      }
    }
  };

  const closeModal = () => {
    utilitiesModal.style.display = "none";
    overlay.style.display = "none";
    document.body.classList.remove("modal-open");
    document.removeEventListener("click", handler);
    window._landlordProfileHandler = null;
    popModalState();
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
  // Return cached settings instantly if available
  const cached = sessionStorage.getItem("globalSettings");
  if (cached) {
    globalSettings = JSON.parse(cached);
    return globalSettings;
  }

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

  // Cache for next time
  sessionStorage.setItem("globalSettings", JSON.stringify(globalSettings));
  return globalSettings;
}

async function updateGlobalSettingsOnServer(
  garbageFee,
  waterRatePerUnit,
  defaultDueDay,
  totalHouses,
  autoRemindersEnabled,
  autoEmailRemindersEnabled
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
        autoEmailRemindersEnabled,
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

let cachedTenants = null;
try {
  cachedTenants = JSON.parse(sessionStorage.getItem("cachedTenants"));
} catch (e) {}

async function loadTenants() {
  // ✅ Render cached data ONLY on the very first page load
  if (!initialLoadComplete && cachedTenants && cachedTenants.length) {
    tenantArray = cachedTenants;
    applyFiltersAndSort();
    updateCharts();
    updateAllTimeStats(tenantArray);
    updateOccupancy();
  }

  // Now fetch the real data from the server
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

    // Update the cache with the fresh data
    sessionStorage.setItem("cachedTenants", JSON.stringify(tenantArray));

    await fetchCurrentDate();
    await fetchUserProfile();
    await fetchGlobalSettings();
    populateMonthSelector();
    applyFiltersAndSort();
    ensureChartsVisible();

    setMonthPickerDefault();
    updateAllTimeStats(tenantArray);
    updateArchivedBadge();
    updateStatusBar();
    updateOccupancy();
    fetchAndDisplaySmsBalance();
    fetchAndDisplayEmailBalance();

    // ✅ Mark initial load complete so future calls don’t flash old cache
    initialLoadComplete = true;
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

// --- LAZY LOAD CHARTS ---
let chartsInitialized = false;

function ensureChartsVisible() {
  if (chartsInitialized) return;
  const chartSection = document.querySelector(".charts-wrapper");
  if (!chartSection) return;

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        updateCharts();
        chartsInitialized = true;
        observer.disconnect();
      }
    },
    { rootMargin: "200px" }
  );

  observer.observe(chartSection);

  // Fallback: if after 3 seconds the charts still aren't visible, draw them anyway
  setTimeout(() => {
    if (!chartsInitialized) {
      updateCharts();
      chartsInitialized = true;
    }
  }, 3000);
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
  const lastDay = new Date(year, month, 0).getDate(); // last day of the month
  const day = Math.min(dueDay, lastDay);
  // Return a YYYY‑MM‑DD string – always the correct Nairobi calendar day
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}
function getTenantNextDueDate(tenant) {
  const today = getAppToday();
  // Nairobi‑local date string for today
  const todayStr = today.toLocaleDateString("en-CA", {
    timeZone: "Africa/Nairobi",
  });

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
    const dueStr = dueDate.toLocaleDateString("en-CA", {
      timeZone: "Africa/Nairobi",
    });

    if (dueStr >= todayStr) return dueStr;
  }

  // Fallback – use current billing month’s due date
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
  if (!tenant.paymentHistory || !Array.isArray(tenant.paymentHistory)) return 0;
  const todayStr = todayDate.toLocaleDateString("en-CA", {
    timeZone: "Africa/Nairobi",
  });

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
    if (!latest || !latest.dueDate) continue;

    // Check for initialPastDue flag
    const chargeEntry = entries.find(
      (e) => (e.amountPaid || 0) === 0 && !e.datePaid
    );
    const isFirstMonthWithFlag =
      chargeEntry &&
      chargeEntry.initialPastDue &&
      chargeEntry.remainingBalance > 0;

    const dueDate = new Date(latest.dueDate);
    const dueStr = dueDate.toLocaleDateString("en-CA", {
      timeZone: "Africa/Nairobi",
    });

    // Stop at the current billing month unless forced by initialPastDue
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
    headerHtml += `<h2 class="tenant-col-house">HS</h2>`;
    headerHtml += `<h2 class="tenant-col-name">Name</h2>`;
    headerHtml += `<h2 class="tenant-col-rent">Rent</h2>`;
    headerHtml += `<h2 class="tenant-col-bal">Balance</h2>`;
    headerHtml += `<h2 class="tenant-col-entry">Entry</h2>`;
    headerHtml += `<h2 class="tenant-col-due">Due</h2>`;
    headerHtml += `<h2 class="tenant-col-actions"></h2></div>`;
    tenantInfoDiv.innerHTML = headerHtml;

    filteredList.forEach((tenant) => {
      let rowDiv = renderTenant(tenant);
      tenantInfoDiv.appendChild(rowDiv);
    });

    updateStats(tenantArray);
    if (filteredList.length === 0) {
      // Also update the empty state header to match
      tenantInfoDiv.innerHTML = `
    <div class="tenant-info">
      <h2 class="tenant-col-house">HS</h2>
      <h2 class="tenant-col-name">Name</h2>
      <h2 class="tenant-col-rent">Rent</h2>
      <h2 class="tenant-col-bal">Balance</h2>
      <h2 class="tenant-col-entry">Entry</h2>
      <h2 class="tenant-col-due">Due</h2>
      <h2 class="tenant-col-actions"></h2>
    </div>
  `;
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
  closeDropdownIfOpen();
  pushModalState();
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

async function saveExtraChargesForMonth(tenantId, entryId, month) {
  const section = document.querySelector(
    `.extra-charges-section[data-entry-id="${entryId}"]`
  );
  if (!section) return;

  const list = section.querySelector(".extra-charges-list");
  if (!list) return;

  const lines = list.querySelectorAll(".extra-charge-line");
  const charges = [];
  lines.forEach((line) => {
    const text = line.querySelector(".extra-text").textContent;
    const amountMatch = text.match(/[\d,]+/);
    const amount = amountMatch ? parseInt(amountMatch[0].replace(/,/g, "")) : 0;
    const descMatch = text.match(/\(([^)]+)\)/);
    const description = descMatch ? descMatch[1] : "";
    charges.push({ amount, description });
  });

  lastModalOpenTime = Date.now();

  try {
    const response = await fetchWithTimeout(
      window.location.origin +
        `/tenants/${tenantId}/payment-history/${entryId}/extra-charge`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ extraCharges: charges }),
      }
    );
    const data = await response.json();
    console.log("📥 Server response:", data);
    if (!data.success) throw new Error(data.message || "Failed to save");

    // Update local tenant data
    const t = tenantArray.find((t) => t._id === tenantId);
    if (t && data.paymentHistory) {
      t.paymentHistory = data.paymentHistory;
      // Refresh main tenant list so balance/overdue updates immediately
      applyFiltersAndSort();
      updateStats(tenantArray);
      scheduleChartUpdate();
    } else {
      console.warn(
        "⚠️ Could not update tenantArray – tenant not found or missing paymentHistory in response"
      );
    }

    // Force re-render
    lastModalOpenTime = Date.now();
    console.log("🔄 Re-rendering payment modal...");
    renderPaymentModal(tenantId);

    originalSwalFire.call(Swal, {
      toast: true,
      position: "bottom-end",
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true,
      background: "#1e293b",
      color: "#f1f5f9",
      icon: "success",
      title: "Extra charges saved",
    });
  } catch (err) {
    console.error("❌ Save error:", err);
    originalSwalFire.call(Swal, {
      toast: true,
      position: "bottom-end",
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
      background: "#1e293b",
      color: "#f1f5f9",
      icon: "error",
      title: err.message,
    });
  }
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
      /* ----- existing styles (unchanged) ----- */
      .payment-compact-table { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0 6px; background: transparent; word-break: break-word; }
      .payment-compact-table thead th { text-align: center; padding: 12px 8px; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.4px; color: #94a3b8; border-bottom: 2px solid #334155; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .payment-row-main { cursor: pointer; transition: background 0.15s; background: #1e293b; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.25); }
      .payment-row-main:hover { background: #273548; }
      .payment-row-main td { padding: 14px 8px; text-align: center; font-size: 1rem; font-weight: 500; vertical-align: middle; border: none; overflow-wrap: break-word; }
      .payment-row-main td:first-child { border-radius: 12px 0 0 12px; font-weight: 700; }
      .payment-row-main td:last-child { border-radius: 0 12px 12px 0; }
      .amount-paid { color: #4ade80; font-weight: 700; }
      .amount-zero { color: #64748b; }
      .status-fully-paid { color: #4ade80; font-weight: 700; }
      .status-unpaid { color: #f87171; font-weight: 700; }
      .status-overpaid { color: #60a5fa; font-weight: 700; }
      .balance-positive { color: #f87171; font-weight: 700; }
      .balance-zero { color: #4ade80; font-weight: 700; }
      .balance-negative { color: #c084fc; font-weight: 700; }
      .left-net { font-weight: 700; display: block; }
      .left-credit-tag { font-size: 0.7rem; color: #38bdf8; margin-top: 2px; display: block; }
      .expand-arrow { display: inline-block; transition: transform 0.2s; font-size: 1.3rem; color: #94a3b8; }
      .credit-transfer-row td { padding: 4px 0; text-align: center; font-size: 0.75rem; color: #38bdf8; background: transparent; font-weight: 500; border: none; opacity: 0.85; }
      .payment-row-detail td { padding: 0; background: #0f172a; border-radius: 0 0 12px 12px; border-bottom: 2px solid #334155; word-break: break-word; overflow-x: hidden; }
      .detail-content { padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; color: #cbd5e1; font-size: 0.9rem; }
      .charge-line { color: #f1f5f9; font-weight: 600; font-size: 0.95rem; background: #1e293b; padding: 8px 12px; border-radius: 8px; }
      .credit-note { color: #38bdf8; font-weight: 500; font-size: 0.85rem; background: #38bdf815; padding: 4px 10px; border-radius: 20px; display: inline-block; }
      .payment-detail-line { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 12px; background: #1e293b; border-radius: 8px; font-size: 0.85rem; }
      .payment-detail-line span:first-child { font-weight: 600; color: #f1f5f9; }
      .payment-detail-line span.mp { color: #38bdf8; font-weight: 500; }
      .payment-detail-line span.balance { font-weight: 600; }
      .payment-history-wrapper, .payment-history-scroll, #payment-history-list { max-height: none !important; overflow-y: visible !important; }
      @media (max-width: 500px) { .payment-row-main td { font-size: 0.85rem; padding: 12px 4px; } .detail-content { padding: 12px 10px; } }

      /* ---------- Extra charges ---------- */
      .extra-charge-line { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 12px; background: #1e293b; border-radius: 8px; font-size: 0.85rem; border-left: 3px solid #fbbf24; }
      .extra-charge-line .extra-text { font-weight: 600; color: #fbbf24; }
      .extra-charge-line button { background: none; border: none; cursor: pointer; font-size: 1rem; padding: 2px 6px; }
      .extra-edit-btn { color: var(--accent-cyan); }
      .extra-delete-btn { color: var(--danger); }
      .extra-charge-edit-form { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #1e293b; padding: 6px 10px; border-radius: 8px; }
      .extra-charge-edit-form input { padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-deep); color: var(--text-primary); }
      .save-extra-btn { background: var(--success); color: white; border: none; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-weight: 600; }
      .cancel-extra-btn { background: var(--text-muted); color: white; border: none; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-weight: 600; }
      .add-extra-btn { background: var(--accent-blue); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: 600; align-self: flex-start; margin-top: 4px; }
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

  const monthsOrder = [...uniqueMonths].reverse();

  // Helper: compute leftByMonth from a given paymentHistory array
  function recomputeLeftByMonth(paymentHistory) {
    const map = new Map();
    let prevCum = 0;
    for (const month of monthsOrder) {
      const ce = paymentHistory.find(
        (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
      );
      if (!ce) continue;
      const cum = ce.remainingBalance;
      map.set(month, Math.max(0, cum) - Math.max(0, prevCum));
      prevCum = cum;
    }
    return map;
  }

  let leftByMonth = recomputeLeftByMonth(tenant.paymentHistory);

  // Helper: charge breakdown – shows core charges only (extra charges listed separately)
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
        (chargeEntry.garbageCharge || 0) +
        (chargeEntry.extraCharges || []).reduce((s, c) => s + c.amount, 0) ||
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

    // Left cell
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

    // Balance column
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
            <!-- Extra charges as individual lines -->
            <div class="extra-charges-section" data-entry-id="${
              chargeEntry._id
            }" data-month="${month}">
              <div class="extra-charges-list">
                ${(chargeEntry.extraCharges || [])
                  .map(
                    (ec, idx) => `
                  <div class="extra-charge-line" data-index="${idx}">
                    <span class="extra-text">Extra: KES ${ec.amount.toLocaleString()}${
                      ec.description ? ` (${escapeHtml(ec.description)})` : ""
                    }</span>
                    <div>
                      <button class="extra-edit-btn" title="Edit">✎</button>
                      <button class="extra-delete-btn" title="Delete">🗑️</button>
                    </div>
                  </div>
                `
                  )
                  .join("")}
              </div>
              <button class="add-extra-btn">+ Add extra charge</button>
            </div>
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

  // ---------- Extra charges management (single delegated listener) ----------
  const paymentList = document.getElementById("payment-history-list");

  // Remove old listener (if any) to prevent duplicates
  if (paymentList._extraChargeHandler) {
    paymentList.removeEventListener("click", paymentList._extraChargeHandler);
  }

  const extraChargeHandler = async (e) => {
    const btn = e.target;

    // "Add extra charge" button
    if (btn.classList.contains("add-extra-btn")) {
      e.stopPropagation();
      const section = btn.closest(".extra-charges-section");
      if (!section) return;
      const list = section.querySelector(".extra-charges-list");
      const editRow = document.createElement("div");
      editRow.className = "extra-charge-edit-form";
      editRow.innerHTML = `
        <input type="number" step="any" class="edit-amount" placeholder="Amount">
        <input type="text" class="edit-desc" placeholder="Description">
        <button class="save-extra-btn">Save</button>
        <button class="cancel-extra-btn">Cancel</button>
      `;
      list.appendChild(editRow);
      return;
    }

    // "Save" button inside add/edit form
    if (btn.classList.contains("save-extra-btn")) {
      e.stopPropagation();
      const section = btn.closest(".extra-charges-section");
      const entryId = section.dataset.entryId;
      const month = section.dataset.month;
      const editRow = btn.closest(".extra-charge-edit-form");
      const amountInput = editRow.querySelector(".edit-amount");
      const descInput = editRow.querySelector(".edit-desc");
      const amount = parseFloat(amountInput.value) || 0;
      const description = descInput.value.trim();

      if (amount === 0) {
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 2000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: "Amount must be greater than 0",
        });
        return;
      }

      // Replace the edit form with the new line
      const newLine = document.createElement("div");
      newLine.className = "extra-charge-line";
      newLine.innerHTML = `
        <span class="extra-text">Extra: KES ${amount.toLocaleString()}${
        description ? ` (${escapeHtml(description)})` : ""
      }</span>
        <div>
          <button class="extra-edit-btn" title="Edit">✎</button>
          <button class="extra-delete-btn" title="Delete">🗑️</button>
        </div>
      `;
      editRow.replaceWith(newLine);
      lastModalOpenTime = Date.now();
      saveExtraChargesForMonth(window.currentActionsTenantId, entryId, month);
      return;
    }

    // "Cancel" button inside add/edit form
    if (btn.classList.contains("cancel-extra-btn")) {
      e.stopPropagation();
      const editRow = btn.closest(".extra-charge-edit-form");
      if (editRow) editRow.remove();
      return;
    }

    // "Delete" extra charge line
    if (btn.classList.contains("extra-delete-btn")) {
      e.stopPropagation();
      const line = btn.closest(".extra-charge-line");
      if (!line) return;
      const section = btn.closest(".extra-charges-section");
      const entryId = section.dataset.entryId;
      const month = section.dataset.month;

      const confirmResult = await originalSwalFire.call(Swal, {
        title: "Delete extra charge?",
        text: "This action cannot be undone.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#ef4444",
        cancelButtonColor: "#6b7280",
        confirmButtonText: "Yes, delete",
        background: "#1e293b",
        color: "#f1f5f9",
      });
      if (!confirmResult.isConfirmed) return;

      line.remove();
      lastModalOpenTime = Date.now();
      saveExtraChargesForMonth(window.currentActionsTenantId, entryId, month);
      return;
    }

    // "Edit" extra charge line
    if (btn.classList.contains("extra-edit-btn")) {
      e.stopPropagation();
      const line = btn.closest(".extra-charge-line");
      if (!line) return;
      const textSpan = line.querySelector(".extra-text");
      const currentText = textSpan.textContent;
      const amountMatch = currentText.match(/[\d,]+/);
      const currentAmount = amountMatch
        ? parseInt(amountMatch[0].replace(/,/g, ""))
        : 0;
      const descMatch = currentText.match(/\(([^)]+)\)/);
      const currentDesc = descMatch ? descMatch[1] : "";

      const editForm = document.createElement("div");
      editForm.className = "extra-charge-edit-form";
      editForm.innerHTML = `
        <input type="number" step="any" class="edit-amount" value="${currentAmount}">
        <input type="text" class="edit-desc" value="${escapeHtml(currentDesc)}">
        <button class="save-extra-btn">Save</button>
        <button class="cancel-extra-btn">Cancel</button>
      `;
      line.replaceWith(editForm);
      return;
    }
  };

  paymentList.addEventListener("click", extraChargeHandler);
  paymentList._extraChargeHandler = extraChargeHandler;
}
// ─────────────────────────────────────────────────────

// ----- UTILITIES MODAL (Meter Reading) -----
async function showUtilitiesModal(tenantId) {
  closeDropdownIfOpen();
  pushModalState();
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
        <div class="utility-row">
          <label>Month:</label>
          <select id="reading-month" style="padding:8px; border-radius:8px; background:var(--bg-surface); color:var(--text-primary); border:1px solid var(--border); flex:1;">
            ${(() => {
              // Get months that have a charge entry (amountPaid=0, no datePaid)
              const monthsWithCharges = (tenant.paymentHistory || [])
                .filter((e) => (e.amountPaid || 0) === 0 && !e.datePaid)
                .map((e) => e.month)
                .sort();
              // Ensure currentMonth is included even if not yet charged
              if (!monthsWithCharges.includes(currentMonth)) {
                monthsWithCharges.push(currentMonth);
                monthsWithCharges.sort();
              }
              return monthsWithCharges
                .map(
                  (m) =>
                    `<option value="${m}" ${
                      m === currentMonth ? "selected" : ""
                    }>${m}</option>`
                )
                .join("");
            })()}
          </select>
        </div>
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
      const storedUnits = reading.unitsUsed;
      const storedCost = reading.cost;

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

    const overrideInput = document.getElementById("override-previous-input");
    if (overrideInput && overrideInput.value) {
      prevRead = parseFloat(overrideInput.value) || 0;
    }

    const current = parseFloat(readingInput.value) || 0;
    let units = current - prevRead;

    const exemptInput = document.getElementById("exempt-units");
    if (exemptInput && exemptInput.value) {
      units = Math.max(0, units - (parseFloat(exemptInput.value) || 0));
    }

    unitsSpan.textContent = units > 0 ? units : 0;
    costSpan.textContent = (units > 0 ? units * waterRate : 0).toFixed(2);
    prevDisplay.textContent = prevRead;
  }

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
  if (overrideInput) overrideInput.addEventListener("input", updateCalc);
  const exemptInput = document.getElementById("exempt-units");
  if (exemptInput) exemptInput.addEventListener("input", updateCalc);

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

    const readingObj = (tenant.waterMeterReadings || []).find(
      (r) => r._id.toString() === id
    );
    const currentOverride = readingObj?.previousOverride ?? "";
    const currentExempt = readingObj?.exemptUnits ?? 0;
    lastModalOpenTime = Date.now();
    const result = await originalSwalFire.call(Swal, {
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
      lastModalOpenTime = Date.now();
      const { value: formValues } = await originalSwalFire.call(Swal, {
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
            const updatedTenant = await response.json();
            const idx = tenantArray.findIndex((t) => t._id === tid);
            if (idx !== -1) {
              tenantArray[idx] = updatedTenant;
              applyFiltersAndSort();
              updateStats(tenantArray);
              scheduleChartUpdate();
              sessionStorage.setItem(
                "cachedTenants",
                JSON.stringify(tenantArray)
              );
            }
            const paymentModal = document.getElementById("payment-modal");
            if (paymentModal && paymentModal.style.display === "block") {
              renderPaymentModal(window.currentActionsTenantId);
            }
            showUtilitiesModal(tid);
            originalSwalFire.call(Swal, {
              toast: true,
              position: "bottom-end",
              showConfirmButton: false,
              timer: 2000,
              timerProgressBar: true,
              background: "#1e293b",
              color: "#f1f5f9",
              icon: "success",
              title: "Reading updated",
            });
          } else {
            originalSwalFire.call(Swal, {
              toast: true,
              position: "bottom-end",
              showConfirmButton: false,
              timer: 3000,
              timerProgressBar: true,
              background: "#1e293b",
              color: "#f1f5f9",
              icon: "error",
              title: "Update failed",
            });
          }
        } catch (err) {
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "error",
            title: err.message,
          });
        } finally {
          setButtonLoading(btn, false);
        }
      }
    } else if (result.isDenied) {
      // Delete
      lastModalOpenTime = Date.now();
      const confirm = await originalSwalFire.call(Swal, {
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
            const updatedTenant = await response.json();
            const idx = tenantArray.findIndex((t) => t._id === tid);
            if (idx !== -1) {
              tenantArray[idx] = updatedTenant;
              applyFiltersAndSort();
              updateStats(tenantArray);
              scheduleChartUpdate();
              sessionStorage.setItem(
                "cachedTenants",
                JSON.stringify(tenantArray)
              );
            }
            const paymentModal = document.getElementById("payment-modal");
            if (paymentModal && paymentModal.style.display === "block") {
              renderPaymentModal(window.currentActionsTenantId);
            }
            showUtilitiesModal(tid);
            originalSwalFire.call(Swal, {
              toast: true,
              position: "bottom-end",
              showConfirmButton: false,
              timer: 2000,
              timerProgressBar: true,
              background: "#1e293b",
              color: "#f1f5f9",
              icon: "success",
              title: "Reading deleted",
            });
          } else {
            originalSwalFire.call(Swal, {
              toast: true,
              position: "bottom-end",
              showConfirmButton: false,
              timer: 3000,
              timerProgressBar: true,
              background: "#1e293b",
              color: "#f1f5f9",
              icon: "error",
              title: "Delete failed",
            });
          }
        } catch (err) {
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "error",
            title: err.message,
          });
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
  closeDropdownIfOpen();
  pushModalState();

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

      <!-- SMS auto reminders checkbox -->
      <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; margin: 16px 0;">
        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
          <input type="checkbox" id="global-auto-reminders" style="width: 28px; height: 28px; transform: scale(1.1); accent-color: #10b981;" ${
            globalSettings.autoRemindersEnabled !== false ? "checked" : ""
          }>
          <span style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary);">Send automatic overdue SMS reminders</span>
        </label>
        <span style="font-size: 0.8rem; color: var(--text-muted); text-align: center;">Daily at 1:00 AM (costs ~KES 0.80 per message)</span>
      </div>

      <!-- Email auto reminders checkbox -->
      <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; margin: 16px 0;">
        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
          <input type="checkbox" id="global-auto-email-reminders" style="width: 28px; height: 28px; transform: scale(1.1); accent-color: #10b981;" ${
            globalSettings.autoEmailRemindersEnabled !== false ? "checked" : ""
          }>
          <span style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary);">Send automatic overdue email reminders</span>
        </label>
        <span style="font-size: 0.8rem; color: var(--text-muted); text-align: center;">Daily at 1:00 AM (tenants with email)</span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 6px;">
        <button id="resend-overdue-reminders-btn" class="modal-action-btn" style="background: #f59e0b;">📢 Resend Overdue SMS Reminders Now</button>
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
      <button id="remove-all-garbage-btn" class="modal-action-btn" style="background: #ef4444;">🗑️ Remove Garbage Fee (All Months)</button>
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

  // ---------- SMS auto reminders checkbox ----------
  const smsCheckbox = document.getElementById("global-auto-reminders");
  if (smsCheckbox) {
    smsCheckbox.addEventListener("change", async (e) => {
      const isChecked = e.target.checked;

      lastModalOpenTime = Date.now();
      const confirmResult = await originalSwalFire.call(Swal, {
        title: isChecked
          ? "Enable SMS auto‑reminders?"
          : "Disable SMS auto‑reminders?",
        text: isChecked
          ? "Daily SMS reminders will be sent at 1:00 AM for overdue tenants."
          : "Automatic SMS reminders will stop.",
        icon: "question",
        showCancelButton: true,
        confirmButtonColor: "#10b981",
        cancelButtonColor: "#ef4444",
        confirmButtonText: isChecked ? "Yes, enable" : "Yes, disable",
        background: "#1e293b",
        color: "#f1f5f9",
      });
      if (!confirmResult.isConfirmed) {
        e.target.checked = !isChecked;
        return;
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
        const emailChecked = document.getElementById(
          "global-auto-email-reminders"
        ).checked;

        const ok = await updateGlobalSettingsOnServer(
          garbageFee,
          waterRatePerUnit,
          defaultDueDay,
          totalHouses,
          isChecked,
          emailChecked
        );
        if (ok) {
          sessionStorage.removeItem("globalSettings");
          await fetchGlobalSettings();
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "success",
            title: `SMS auto‑reminders ${isChecked ? "enabled" : "disabled"}`,
          });
        } else {
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "error",
            title: "Failed to save setting",
          });
          e.target.checked = !isChecked;
        }
      } catch (err) {
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 2000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: err.message,
        });
        e.target.checked = !isChecked;
      } finally {
        setButtonLoading(e.target, false);
      }
    });
  }

  // ---------- Email auto reminders checkbox ----------
  const emailCheckbox = document.getElementById("global-auto-email-reminders");
  if (emailCheckbox) {
    emailCheckbox.addEventListener("change", async (e) => {
      const isChecked = e.target.checked;
      lastModalOpenTime = Date.now();
      const confirmResult = await originalSwalFire.call(Swal, {
        title: isChecked
          ? "Enable email auto‑reminders?"
          : "Disable email auto‑reminders?",
        text: isChecked
          ? "Daily email reminders will be sent at 1:00 AM for overdue tenants who have email addresses."
          : "Automatic email reminders will stop.",
        icon: "question",
        showCancelButton: true,
        confirmButtonColor: "#10b981",
        cancelButtonColor: "#ef4444",
        confirmButtonText: isChecked ? "Yes, enable" : "Yes, disable",
        background: "#1e293b",
        color: "#f1f5f9",
      });
      if (!confirmResult.isConfirmed) {
        e.target.checked = !isChecked;
        return;
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
        const smsChecked = document.getElementById(
          "global-auto-reminders"
        ).checked;

        const ok = await updateGlobalSettingsOnServer(
          garbageFee,
          waterRatePerUnit,
          defaultDueDay,
          totalHouses,
          smsChecked,
          isChecked
        );
        if (ok) {
          sessionStorage.removeItem("globalSettings");
          await fetchGlobalSettings();
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "success",
            title: `Email auto‑reminders ${isChecked ? "enabled" : "disabled"}`,
          });
        } else {
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "error",
            title: "Failed to save setting",
          });
          e.target.checked = !isChecked;
        }
      } catch (err) {
        Toast.fire({ icon: "error", title: err.message });
        e.target.checked = !isChecked;
      } finally {
        setButtonLoading(e.target, false);
      }
    });
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
            sessionStorage.removeItem("globalSettings");
            await fetchGlobalSettings();
            await loadTenants();
            scheduleChartUpdate();
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

    if (e.target.id === "remove-all-garbage-btn") {
      const btn = e.target;

      const confirmResult = await originalSwalFire.call(Swal, {
        title: "Remove ALL Garbage Fees?",
        html: `
        <div style="text-align:center;">
          <p style="font-size:1rem; color:#f1f5f9;">This will <strong style="color:#ef4444;">permanently delete</strong> every garbage charge from all billing months for all active tenants.</p>
          <p style="font-size:0.9rem; color:#94a3b8;">This action cannot be undone. Future months will still apply the global garbage fee unless you set it to 0.</p>
        </div>
        `,
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#ef4444",
        confirmButtonText: "Yes, delete all garbage fees",
        cancelButtonText: "Cancel",
        background: "#1e293b",
        color: "#f1f5f9",
      });

      if (!confirmResult.isConfirmed) return;

      setButtonLoading(btn, true);
      try {
        const res = await fetchWithTimeout(
          window.location.origin + "/tenants/remove-all-garbage",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }
        );
        const data = await res.json();
        if (res.ok) {
          await loadTenants();
          scheduleChartUpdate();
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "success",
            title: `Garbage fee removed for ${data.updated} tenant(s).`,
          });
        } else {
          Toast.fire({ icon: "error", title: data.message || "Failed" });
        }
      } catch (err) {
        Toast.fire({ icon: "error", title: err.message });
      } finally {
        setButtonLoading(btn, false);
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
            scheduleChartUpdate();
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
        let countUrl = window.location.origin + "/tenants/overdue-count";
        if (currentDevDate) countUrl += `?devDate=${currentDevDate}`;
        const countRes = await fetchWithTimeout(countUrl, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });
        const countData = await countRes.json();
        const overdueCount = countData.count || 0;

        if (overdueCount === 0) {
          Toast.fire({ icon: "info", title: "No overdue tenants with email." });
          setButtonLoading(btn, false);
          return;
        }

        const confirm = await Swal.fire({
          title: "📧 Resend Overdue Emails",
          html: `
            <div style="text-align: center;">
              <div style="font-size: 1.1rem; margin-bottom: 16px;">Send email reminders to <strong>${overdueCount}</strong> tenant(s)?</div>
              <div style="font-size: 0.85rem; color: var(--text-muted);">Emails will be sent to overdue tenants who have an email address.</div>
            </div>
          `,
          icon: "question",
          showCancelButton: true,
          confirmButtonColor: "#f59e0b",
          cancelButtonColor: "#ef4444",
          confirmButtonText: `Yes, send`,
          background: "#1e293b",
          color: "#f1f5f9",
        });

        if (!confirm.isConfirmed) {
          setButtonLoading(btn, false);
          return;
        }

        let url =
          window.location.origin +
          "/tenants/trigger-email-reminders?force=true";
        if (currentDevDate) url += `&devDate=${currentDevDate}`;

        const response = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          },
          120000
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
      const autoEmailRemindersEnabled = document.getElementById(
        "global-auto-email-reminders"
      ).checked;

      try {
        const ok = await updateGlobalSettingsOnServer(
          garbageFee,
          waterRatePerUnit,
          defaultDueDay,
          totalHouses,
          autoRemindersEnabled,
          autoEmailRemindersEnabled
        );
        if (ok) {
          // 🔥 Clear the cache so fetchGlobalSettings gets fresh data
          sessionStorage.removeItem("globalSettings");
          await fetchGlobalSettings();
          await loadTenants();
          scheduleChartUpdate();
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "success",
            title: "Settings updated",
          });
          document.getElementById("global-garbage").value =
            globalSettings.garbageFee || 0;
          document.getElementById("global-waterrate").value =
            globalSettings.waterRatePerUnit || 0;
          document.getElementById("global-default-due-day").value =
            globalSettings.defaultDueDay || 1;
        } else {
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "error",
            title: "Update failed",
          });
        }
      } catch (err) {
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 2000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: err.message || "Update failed",
        });
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
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
        icon: "warning",
        title: "Water rate not set",
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

    const overrideInput = document.getElementById("override-previous-input");
    const overrideVal = overrideInput?.value;
    const effectivePrevious = overrideVal ? Number(overrideVal) : prevReading;

    if (reading < effectivePrevious) {
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
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
        const updatedTenant = await resp.json();
        const idx = tenantArray.findIndex((t) => t._id === tenantId);
        if (idx !== -1) {
          tenantArray[idx] = updatedTenant;
          applyFiltersAndSort();
          updateStats(tenantArray);
          scheduleChartUpdate();
          sessionStorage.setItem("cachedTenants", JSON.stringify(tenantArray));
        }
        const paymentModal = document.getElementById("payment-modal");
        if (paymentModal && paymentModal.style.display === "block") {
          renderPaymentModal(window.currentActionsTenantId);
        }
        showUtilitiesModal(window.currentActionsTenantId);
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 2000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "success",
          title: "Meter reading saved",
        });
      }
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
        icon: "success",
        title: "Meter reading saved",
      });
    } catch (err) {
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
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

    lastModalOpenTime = Date.now();
    const result = await originalSwalFire.call(Swal, {
      title: "Archive Tenant?",
      text: "The tenant will be hidden from the main list. You can restore them later.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#f59e0b",
      confirmButtonText: "Yes, archive",
      background: "#1e293b",
      color: "#f1f5f9",
    });

    if (!result.isConfirmed) return;

    setButtonLoading(e.target, true);
    try {
      let response = await fetchWithTimeout(
        window.location.origin + `/tenants/${id}/archive`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );
      if (response.ok) {
        // 🔥 Remove the tenant from the active list immediately
        if (!showArchived) {
          tenantArray = tenantArray.filter((t) => t._id !== id);
          sessionStorage.setItem("cachedTenants", JSON.stringify(tenantArray));
        } else {
          // If we somehow are viewing archived list, mark active false
          const idx = tenantArray.findIndex((t) => t._id === id);
          if (idx !== -1) tenantArray[idx].active = false;
        }

        applyFiltersAndSort();
        updateStats(tenantArray);
        scheduleChartUpdate();

        document.getElementById("tenant-actions-modal").style.display = "none";
        document.getElementById("modal-overlay").style.display = "none";
        document.body.classList.remove("modal-open");

        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 2000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "success",
          title: "Tenant Archived",
        });
      } else {
        const data = await response.json();
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: data.message || "Archive failed",
        });
      }
    } catch (err) {
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
        icon: "error",
        title: err.message,
      });
    } finally {
      setButtonLoading(e.target, false);
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
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
        icon: "warning",
        title: "Invalid Amount",
      });
      return;
    }

    // Use originalSwalFire so no history entry is pushed
    lastModalOpenTime = Date.now();
    const confirm = await originalSwalFire.call(Swal, {
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
        const data = await response.json();
        const tenantIndex = tenantArray.findIndex((t) => t._id === tenantId);
        if (tenantIndex !== -1) {
          tenantArray[tenantIndex].paymentHistory = data.paymentHistory;
          applyFiltersAndSort();
          updateStats(tenantArray);
          scheduleChartUpdate();
          sessionStorage.setItem("cachedTenants", JSON.stringify(tenantArray));
        }
        renderPaymentModal(tenantId);
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 2000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "success",
          title: "Payment Recorded",
        });
      } else {
        const error = await response.json();
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: error.message || "Payment failed",
        });
      }
    } catch (err) {
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
        icon: "error",
        title: err.message,
      });
    } finally {
      setButtonLoading(btn, false);
    }
  }

  if (e.target.classList.contains("ref-btn")) {
    const ref = e.target.dataset.ref;
    if (ref && ref.trim() !== "") {
      lastModalOpenTime = Date.now();
      originalSwalFire.call(Swal, {
        title: "M‑Pesa Reference",
        text: ref,
        icon: "info",
        confirmButtonColor: "#3b82f6",
        background: "#1e293b",
        color: "#f1f5f9",
      });
    } else {
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
        icon: "info",
        title: "No M‑Pesa Reference",
      });
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

    // Action selection popup – safe
    lastModalOpenTime = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const action = await originalSwalFire.call(Swal, {
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
            lastModalOpenTime = Date.now();
            originalSwalFire.call(Swal, {
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
      // ---- Edit ----
      lastModalOpenTime = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const { value: formValues } = await originalSwalFire.call(Swal, {
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
            const data = await response.json();
            const tenantIndex = tenantArray.findIndex(
              (t) => t._id === tenantId
            );
            if (tenantIndex !== -1) {
              tenantArray[tenantIndex].paymentHistory = data.paymentHistory;
              applyFiltersAndSort();
              updateStats(tenantArray);
              scheduleChartUpdate();
              sessionStorage.setItem(
                "cachedTenants",
                JSON.stringify(tenantArray)
              );
            }
            renderPaymentModal(tenantId);
            originalSwalFire.call(Swal, {
              toast: true,
              position: "bottom-end",
              showConfirmButton: false,
              timer: 2000,
              timerProgressBar: true,
              background: "#1e293b",
              color: "#f1f5f9",
              icon: "success",
              title: "Payment Updated",
            });
          } else {
            const err = await response.json();
            originalSwalFire.call(Swal, {
              toast: true,
              position: "bottom-end",
              showConfirmButton: false,
              timer: 3000,
              timerProgressBar: true,
              background: "#1e293b",
              color: "#f1f5f9",
              icon: "error",
              title: err.message || "Update failed",
            });
          }
        } catch (err) {
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "error",
            title: err.message,
          });
        } finally {
          setButtonLoading(btn, false);
        }
      }
    } else if (action.isDenied) {
      // ---- Delete ----

      lastModalOpenTime = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const confirmDelete = await originalSwalFire.call(Swal, {
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
            const data = await response.json();
            const tenantIndex = tenantArray.findIndex(
              (t) => t._id === tenantId
            );
            if (tenantIndex !== -1) {
              tenantArray[tenantIndex].paymentHistory = data.paymentHistory;
              applyFiltersAndSort();
              updateStats(tenantArray);
              scheduleChartUpdate();
              sessionStorage.setItem(
                "cachedTenants",
                JSON.stringify(tenantArray)
              );
            }
            renderPaymentModal(tenantId);
            originalSwalFire.call(Swal, {
              toast: true,
              position: "bottom-end",
              showConfirmButton: false,
              timer: 2000,
              timerProgressBar: true,
              background: "#1e293b",
              color: "#f1f5f9",
              icon: "success",
              title: "Payment Deleted",
            });
          } else {
            const err = await response.json();
            originalSwalFire.call(Swal, {
              toast: true,
              position: "bottom-end",
              showConfirmButton: false,
              timer: 3000,
              timerProgressBar: true,
              background: "#1e293b",
              color: "#f1f5f9",
              icon: "error",
              title: err.message || "Delete failed",
            });
          }
        } catch (err) {
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "error",
            title: err.message,
          });
        } finally {
          setButtonLoading(btn, false);
        }
      }
    }
  }
});

async function showAddTenantModal() {
  closeDropdownIfOpen();
  const todayStr = new Date().toISOString().split("T")[0];
  const settings = globalSettings;

  const html = `
    <div style="display: flex; flex-direction: column; gap: 18px;">
      <!-- Name -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="text-align: left; color: #cbd5e1; font-size: 0.85rem; font-weight: 500;">Tenant Name *</label>
        <input id="modal-tenant-name" class="swal2-input" placeholder="e.g. John Doe"
          style="margin:0; padding: 12px; border-radius: 10px; background: var(--bg-deep); border: 1px solid var(--border); color: var(--text-primary); font-size: 0.95rem;">
      </div>

      <!-- Rent & Phone -->
      <div style="display: flex; gap: 12px;">
        <div style="flex:1; display: flex; flex-direction: column; gap: 6px;">
          <label style="text-align: left; color: #cbd5e1; font-size: 0.85rem; font-weight: 500;">Rent (KSH) *</label>
          <input id="modal-rent-amount" type="number" step="any" class="swal2-input" placeholder="0.00"
            style="margin:0; padding: 12px; border-radius: 10px; background: var(--bg-deep); border: 1px solid var(--border); color: var(--text-primary); font-size: 0.95rem;">
        </div>
        <div style="flex:1; display: flex; flex-direction: column; gap: 6px;">
          <label style="text-align: left; color: #cbd5e1; font-size: 0.85rem; font-weight: 500;">Phone *</label>
          <input id="modal-phone" type="tel" class="swal2-input" placeholder="0712 345 678"
            style="margin:0; padding: 12px; border-radius: 10px; background: var(--bg-deep); border: 1px solid var(--border); color: var(--text-primary); font-size: 0.95rem;">
        </div>
      </div>

      <!-- House & Email -->
      <div style="display: flex; gap: 12px;">
        <div style="flex:1; display: flex; flex-direction: column; gap: 6px;">
          <label style="text-align: left; color: #cbd5e1; font-size: 0.85rem; font-weight: 500;">House *</label>
          <input id="modal-house" type="text" class="swal2-input" placeholder="e.g. Flat 2B"
            style="margin:0; padding: 12px; border-radius: 10px; background: var(--bg-deep); border: 1px solid var(--border); color: var(--text-primary); font-size: 0.95rem;">
        </div>
        <div style="flex:1; display: flex; flex-direction: column; gap: 6px;">
          <label style="text-align: left; color: #cbd5e1; font-size: 0.85rem; font-weight: 500;">Email (optional)</label>
          <input id="modal-email" type="email" class="swal2-input" placeholder="tenant@email.com"
            style="margin:0; padding: 12px; border-radius: 10px; background: var(--bg-deep); border: 1px solid var(--border); color: var(--text-primary); font-size: 0.95rem;">
        </div>
      </div>

      <!-- Entry Date & Due Day -->
      <div style="display: flex; gap: 12px;">
        <div style="flex:1; display: flex; flex-direction: column; gap: 6px;">
          <label style="text-align: left; color: #cbd5e1; font-size: 0.85rem; font-weight: 500;">Entry Date *</label>
          <input id="modal-entry-date" type="date" class="swal2-input" value="${todayStr}"
            style="margin:0; padding: 12px; border-radius: 10px; background: var(--bg-deep); border: 1px solid var(--border); color: var(--text-primary); font-size: 0.95rem;">
        </div>
        <div style="flex:1; display: flex; flex-direction: column; gap: 6px;">
          <label style="text-align: left; color: #cbd5e1; font-size: 0.85rem; font-weight: 500;">Due Day (1‑31)</label>
          <input id="modal-due-day" type="number" min="1" max="31" class="swal2-input" placeholder="e.g. 5"
            style="margin:0; padding: 12px; border-radius: 10px; background: var(--bg-deep); border: 1px solid var(--border); color: var(--text-primary); font-size: 0.95rem;">
        </div>
      </div>

      <!-- Notes -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="text-align: left; color: #cbd5e1; font-size: 0.85rem; font-weight: 500;">Notes (optional)</label>
        <textarea id="modal-notes" class="swal2-input" placeholder="Any extra info..."
          style="margin:0; padding: 12px; border-radius: 10px; background: var(--bg-deep); border: 1px solid var(--border); color: var(--text-primary); font-size: 0.95rem; resize: vertical; min-height: 70px;"></textarea>
      </div>

      <!-- New tenant checkbox -->
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="modal-new-tenant" checked style="width: 20px; height: 20px; accent-color: #10b981;">
        <span style="color: var(--text-primary); font-size: 0.9rem;">New tenant – rent due on entry</span>
      </label>

      <!-- Deposit checkbox -->
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="modal-include-deposit" style="width: 20px; height: 20px; accent-color: #f59e0b;">
        <span style="color: var(--text-primary); font-size: 0.9rem;">💰 Deposit</span>
      </label>

      <div id="modal-deposit-wrapper" style="display: none; flex-direction: column; gap: 6px;">
        <label style="text-align: left; color: #cbd5e1; font-size: 0.85rem; font-weight: 500;">Deposit Period (months)</label>
        <input id="modal-deposit-period" type="number" min="1" max="12" value="1" class="swal2-input"
          style="margin:0; padding: 12px; border-radius: 10px; background: var(--bg-deep); border: 1px solid var(--border); color: var(--text-primary); font-size: 0.95rem;">
      </div>
    </div>
  `;

  const { isConfirmed } = await Swal.fire({
    title: "🧑 Add Tenant",
    html,
    showCancelButton: true,
    confirmButtonText: "Add Tenant",
    confirmButtonColor: "#3b82f6",
    cancelButtonColor: "#ef4444",
    background: "#1e293b",
    color: "#f1f5f9",
    width: "650px",
    customClass: {
      popup: "premium-swal-popup",
      title: "premium-swal-title",
    },
    didOpen: () => {
      const depositCheck = document.getElementById("modal-include-deposit");
      const wrapper = document.getElementById("modal-deposit-wrapper");
      depositCheck.addEventListener("change", () => {
        wrapper.style.display = depositCheck.checked ? "flex" : "none";
      });
    },
    preConfirm: async () => {
      const name = document.getElementById("modal-tenant-name").value.trim();
      const rentStr = document.getElementById("modal-rent-amount").value.trim();
      const phone = document.getElementById("modal-phone").value.trim();
      const house = document.getElementById("modal-house").value.trim();
      const email = document.getElementById("modal-email").value.trim();
      const entryDate = document.getElementById("modal-entry-date").value;
      const dueDayVal = document.getElementById("modal-due-day").value.trim();
      const notes = document.getElementById("modal-notes").value.trim();
      const newTenant = document.getElementById("modal-new-tenant").checked;
      const includeDeposit = document.getElementById(
        "modal-include-deposit"
      ).checked;
      const depositPeriod = includeDeposit
        ? parseInt(document.getElementById("modal-deposit-period").value) || 1
        : 0;

      if (!name) {
        Swal.showValidationMessage("Name is required.");
        return false;
      }
      if (!rentStr || isNaN(Number(rentStr)) || Number(rentStr) <= 0) {
        Swal.showValidationMessage("Rent must be a positive number.");
        return false;
      }
      if (!phone) {
        Swal.showValidationMessage("Phone number is required.");
        return false;
      }
      if (!house) {
        Swal.showValidationMessage("House number is required.");
        return false;
      }
      if (!entryDate) {
        Swal.showValidationMessage("Entry date is required.");
        return false;
      }

      const phoneDigits = phone.replace(/\D/g, "");
      if (phoneDigits.length < 9 || phoneDigits.length > 12) {
        Swal.showValidationMessage("Phone number must have 9‑12 digits.");
        return false;
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        Swal.showValidationMessage("Enter a valid email address.");
        return false;
      }

      let finalDueDay = parseInt(dueDayVal);
      if (!finalDueDay || finalDueDay < 1 || finalDueDay > 31) {
        finalDueDay = settings.defaultDueDay || 1;
      }

      const rent = Number(rentStr);

      try {
        const response = await fetchWithTimeout("/tenants", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            name,
            rent,
            phoneNumber: phone,
            houseNumber: house,
            email,
            entryDate,
            dueDay: finalDueDay,
            notes,
            depositPeriod,
            newTenant,
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.message);
        }

        return true;
      } catch (err) {
        Swal.showValidationMessage(err.message);
        return false;
      }
    },
  });

  if (isConfirmed) {
    // 🔁 Reload the whole list from server – guarantees accurate data
    await loadTenants();
    scheduleChartUpdate();
    originalSwalFire.call(Swal, {
      toast: true,
      position: "bottom-end",
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true,
      background: "#1e293b",
      color: "#f1f5f9",
      icon: "success",
      title: "Tenant Added",
    });
  }
}

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
  if (result.isConfirmed) {
    sessionStorage.removeItem("cachedTenants"); // ← add this
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
  popModalState();
  document.getElementById("profile-modal").style.display = "none";
  document.getElementById("modal-overlay").style.display = "none";
  document.body.classList.remove("modal-open");
});
document.getElementById("close-tenant-modal").addEventListener("click", () => {
  popModalState();
  document.getElementById("tenant-actions-modal").style.display = "none";
  document.getElementById("modal-overlay").style.display = "none";
  document.body.classList.remove("modal-open");
});
document.getElementById("close-payment-modal").addEventListener("click", () => {
  popModalState();
  document.getElementById("payment-modal").style.display = "none";
  document.getElementById("modal-overlay").style.display = "none";
  document.body.classList.remove("modal-open");
});
document
  .getElementById("close-utilities-modal")
  .addEventListener("click", () => {
    popModalState();
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
          scheduleChartUpdate();
          document.getElementById("profile-modal").style.display = "none";
          document.body.classList.remove("modal-open");
          Toast.fire({ icon: "success", title: "Profile Updated" });
        } else {
          const err = await response.json();
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "error",
            title: err.message || "Update failed",
          });
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

async function showBulkAddTenantsModal() {
  closeDropdownIfOpen();
  const todayStr = new Date().toISOString().split("T")[0];
  const settings = globalSettings;
  let tenantCounter = 0;

  // ── Validation helpers ──
  function isValidPhone(phone) {
    const digits = phone.replace(/\D/g, "");
    return digits.length >= 9 && digits.length <= 12;
  }

  // Returns errors only if the row is NOT completely empty.
  function validateRow(rowElement) {
    const name = rowElement.querySelector(".bulk-name")?.value.trim() || "";
    const phone = rowElement.querySelector(".bulk-phone")?.value.trim() || "";
    const house = rowElement.querySelector(".bulk-house")?.value.trim() || "";
    const rent = parseFloat(rowElement.querySelector(".bulk-rent")?.value);
    const dueDay = parseInt(rowElement.querySelector(".bulk-due-day")?.value);
    const entryDate = rowElement.querySelector(".bulk-entry-date")?.value;

    // If EVERY field is empty/untouched, row is pristine – no errors.
    if (!name && !phone && !house && isNaN(rent) && !dueDay && !entryDate) {
      return [];
    }

    const errors = [];
    if (!name) errors.push("Name missing");
    if (!phone) errors.push("Phone missing");
    else if (!isValidPhone(phone)) errors.push("Phone must have 9‑12 digits");
    if (!house) errors.push("House missing");
    if (isNaN(rent) || rent <= 0) errors.push("Rent must be positive");
    if (!dueDay || dueDay < 1 || dueDay > 31)
      errors.push("Due day (1‑31) required");
    if (!entryDate) errors.push("Entry date required");

    return errors;
  }

  // Highlights the row only if it has errors (empty rows are left alone)
  function updateRowHighlight(rowElement) {
    const errors = validateRow(rowElement);
    const row = rowElement.closest("tr") || rowElement; // works for table rows and mobile cards

    // Remove old classes (we'll use a CSS class for the red border)
    row.classList.remove("bulk-row-error");

    if (errors.length > 0) {
      row.classList.add("bulk-row-error");
    }
  }

  // Helper to check and mark duplicates for a single row/card
  function attachDuplicateCheck(container) {
    const nameInput = container.querySelector(".bulk-name");
    const houseInput = container.querySelector(".bulk-house");
    const nameErrorEl = container.querySelector(".bulk-name-error");
    const houseErrorEl = container.querySelector(".bulk-house-error");

    function check() {
      const nameVal = nameInput?.value.trim().toLowerCase() || "";
      const houseVal = houseInput?.value.trim().toLowerCase() || "";

      let nameDup = false;
      let houseDup = false;

      if (nameVal) {
        nameDup = tenantArray.some((t) => t.name.toLowerCase() === nameVal);
      }
      if (houseVal) {
        houseDup = tenantArray.some(
          (t) => (t.houseNumber || "").toLowerCase() === houseVal
        );
      }

      if (nameInput) {
        if (nameDup) {
          nameInput.style.borderColor = "#ef4444";
          if (nameErrorEl)
            nameErrorEl.textContent = "This name is already taken";
        } else {
          nameInput.style.borderColor = "";
          if (nameErrorEl) nameErrorEl.textContent = "";
        }
      }

      if (houseInput) {
        if (houseDup) {
          houseInput.style.borderColor = "#ef4444";
          if (houseErrorEl)
            houseErrorEl.textContent = "This house number is already taken";
        } else {
          houseInput.style.borderColor = "";
          if (houseErrorEl) houseErrorEl.textContent = "";
        }
      }
    }

    nameInput?.addEventListener("input", check);
    houseInput?.addEventListener("input", check);
    check();
  }

  function addEmptyRow() {
    const isMobile = window.innerWidth <= 600;
    let rowElement;

    if (isMobile) {
      tenantCounter++;
      const container = document.getElementById("bulk-add-container");
      const card = document.createElement("div");
      card.className = "bulk-add-card";
      card.style.cssText = `
        background: var(--bg-elevated);
        border-radius: 14px;
        padding: 14px;
        margin-bottom: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        border: 1px solid var(--border);
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        position: relative;
      `;

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="text-align: center; font-weight: 700; color: var(--accent-cyan); font-size: 1rem; flex: 1;">
            👤 Tenant #${tenantCounter}
          </div>
          <button class="bulk-delete-btn" style="background:none; border:none; color:var(--danger); font-size:1.3rem; cursor:pointer; padding:0 4px;" title="Delete this tenant">🗑️</button>
        </div>

        <div style="display:flex; flex-direction:column; gap:4px;">
          <label style="color: var(--text-secondary); font-size: 0.8rem; font-weight:500;">Name *</label>
          <input type="text" class="bulk-name" placeholder="e.g. John Doe" style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); font-size:0.95rem;">
          <div class="bulk-name-error" style="font-size:0.7rem; color:#ef4444; min-height:14px;"></div>
        </div>

        <div style="display:flex; flex-direction:column; gap:4px;">
          <label style="color: var(--text-secondary); font-size: 0.8rem; font-weight:500;">Phone *</label>
          <input type="tel" class="bulk-phone" placeholder="0712 345 678" style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); font-size:0.95rem;">
        </div>

        <div style="display:flex; flex-direction:column; gap:4px;">
          <label style="color: var(--text-secondary); font-size: 0.8rem; font-weight:500;">House *</label>
          <input type="text" class="bulk-house" placeholder="e.g. Flat 2B" style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); font-size:0.95rem;">
          <div class="bulk-house-error" style="font-size:0.7rem; color:#ef4444; min-height:14px;"></div>
        </div>

        <div style="display:flex; gap:8px;">
          <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
            <label style="color: var(--text-secondary); font-size: 0.8rem; font-weight:500;">Rent *</label>
            <input type="number" step="any" class="bulk-rent" placeholder="0.00" style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); font-size:0.95rem;">
          </div>
          <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
            <label style="color: var(--text-secondary); font-size: 0.8rem; font-weight:500;">Due Day *</label>
            <input type="number" min="1" max="31" class="bulk-due-day" placeholder="1-31" value="${
              settings.defaultDueDay || 1
            }" style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); font-size:0.95rem;">
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:4px;">
          <label style="color: var(--text-secondary); font-size: 0.8rem; font-weight:500;">Entry Date *</label>
          <input type="date" class="bulk-entry-date" value="${todayStr}" style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); font-size:0.95rem;">
        </div>

        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" class="bulk-new-tenant" checked style="width:22px; height:22px; accent-color:#10b981;">
          <span style="color: var(--text-primary); font-size: 0.9rem;">New tenant – rent due on entry</span>
        </label>

        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" class="bulk-deposit-check" style="width:22px; height:22px; accent-color:#f59e0b;">
          <span style="color: var(--text-primary); font-size: 0.9rem;">💰 Deposit</span>
        </label>

        <div class="bulk-deposit-wrapper" style="display:none; flex-direction:column; gap:4px;">
          <label style="color: var(--text-secondary); font-size: 0.8rem; font-weight:500;">Deposit Period (months)</label>
          <input type="number" min="1" max="12" class="bulk-deposit-period" placeholder="e.g. 3" value="1" style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); font-size:0.95rem;">
        </div>

        <div style="display:flex; gap:8px;">
          <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
            <label style="color: var(--text-secondary); font-size: 0.8rem; font-weight:500;">Email (optional)</label>
            <input type="email" class="bulk-email" placeholder="tenant@email.com" style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); font-size:0.95rem;">
          </div>
          <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
            <label style="color: var(--text-secondary); font-size: 0.8rem; font-weight:500;">Notes (optional)</label>
            <input type="text" class="bulk-notes" placeholder="Any extra info..." style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); font-size:0.95rem;">
          </div>
        </div>
      `;

      card.querySelector(".bulk-entry-date").value = todayStr;
      card.querySelector(".bulk-delete-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        card.remove();
      });

      const depositCheck = card.querySelector(".bulk-deposit-check");
      const wrapper = card.querySelector(".bulk-deposit-wrapper");
      depositCheck.addEventListener("change", () => {
        wrapper.style.display = depositCheck.checked ? "flex" : "none";
      });

      container.appendChild(card);
      rowElement = card;
    } else {
      const tbody = document.getElementById("bulk-add-tbody");
      const row = document.createElement("tr");
      row.innerHTML = `
        <td style="padding:8px 4px; text-align:center; vertical-align:top;">
          <input type="text" class="bulk-name" placeholder="Name" style="width:100px; padding:8px 4px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.9rem;">
          <div class="bulk-name-error" style="font-size:0.65rem; color:#ef4444; min-height:12px;"></div>
        </td>
        <td style="padding:8px 4px; text-align:center;">
          <input type="tel" class="bulk-phone" placeholder="0712 345 678" style="width:110px; padding:8px 4px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.9rem;">
        </td>
        <td style="padding:8px 4px; text-align:center; vertical-align:top;">
          <input type="text" class="bulk-house" placeholder="e.g. B2" style="width:90px; padding:8px 4px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.9rem;">
          <div class="bulk-house-error" style="font-size:0.65rem; color:#ef4444; min-height:12px;"></div>
        </td>
        <td style="padding:8px 4px; text-align:center;">
          <input type="number" step="any" class="bulk-rent" placeholder="0.00" style="width:90px; padding:8px 4px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.9rem;">
        </td>
        <td style="padding:8px 4px; text-align:center;">
          <input type="number" min="1" max="31" class="bulk-due-day" placeholder="1-31" value="${
            settings.defaultDueDay || 1
          }" style="width:60px; padding:8px 4px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.9rem;">
        </td>
        <td style="padding:8px 4px; text-align:center;">
          <input type="date" class="bulk-entry-date" value="${todayStr}" style="width:110px; padding:8px 4px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.9rem;">
        </td>
        <td style="padding:8px 4px; text-align:center;">
          <input type="checkbox" class="bulk-new-tenant" checked style="width:20px; height:20px; accent-color:#10b981;">
        </td>
        <td style="padding:8px 4px; text-align:center;">
          <input type="number" min="0" max="12" class="bulk-deposit-period" placeholder="0" value="0" style="width:60px; padding:8px 4px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.9rem;">
        </td>
        <td style="padding:8px 4px; text-align:center;">
          <input type="email" class="bulk-email" placeholder="Email" style="width:140px; padding:8px 4px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.9rem;">
        </td>
        <td style="padding:8px 4px; text-align:center;">
          <input type="text" class="bulk-notes" placeholder="Notes" style="width:120px; padding:8px 4px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.9rem;">
        </td>
        <td style="padding:8px 4px; text-align:center;">
          <button class="bulk-delete-btn" style="background:none; border:none; color:var(--danger); font-size:1.2rem; cursor:pointer;" title="Delete this tenant">🗑️</button>
        </td>
      `;
      row.querySelector(".bulk-entry-date").value = todayStr;
      row.querySelector(".bulk-delete-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        row.remove();
      });
      tbody.appendChild(row);
      rowElement = row;
    }

    // Attach real‑time validation to all inputs in the row
    const inputs = rowElement.querySelectorAll("input");
    inputs.forEach((inp) => {
      inp.addEventListener("input", () => updateRowHighlight(rowElement));
    });
    // Do NOT call updateRowHighlight here – empty row stays clean.
    attachDuplicateCheck(rowElement);
  }

  const styleTag = document.createElement("style");
  styleTag.textContent = `
    .bulk-add-table { display: table; }
    #bulk-add-container { display: none; }
    @media (max-width: 600px) {
      .bulk-add-table { display: none; }
      #bulk-add-container { display: block; }
    }
    /* Premium red left border for invalid rows */
    .bulk-row-error {
      border-left: 4px solid #ef4444 !important;
      background: rgba(239,68,68,0.05) !important;
    }
    .bulk-row-error td:first-child {
      border-left: 4px solid #ef4444;
    }
    .bulk-add-save-btn {
      background: linear-gradient(135deg, #10b981, #059669);
      color: white; border: none; padding: 12px 28px; border-radius: 40px;
      font-size: 1rem; font-weight: 600; cursor: pointer;
      transition: transform 0.1s, box-shadow 0.1s;
    }
    .bulk-add-save-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4); }
    .bulk-add-cancel-btn {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: white; border: none; padding: 12px 28px; border-radius: 40px;
      font-size: 1rem; font-weight: 600; cursor: pointer;
      transition: transform 0.1s, box-shadow 0.1s;
    }
    .bulk-add-cancel-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4); }
    .bulk-add-error-box {
      background: rgba(239,68,68,0.15); border: 1px solid #ef4444;
      border-radius: 12px; padding: 16px; margin-top: 16px;
      color: #f87171; font-size: 0.9rem; line-height: 1.6; display: none;
    }
    .bulk-add-confirm-overlay {
      display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(4px);
      align-items: center; justify-content: center; z-index: 10;
    }
    .bulk-add-confirm-box {
      background: var(--bg-surface, #1e293b); border-radius: 24px; padding: 24px;
      max-width: 500px; width: 90%; text-align: center;
      border: 1px solid var(--border, #334155); box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
  `;
  document.head.appendChild(styleTag);

  // Main HTML that stays in the modal
  const mainHtml = `
    <div style="display:flex; flex-direction:column; gap:16px; padding-bottom:calc(30px + env(safe-area-inset-bottom, 20px)); position:relative;">
      <p style="text-align:center; font-size:0.85rem; color:var(--text-muted);">Fill the form below. Click <strong>+ Add Tenant</strong> to add another.</p>
      <div class="bulk-add-table" style="max-height:60vh; overflow-y:auto;">
        <table style="width:100%; border-collapse:separate; border-spacing:0 6px; font-size:0.9rem;">
          <thead>
            <tr style="background:var(--bg-elevated);">
              <th style="padding:10px 4px; text-align:center;">Name</th>
              <th style="padding:10px 4px; text-align:center;">Phone</th>
              <th style="padding:10px 4px; text-align:center;">House</th>
              <th style="padding:10px 4px; text-align:center;">Rent</th>
              <th style="padding:10px 4px; text-align:center;">Due Day</th>
              <th style="padding:10px 4px; text-align:center;">Entry Date</th>
              <th style="padding:10px 4px; text-align:center;">New?</th>
              <th style="padding:10px 4px; text-align:center;">Dep. Period</th>
              <th style="padding:10px 4px; text-align:center;">Email</th>
              <th style="padding:10px 4px; text-align:center;">Notes</th>
              <th style="padding:10px 4px; text-align:center;"></th>
            </tr>
          </thead>
          <tbody id="bulk-add-tbody">
          </tbody>
        </table>
      </div>
      <div id="bulk-add-container" style="padding:4px;">
      </div>
      <button id="bulk-add-row-btn" class="modal-action-btn" style="align-self:center; margin-top:8px;">+ Add Tenant</button>
      <div id="bulk-add-error-box" class="bulk-add-error-box"></div>
      <div style="display:flex; justify-content:center; gap:16px; margin-top:8px;">
        <button id="bulk-add-cancel-btn" class="bulk-add-cancel-btn">Cancel</button>
        <button id="bulk-add-save-btn" class="bulk-add-save-btn">💾 Save All</button>
      </div>
      <!-- Confirmation overlay (hidden until Save clicked) -->
      <div id="bulk-add-confirm-overlay" class="bulk-add-confirm-overlay">
        <div class="bulk-add-confirm-box">
          <h3 style="color:#f1f5f9; margin-bottom:16px;">Save Tenants?</h3>
          <p id="bulk-add-confirm-count" style="font-size:0.9rem; color:#94a3b8;"></p>
          <div style="display:flex; justify-content:center; gap:16px; margin-top:20px;">
            <button id="confirm-cancel-btn" class="bulk-add-cancel-btn">Cancel</button>
            <button id="confirm-yes-btn" class="bulk-add-save-btn">Yes, add all</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // 🔥 Use originalSwalFire to bypass the global wrapper that causes navigation
  const result = await originalSwalFire.call(Swal, {
    title: "🧑‍🤝‍🧑 Bulk Add Tenants",
    html: mainHtml,
    showCancelButton: false,
    showConfirmButton: false,
    allowOutsideClick: false, // 🔒 prevent accidental close
    allowEscapeKey: false, // 🔒 prevent Esc closing
    background: "#1e293b",
    color: "#f1f5f9",
    width: window.innerWidth > 600 ? "95%" : "100%",
    customClass: { popup: "fullscreen-sms-modal bulk-add-tenants-popup" },
    didOpen: () => {
      const popup = Swal.getPopup();
      if (popup) {
        popup.style.overflowY = "auto";
        popup.style.maxHeight = "100vh";
      }

      for (let i = 0; i < 3; i++) addEmptyRow();
      document
        .getElementById("bulk-add-row-btn")
        .addEventListener("click", () => addEmptyRow());
      document
        .getElementById("bulk-add-cancel-btn")
        .addEventListener("click", () => Swal.close());

      document
        .getElementById("bulk-add-save-btn")
        .addEventListener("click", () => {
          const errorBox = document.getElementById("bulk-add-error-box");
          errorBox.style.display = "none";

          const rows = document.querySelectorAll(".bulk-name");
          const allErrors = [];

          rows.forEach((nameEl, idx) => {
            const row =
              nameEl.closest("tr") || nameEl.closest(".bulk-add-card");
            if (!row) return;
            const errors = validateRow(row);
            if (errors.length > 0) {
              const tenantLabel = nameEl.value.trim() || `Tenant #${idx + 1}`;
              allErrors.push(
                `<strong>${tenantLabel}</strong>: ${errors.join(", ")}`
              );
            }
          });

          if (allErrors.length > 0) {
            errorBox.innerHTML = `<div style="font-weight:600; margin-bottom:8px;">⚠️ Please fix the following errors:</div>${allErrors
              .map((e) => `<div style="margin-bottom:4px;">• ${e}</div>`)
              .join("")}`;
            errorBox.style.display = "block";
            return;
          }

          // All valid, show confirmation overlay
          const validCount = [...rows].filter((el) => {
            const r = el.closest("tr") || el.closest(".bulk-add-card");
            return r && validateRow(r).length === 0;
          }).length;
          document.getElementById(
            "bulk-add-confirm-count"
          ).innerHTML = `Add <strong>${validCount}</strong> tenant(s)?`;
          document.getElementById("bulk-add-confirm-overlay").style.display =
            "flex";

          document.getElementById("confirm-cancel-btn").onclick = () => {
            document.getElementById("bulk-add-confirm-overlay").style.display =
              "none";
          };

          document.getElementById("confirm-yes-btn").onclick = async () => {
            document.getElementById("bulk-add-confirm-overlay").style.display =
              "none";
            setButtonLoading(
              document.getElementById("bulk-add-save-btn"),
              true
            );

            const nameEls = document.querySelectorAll(".bulk-name");
            const phoneEls = document.querySelectorAll(".bulk-phone");
            const houseEls = document.querySelectorAll(".bulk-house");
            const rentEls = document.querySelectorAll(".bulk-rent");
            const dueDayEls = document.querySelectorAll(".bulk-due-day");
            const entryDateEls = document.querySelectorAll(".bulk-entry-date");
            const newTenantEls = document.querySelectorAll(".bulk-new-tenant");
            const depPeriodEls = document.querySelectorAll(
              ".bulk-deposit-period"
            );
            const emailEls = document.querySelectorAll(".bulk-email");
            const notesEls = document.querySelectorAll(".bulk-notes");

            const tenantsToAdd = [];
            for (let i = 0; i < nameEls.length; i++) {
              const name = nameEls[i].value.trim();
              if (!name) continue;
              const phone = phoneEls[i].value.trim();
              const house = houseEls[i].value.trim();
              const rentStr = rentEls[i].value.trim();
              const dueDayStr = dueDayEls[i].value.trim();
              const entryDate = entryDateEls[i].value || todayStr;
              const newTenant = newTenantEls[i].checked;

              let depositPeriodStr;
              const depositCheckbox = document.querySelectorAll(
                ".bulk-deposit-check"
              )[i];
              if (depositCheckbox && !depositCheckbox.checked)
                depositPeriodStr = "0";
              else depositPeriodStr = depPeriodEls[i].value.trim() || "0";

              const email = emailEls[i].value.trim();
              const notes = notesEls[i].value.trim();

              if (!phone || !house || !rentStr || !dueDayStr || !entryDate)
                continue;

              const rent = Number(rentStr);
              const dueDay = parseInt(dueDayStr);
              const depositPeriod = parseInt(depositPeriodStr) || 0;

              tenantsToAdd.push({
                name,
                phoneNumber: phone,
                houseNumber: house,
                rent,
                dueDay,
                entryDate,
                newTenant,
                depositPeriod,
                email,
                notes,
              });
            }

            try {
              const response = await fetchWithTimeout(
                "/tenants/bulk-add",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("token")}`,
                  },
                  body: JSON.stringify({ tenants: tenantsToAdd }),
                },
                120000
              );

              const data = await response.json();
              if (response.ok) {
                await loadTenants();
                scheduleChartUpdate();
                let msg = `Added ${data.created} tenants.`;
                if (data.errors && data.errors.length > 0) {
                  msg += ` Skipped: ${data.errors.join(", ")}.`;
                }
                originalSwalFire.call(Swal, {
                  toast: true,
                  position: "bottom-end",
                  showConfirmButton: false,
                  timer: 2000,
                  timerProgressBar: true,
                  background: "#1e293b",
                  color: "#f1f5f9",
                  icon: "success",
                  title: msg,
                });
                Swal.close();
              } else {
                errorBox.innerHTML =
                  data.message || data.error || "Failed to add tenants.";
                errorBox.style.display = "block";
              }
            } catch (err) {
              errorBox.innerHTML = `Network error: ${err.message}`;
              errorBox.style.display = "block";
            } finally {
              setButtonLoading(
                document.getElementById("bulk-add-save-btn"),
                false
              );
            }
          };
        });
    },
    willClose: () => {
      styleTag.remove();
    },
  });
}

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

        // Preview table – includes Name, Phone, House, Rent, Email, New Tenant, Due Date
        let previewHtml = `<div style="max-height: 300px; overflow-y: auto;">
          <table style="width:100%; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid var(--border);">
              <th>Name</th><th>Phone</th><th>House</th><th>Rent</th><th>Email</th><th>New Tenant</th><th>Due Date</th>
            </tr>`;

        tenants.slice(0, 10).forEach((t) => {
          previewHtml += `<tr>
            <td>${t.name || ""}</td>
            <td>${t.phoneNumber || ""}</td>
            <td>${t.houseNumber || ""}</td>
            <td>${t.rent || ""}</td>
            <td>${t.email || ""}</td>
            <td>${
              t.newTenant === "true" || t.newTenant === "TRUE" ? "✅" : "—"
            }</td>
            <td>${t.dueDate || ""}</td>
          </tr>`;
        });

        if (tenants.length > 10)
          previewHtml += `<tr><td colspan="7" style="text-align:center;">... and ${
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
            // Convert newTenant strings to boolean before sending
            const cleanTenants = tenants.map((t) => ({
              ...t,
              newTenant:
                t.newTenant === "true" || t.newTenant === "TRUE" ? true : false,
            }));
            const response = await fetchWithTimeout(
              window.location.origin + "/tenants/import",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${localStorage.getItem("token")}`,
                },
                body: JSON.stringify({ tenants: cleanTenants }),
              },
              120000 // 2 minutes timeout
            );
            const data = await response.json();

            if (response.ok) {
              let msg = `Imported ${data.created} tenants.`;
              if (data.errors) msg += ` ${data.errors.length} skipped.`;
              Toast.fire({ icon: "success", title: msg });
              await loadTenants();
              scheduleChartUpdate();
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
    popModalState();
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

  // Main actions modal – uses originalSwalFire so no extra history
  lastModalOpenTime = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const action = await originalSwalFire.call(Swal, {
    title: `Actions for ${escapeHtml(tenant.name)}`,
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
    customClass: { popup: "premium-confirm-popup" },
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

  // Restore
  if (action.isConfirmed) {
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
        // 🔥 Remove from the archived list immediately
        if (showArchived) {
          tenantArray = tenantArray.filter((t) => t._id !== tenantId);
        } else {
          const idx = tenantArray.findIndex((t) => t._id === tenantId);
          if (idx !== -1) tenantArray[idx].active = true;
        }

        sessionStorage.setItem("cachedTenants", JSON.stringify(tenantArray));
        applyFiltersAndSort();
        updateStats(tenantArray);
        scheduleChartUpdate();

        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 2000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "success",
          title: "Tenant restored",
        });
      } else {
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: "Restore failed",
        });
      }
    } catch (err) {
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
        icon: "error",
        title: err.message,
      });
    } finally {
      setButtonLoading(btn, false);
    }
  }

  // Delete permanently
  if (action.isDenied) {
    // Prevent flicker: set the guard before showing the confirmation
    lastModalOpenTime = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const confirmDelete = await originalSwalFire.call(Swal, {
      title: "Permanently Delete?",
      html: `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 16px;">
          <div style="font-size: 2.5rem; color: #ef4444;">⚠️</div>
          <div style="font-size: 1rem; color: #f1f5f9; text-align: center;">
            This action <strong style="color: #ef4444;">cannot be undone</strong>.
            All payment history will be lost.
          </div>
        </div>
      `,
      icon: null,
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      confirmButtonText: "Yes, delete forever",
      cancelButtonText: "Cancel",
      background: "#1e293b",
      color: "#f1f5f9",
      customClass: { popup: "premium-confirm-popup" },
    });

    if (!confirmDelete.isConfirmed) return;

    lastModalOpenTime = Date.now();
    setButtonLoading(btn, true);
    try {
      const response = await fetchWithTimeout(
        window.location.origin + `/tenants/${tenantId}/permanent`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );
      if (response.ok) {
        await loadTenants();
        scheduleChartUpdate();
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 2000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "success",
          title: "Tenant deleted permanently",
        });
      } else {
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: "Delete failed",
        });
      }
    } catch (err) {
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
        icon: "error",
        title: err.message,
      });
    } finally {
      setButtonLoading(btn, false);
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
  document
    .getElementById("bulk-water-btn")
    ?.addEventListener("click", showBulkWaterReadingModal);
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

  document
    .getElementById("bulk-edit-tenants-btn")
    .addEventListener("click", showBulkEditTenantsModal);

  document
    .getElementById("bulk-payment-btn")
    ?.addEventListener("click", showBulkPaymentModal);

  document
    .getElementById("open-add-tenant-modal")
    ?.addEventListener("click", showAddTenantModal);

  document
    .getElementById("delete-all-tenants-btn")
    ?.addEventListener("click", async () => {
      // First confirmation – type DELETE ALL

      lastModalOpenTime = Date.now();

      await new Promise((resolve) => setTimeout(resolve, 10));

      const firstConfirm = await originalSwalFire.call(Swal, {
        title: "⚠️ Delete All Tenants",
        html: `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 20px;">
        <div style="font-size: 1rem; color: #f1f5f9; text-align: center;">
          This will <strong style="color: #ef4444;">permanently remove all active tenants</strong> and their payment history.
        </div>
        <div style="font-size: 0.9rem; color: #94a3b8; text-align: center;">
          Type <strong style="color: #fbbf24; font-size: 1.1rem;">DELETE ALL</strong> below to confirm:
        </div>
        <input id="swal-confirmation-input" class="swal2-input" placeholder="DELETE ALL"
          style="text-align: center; font-size: 1.2rem; font-weight: 700; letter-spacing: 2px;
                 width: 80%; max-width: 300px; padding: 12px;
                 border: 2px solid #ef4444; border-radius: 8px;
                 background: #1e293b; color: #f1f5f9;">
      </div>
    `,
        icon: null,
        showCancelButton: true,
        confirmButtonColor: "#ef4444",
        confirmButtonText: "Yes, delete all",
        cancelButtonText: "Cancel",
        background: "#1e293b",
        color: "#f1f5f9",
        customClass: {
          popup: "premium-confirm-popup",
          title: "swal2-title-delete",
          htmlContainer: "swal2-html-container-delete",
        },
        preConfirm: () => {
          const input = document.getElementById(
            "swal-confirmation-input"
          ).value;
          if (input !== "DELETE ALL") {
            Swal.showValidationMessage("You must type DELETE ALL exactly");
            return false;
          }
          return true;
        },
        didOpen: () => {
          const style = document.createElement("style");
          style.textContent = `
        .premium-confirm-popup {
          border-radius: 32px !important;
          padding: 30px 24px !important;
          max-width: 480px !important;
          width: 90% !important;
          box-shadow: 0 20px 40px rgba(0,0,0,0.5) !important;
          border: 1px solid rgba(239,68,68,0.3) !important;
        }
        .swal2-title-delete {
          font-size: 1.5rem !important;
          font-weight: 700 !important;
          color: #ef4444 !important;
          text-align: center !important;
        }
        .swal2-html-container-delete {
          display: flex !important;
          justify-content: center !important;
          align-items: center !important;
          padding: 8px 0 !important;
        }
        #swal-confirmation-input:focus {
          outline: none;
          border-color: #fbbf24;
          box-shadow: 0 0 8px rgba(245,158,11,0.5);
        }
      `;
          document.head.appendChild(style);
          Swal.getPopup().addEventListener(
            "animationend",
            () => style.remove(),
            {
              once: true,
            }
          );
        },
      });

      if (!firstConfirm.isConfirmed) return;

      // Prevent stray overlay click
      lastModalOpenTime = Date.now();
      // Second confirmation
      await new Promise((resolve) => setTimeout(resolve, 10));
      const secondConfirm = await originalSwalFire.call(Swal, {
        title: "Are you absolutely sure?",
        html: `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 16px;">
        <div style="font-size: 2.5rem; color: #ef4444;">⚠️</div>
        <div style="font-size: 1rem; color: #f1f5f9; text-align: center;">
          All tenants and their payment history will be <strong style="color: #ef4444;">permanently lost</strong>.
        </div>
      </div>
    `,
        icon: null,
        showCancelButton: true,
        confirmButtonColor: "#7f1d1d",
        confirmButtonText: "Yes, delete everything",
        cancelButtonText: "Cancel",
        background: "#1e293b",
        color: "#f1f5f9",
        customClass: {
          popup: "premium-confirm-popup",
        },
      });

      if (!secondConfirm.isConfirmed) return;

      // Prevent stray overlay click again
      lastModalOpenTime = Date.now();

      setButtonLoading(document.getElementById("delete-all-tenants-btn"), true);
      try {
        const response = await fetchWithTimeout("/tenants/delete-all", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });
        const data = await response.json();
        if (response.ok) {
          await loadTenants();
          scheduleChartUpdate();
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "success",
            title: `Deleted ${data.deletedCount} tenants.`,
          });
        } else {
          originalSwalFire.call(Swal, {
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            background: "#1e293b",
            color: "#f1f5f9",
            icon: "error",
            title: data.message || "Failed to delete",
          });
        }
      } catch (err) {
        originalSwalFire.call(Swal, {
          toast: true,
          position: "bottom-end",
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true,
          background: "#1e293b",
          color: "#f1f5f9",
          icon: "error",
          title: err.message,
        });
      } finally {
        setButtonLoading(
          document.getElementById("delete-all-tenants-btn"),
          false
        );
      }
    });

  document
    .getElementById("bulk-add-tenants-btn")
    ?.addEventListener("click", showBulkAddTenantsModal);

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
// ----- BULK PAYMENT MODAL (flicker‑free, confirmation overlay inside same modal) -----
async function showBulkPaymentModal() {
  closeDropdownIfOpen();
  const todayStr = new Date().toISOString().split("T")[0];
  let tenants = [...tenantArray].filter((t) => t.active !== false);

  if (tenants.length === 0) {
    Toast.fire({ icon: "warning", title: "No active tenants." });
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

  function renderTable() {
    let html = "";
    tenants.forEach((tenant, index) => {
      const rowBg =
        index % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)";
      html += `
        <tr style="background:${rowBg};">
          <td style="padding:10px 4px; text-align:center; color:var(--text-muted); font-size:0.95rem;">${escapeHtml(
            tenant.houseNumber || "—"
          )}</td>
          <td style="padding:10px 4px; text-align:center; font-weight:500; font-size:0.95rem;">${escapeHtml(
            tenant.name
          )}</td>
          <td style="padding:10px 4px; text-align:center;">
            <input type="number" step="any" class="bulk-pay-amount" data-tenant-id="${
              tenant._id
            }" placeholder="0.00" style="width:80px; padding:8px 2px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.95rem;">
          </td>
          <td style="padding:10px 4px; text-align:center;">
            <input type="date" class="bulk-pay-date" data-tenant-id="${
              tenant._id
            }" value="${todayStr}" style="width:115px; padding:8px 2px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.95rem;">
          </td>
          <td style="padding:10px 4px; text-align:center;">
            <input type="text" class="bulk-pay-mpesa" data-tenant-id="${
              tenant._id
            }" placeholder="Optional" style="width:90px; padding:8px 2px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.95rem;">
          </td>
        </tr>
      `;
    });
    return html;
  }

  const styleTag = document.createElement("style");
  styleTag.textContent = `
    @media (max-width: 600px) {
      .bulk-pay-table th, .bulk-pay-table td { padding: 6px 1px !important; font-size: 0.8rem !important; }
      .bulk-pay-amount, .bulk-pay-date, .bulk-pay-mpesa { width: 55px !important; padding: 6px 1px !important; font-size: 0.8rem !important; }
      .bulk-payment-fullscreen .swal2-html-container { padding: 8px 0 !important; }
      .bulk-payment-content { padding: 0 !important; }
      .bulk-pay-buttons { gap: 8px !important; padding: 0 2px !important; flex-wrap: nowrap !important; }
      .bulk-cancel-btn, .bulk-save-btn { padding: 10px 20px !important; font-size: 0.9rem !important; }
    }
    .bulk-pay-sticky-header th { position: sticky; top: 0; background: var(--bg-elevated); z-index: 2; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    .bulk-save-btn { background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; padding: 12px 28px; border-radius: 40px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: transform 0.1s, box-shadow 0.1s; }
    .bulk-save-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4); }
    .bulk-cancel-btn { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border: none; padding: 12px 28px; border-radius: 40px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: transform 0.1s, box-shadow 0.1s; }
    .bulk-cancel-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4); }
  `;
  document.head.appendChild(styleTag);

  const modalHtml = `
    <div class="bulk-payment-content" style="display:flex; flex-direction:column; padding-bottom:16px;">
      <p style="text-align:center; font-size:1rem; color:var(--text-muted); margin-bottom:12px; padding:0 16px;">Fill in amounts for the tenants you want to pay. Empty rows are ignored.</p>
      <div style="overflow-x:auto; border:1px solid var(--border); border-radius:12px; margin:0 0 16px 0;">
        <table class="bulk-pay-table" style="width:100%; border-collapse:separate; border-spacing:0 4px; font-size:0.95rem;">
          <thead class="bulk-pay-sticky-header">
            <tr style="background:var(--bg-elevated);">
              <th style="padding:12px 4px; text-align:center; font-weight:600; color:var(--accent-cyan);">House</th>
              <th style="padding:12px 4px; text-align:center; font-weight:600; color:var(--accent-cyan);">Tenant</th>
              <th style="padding:12px 4px; text-align:center; font-weight:600; color:var(--accent-cyan);">Amount</th>
              <th style="padding:12px 4px; text-align:center; font-weight:600; color:var(--accent-cyan);">Date</th>
              <th style="padding:12px 4px; text-align:center; font-weight:600; color:var(--accent-cyan);">M‑Pesa Ref</th>
            </tr>
          </thead>
          <tbody id="bulk-pay-tbody">
            ${renderTable()}
          </tbody>
        </table>
      </div>
      <div class="bulk-pay-buttons" style="display:flex; justify-content:center; gap:14px; padding:0 4px; flex-wrap:nowrap;">
        <button id="custom-bulk-cancel-btn" class="bulk-cancel-btn">Cancel</button>
        <button id="custom-bulk-save-btn" class="bulk-save-btn">💰 Save All</button>
      </div>
    </div>
  `;

  const result = await Swal.fire({
    title: "💳 Bulk Payment",
    html: modalHtml,
    showCancelButton: false,
    showConfirmButton: false,
    showCloseButton: true,
    background: "#1e293b",
    color: "#f1f5f9",
    width: "100%",
    grow: "fullscreen",
    customClass: { popup: "bulk-payment-fullscreen" },
    didOpen: () => {
      const popup = Swal.getPopup();
      if (popup) {
        popup.style.position = "fixed";
        popup.style.top = "0";
        popup.style.left = "0";
        popup.style.width = "100%";
        popup.style.height = "100%";
        popup.style.maxHeight = "100vh";
        popup.style.margin = "0";
        popup.style.borderRadius = "0";
        popup.style.transform = "none";
        popup.style.display = "flex";
        popup.style.flexDirection = "column";
        popup.style.overflow = "auto";
      }
      const htmlContainer = Swal.getHtmlContainer();
      if (htmlContainer) {
        htmlContainer.style.flex = "1";
        htmlContainer.style.overflowY = "visible";
        htmlContainer.style.maxHeight = "none";
      }

      document
        .getElementById("custom-bulk-cancel-btn")
        ?.addEventListener("click", () => Swal.close());

      document
        .getElementById("custom-bulk-save-btn")
        ?.addEventListener("click", () => {
          const amounts = document.querySelectorAll(".bulk-pay-amount");
          const payments = [];
          const skipped = [];

          amounts.forEach((inp) => {
            const tenantId = inp.dataset.tenantId;
            const amountStr = inp.value.trim();
            const tenant = tenants.find((t) => t._id === tenantId);
            const tenantLabel = tenant
              ? `${escapeHtml(tenant.name)} (${escapeHtml(
                  tenant.houseNumber || "—"
                )})`
              : tenantId;

            if (amountStr === "") return;

            const amount = parseFloat(amountStr);
            if (isNaN(amount) || amount <= 0) {
              skipped.push(`${tenantLabel} – invalid amount`);
              return;
            }

            const dateInput = document.querySelector(
              `.bulk-pay-date[data-tenant-id="${tenantId}"]`
            );
            const mpesaInput = document.querySelector(
              `.bulk-pay-mpesa[data-tenant-id="${tenantId}"]`
            );
            const date = dateInput?.value || todayStr;
            const mpesa = mpesaInput?.value.trim() || "";

            payments.push({ tenantId, amount, date, mpesa });
          });

          if (payments.length === 0 && skipped.length === 0) {
            Swal.showValidationMessage(
              "Enter at least one valid payment amount."
            );
            return;
          }

          const tenantMap = new Map(tenants.map((t) => [t._id, t]));
          let summaryHtml =
            '<div style="text-align:left; font-size:0.95rem; line-height:1.6; max-height:200px; overflow-y:auto;">';
          if (payments.length > 0) {
            summaryHtml +=
              '<p style="font-weight:600; color:#10b981; margin-bottom:8px;">✅ Payments to be recorded:</p>';
            payments.forEach((p) => {
              const t = tenantMap.get(p.tenantId);
              const name = t ? t.name : p.tenantId;
              const house = t ? t.houseNumber || "—" : "—";
              summaryHtml += `<div style="margin-bottom:4px;">🏠 ${escapeHtml(
                house
              )} – <strong>${escapeHtml(
                name
              )}</strong>: KES ${p.amount.toLocaleString()} on ${p.date} ${
                p.mpesa ? `(Ref: ${escapeHtml(p.mpesa)})` : ""
              }</div>`;
            });
          }
          if (skipped.length > 0) {
            summaryHtml +=
              '<p style="font-weight:600; color:#f59e0b; margin-top:12px; margin-bottom:8px;">⚠️ Skipped (invalid input):</p>';
            skipped.forEach(
              (s) =>
                (summaryHtml += `<div style="margin-bottom:4px; color:#fbbf24;">• ${s}</div>`)
            );
          }
          summaryHtml += "</div>";

          const overlay = document.createElement("div");
          overlay.style.cssText =
            "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); backdrop-filter:blur(4px); z-index:9999; display:flex; align-items:center; justify-content:center;";
          overlay.innerHTML = `
          <div style="background: var(--bg-surface, #1e293b); border-radius: 24px; padding: 24px; max-width: 480px; width: 90%; text-align: center; border: 1px solid var(--border, #334155); box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
            <h3 style="color:#f1f5f9; margin-bottom:12px; font-size:1.2rem;">Confirm Bulk Payment</h3>
            <p style="font-size:0.95rem; color:#94a3b8;">You are about to record payments for <strong>${payments.length}</strong> tenant(s).</p>
            ${summaryHtml}
            <div style="display:flex; justify-content:center; gap:14px; margin-top:20px;">
              <button id="confirm-cancel-btn" class="bulk-cancel-btn">Cancel</button>
              <button id="confirm-yes-btn" class="bulk-save-btn">Yes, save all</button>
            </div>
          </div>
        `;
          document.body.appendChild(overlay);

          document
            .getElementById("confirm-cancel-btn")
            .addEventListener("click", () => overlay.remove());

          let bulkSaveInProgress = false;

          document
            .getElementById("confirm-yes-btn")
            .addEventListener("click", async () => {
              if (bulkSaveInProgress) return;
              bulkSaveInProgress = true;

              const confirmBtn = document.getElementById("confirm-yes-btn");
              const originalText = confirmBtn.innerHTML;
              confirmBtn.innerHTML = `<span class="custom-loader" style="margin-right:8px;"></span> Saving...`;
              confirmBtn.disabled = true;

              try {
                let successCount = 0;
                const failedNames = [];
                const BATCH_SIZE = 5;

                for (let i = 0; i < payments.length; i += BATCH_SIZE) {
                  const batch = payments.slice(i, i + BATCH_SIZE);
                  const batchResults = await Promise.allSettled(
                    batch.map(async (p) => {
                      const tenant = tenantMap.get(p.tenantId);
                      if (!tenant)
                        return {
                          tenant: p.tenantId,
                          success: false,
                          error: "Tenant not found",
                        };
                      try {
                        const res = await fetchWithTimeout(
                          `${window.location.origin}/tenants/${p.tenantId}/payment-history`,
                          {
                            method: "PATCH",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${localStorage.getItem(
                                "token"
                              )}`,
                            },
                            body: JSON.stringify({
                              amountPaid: p.amount,
                              datePaid: p.date || null,
                              mpesaRef: p.mpesa || "",
                            }),
                          }
                        );
                        const data = await res.json();
                        if (res.ok && data.success)
                          return {
                            tenant: tenant.name || p.tenantId,
                            success: true,
                          };
                        else
                          return {
                            tenant: tenant.name || p.tenantId,
                            success: false,
                            error: data.message || "Server error",
                          };
                      } catch (err) {
                        return {
                          tenant: tenant.name || p.tenantId,
                          success: false,
                          error: err.message,
                        };
                      }
                    })
                  );
                  batchResults.forEach((res) => {
                    if (res.status === "fulfilled") {
                      const { tenant: name, success, error } = res.value;
                      if (success) successCount++;
                      else
                        failedNames.push(
                          `${name}${error ? ` (${error})` : ""}`
                        );
                    } else failedNames.push("Unknown");
                  });
                }

                await loadTenants();
                scheduleChartUpdate();

                // Remove overlay and close modal
                overlay.remove();
                Swal.close();

                // Small delay so the modal fully closes, then toast
                await new Promise((resolve) => setTimeout(resolve, 300));

                let msg = `Payments recorded for ${successCount} tenant(s).`;
                if (failedNames.length)
                  msg += ` Failed: ${failedNames.join(", ")}.`;
                Toast.fire({
                  icon: successCount > 0 ? "success" : "error",
                  title: msg,
                  timer: 4000,
                });
              } catch (err) {
                overlay.remove();
                Swal.close();
                Toast.fire({ icon: "error", title: err.message });
              }
            });
        });
    },
    willClose: () => {
      styleTag.remove();
    },
  });
}
async function showBulkWaterReadingModal() {
  closeDropdownIfOpen();
  const currentMonth = getCurrentMonth();
  const waterRate = globalSettings.waterRatePerUnit || 0;

  let monthsSet = new Set();
  tenantArray.forEach((tenant) => {
    tenant.paymentHistory.forEach((record) => monthsSet.add(record.month));
  });
  monthsSet.add(currentMonth);
  let uniqueMonths = Array.from(monthsSet).sort().reverse();

  let monthOptions = "";
  uniqueMonths.forEach((month) => {
    monthOptions += `<option value="${month}" ${
      month === currentMonth ? "selected" : ""
    }>${month}</option>`;
  });

  function renderTable(selectedMonth) {
    const activeTenants = tenantArray
      .filter((t) => t.active !== false)
      .filter((t) =>
        t.paymentHistory.some(
          (e) =>
            e.month === selectedMonth &&
            (e.amountPaid || 0) === 0 &&
            !e.datePaid
        )
      )
      .sort((a, b) => {
        const ha = (a.houseNumber || "").trim();
        const hb = (b.houseNumber || "").trim();
        return ha.localeCompare(hb, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

    if (activeTenants.length === 0) {
      return `<p style="text-align:center; padding:40px; font-size:1.1rem; color:var(--text-muted);">No tenants have a billing entry for ${selectedMonth}.</p>`;
    }

    let html = `
      <table class="bulk-water-table" style="width:100%; border-collapse:separate; border-spacing:0 6px; font-size:1rem;">
        <thead>
          <tr style="background:var(--bg-elevated);">
            <th style="padding:10px 4px; text-align:center; border-radius:8px 0 0 8px;">Tenant</th>
            <th style="padding:10px 4px; text-align:center;">House</th>
            <th style="padding:10px 4px; text-align:center;">Prev</th>
            <th style="padding:10px 4px; text-align:center;">Override</th>
            <th style="padding:10px 4px; text-align:center;">Reading</th>
            <th style="padding:10px 4px; text-align:center; border-radius:0 8px 8px 0;">Exempt</th>
          </tr>
        </thead>
        <tbody>`;

    activeTenants.forEach((tenant, index) => {
      const allReadings = [...(tenant.waterMeterReadings || [])].sort((a, b) =>
        a.month.localeCompare(b.month)
      );
      let prevAuto = 0;
      for (const r of allReadings) {
        if (r.month < selectedMonth) prevAuto = r.reading;
        else break;
      }

      const existing = allReadings.find((r) => r.month === selectedMonth);
      const currentReading = existing ? existing.reading : "";
      const currentOverride = existing ? existing.previousOverride || "" : "";
      const currentExempt = existing ? existing.exemptUnits || "" : "";

      const rowBg =
        index % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)";

      let invalidClass = "";
      if (currentReading !== "") {
        const readingVal = parseFloat(currentReading);
        const effectivePrevious =
          currentOverride !== "" ? parseFloat(currentOverride) : prevAuto;
        if (
          !isNaN(readingVal) &&
          !isNaN(effectivePrevious) &&
          readingVal < effectivePrevious
        ) {
          invalidClass = "bulk-invalid-row";
        }
      }

      html += `
        <tr class="${invalidClass}" style="background:${rowBg};">
          <td style="padding:8px 4px; text-align:center; font-weight:500; border-radius:8px 0 0 8px;">${escapeHtml(
            tenant.name
          )}</td>
          <td style="padding:8px 4px; text-align:center;">${escapeHtml(
            tenant.houseNumber || "—"
          )}</td>
          <td style="padding:8px 4px; text-align:center; color:var(--accent-cyan); font-weight:500;" class="bulk-prev-auto" data-prev="${prevAuto}">${prevAuto}</td>
          <td style="padding:8px 4px; text-align:center;">
            <input type="number" step="0.1" class="bulk-override-input" data-tenant-id="${
              tenant._id
            }" value="${currentOverride}" placeholder="Auto" style="width:80px; padding:8px 4px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.9rem;">
          </td>
          <td style="padding:8px 4px; text-align:center;">
            <input type="number" step="0.1" class="bulk-reading-input" data-tenant-id="${
              tenant._id
            }" value="${currentReading}" placeholder="Reading" style="width:90px; padding:8px 4px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.9rem;">
          </td>
          <td style="padding:8px 4px; text-align:center; border-radius:0 8px 8px 0;">
            <input type="number" step="0.1" class="bulk-exempt-input" data-tenant-id="${
              tenant._id
            }" value="${currentExempt}" placeholder="0" style="width:70px; padding:8px 4px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-primary); text-align:center; font-size:0.9rem;">
          </td>
        </tr>`;
    });

    html += `</tbody></table>`;
    return html;
  }

  // ── Performance‑friendly full‑screen styles ──
  const styleTag = document.createElement("style");
  styleTag.textContent = `
    .bulk-water-fullscreen {
      background: var(--bg-secondary, #0f172a) !important;
    }
    .bulk-water-fullscreen .swal2-html-container {
      margin: 0 !important;
      padding: 8px 16px !important;
      flex: 1 !important;
      overflow-y: auto !important;
    }
    .bulk-water-table {
      width: 100%;
      border-collapse: collapse;
    }
    .bulk-water-table th, .bulk-water-table td {
      text-align: center;
      vertical-align: middle;
    }
    .bulk-water-table thead th {
      position: sticky;
      top: 0;
      background: var(--bg-elevated);
      z-index: 2;
    }
    .bulk-override-input, .bulk-reading-input, .bulk-exempt-input {
      width: 100%;
      max-width: 100px;
      padding: 8px 4px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-deep);
      color: var(--text-primary);
      text-align: center;
      font-size: 0.9rem;
    }
    .bulk-invalid-row td {
      background: rgba(239,68,68,0.15) !important;
    }
    .bulk-invalid-row td:first-child {
      border-left: 3px solid #ef4444;
    }
    #bulk-reading-errors {
      display: none;
      margin: 16px 0;
      padding: 16px;
      background: rgba(239,68,68,0.1);
      border: 1px solid #ef4444;
      border-radius: 12px;
      max-height: 200px;
      overflow-y: auto;
    }
    #bulk-reading-errors .error-list {
      color: #f87171;
      font-size: 0.9rem;
      line-height: 1.6;
    }
    #bulk-reading-errors .error-list div {
      margin-bottom: 6px;
    }
    #bulk-reading-errors .error-title {
      font-weight: 700;
      font-size: 1rem;
      color: #ef4444;
      margin-bottom: 8px;
    }
    @media (max-width: 600px) {
      .bulk-water-table th, .bulk-water-table td {
        padding: 6px 1px !important;
        font-size: 0.7rem;
      }
      .bulk-override-input, .bulk-reading-input, .bulk-exempt-input {
        max-width: 55px;
        padding: 6px 1px;
        font-size: 0.65rem;
      }
    }
  `;
  document.head.appendChild(styleTag);

  const modalHtml = `
    <div style="display:flex; flex-direction:column; gap:16px; padding-bottom: 16px;">
      <div style="display:flex; justify-content:center; gap:12px; align-items:center; flex-wrap:wrap;">
        <label style="color:var(--text-secondary); font-size:1rem;">Month:</label>
        <select id="bulk-reading-month" style="padding:10px 16px; border-radius:40px; background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border); font-size:1rem;">
          ${monthOptions}
        </select>
      </div>
      <p style="text-align:center; font-size:0.9rem; color:var(--text-muted);">Water Rate: <strong style="color:var(--accent-cyan);">KES ${waterRate.toLocaleString()} / unit</strong></p>
      <div id="bulk-reading-errors">
        <div class="error-title">⚠️ Invalid Readings Found</div>
        <div class="error-list" id="bulk-error-list"></div>
      </div>
      <div id="bulk-reading-table" style="overflow-x:auto;">
        ${renderTable(currentMonth)}
      </div>
    </div>
  `;

  // ── Full‑screen Swal fire ──
  const result = await Swal.fire({
    title: "📋 Bulk Water Reading",
    html: modalHtml,
    showCancelButton: true,
    confirmButtonText: "💾 Save All",
    confirmButtonColor: "#10b981",
    cancelButtonColor: "#ef4444",
    background: "#1e293b",
    color: "#f1f5f9",
    width: "100%",
    grow: "fullscreen",
    customClass: { popup: "bulk-water-fullscreen" },
    didOpen: () => {
      // Force full‑screen positioning
      const popup = Swal.getPopup();
      if (popup) {
        popup.style.position = "fixed";
        popup.style.top = "0";
        popup.style.left = "0";
        popup.style.width = "100%";
        popup.style.height = "100%";
        popup.style.maxHeight = "100vh";
        popup.style.margin = "0";
        popup.style.borderRadius = "0";
        popup.style.transform = "none";
        popup.style.display = "flex";
        popup.style.flexDirection = "column";
        popup.style.overflow = "auto";
      }
      const htmlContainer = Swal.getHtmlContainer();
      if (htmlContainer) {
        htmlContainer.style.flex = "1";
        htmlContainer.style.overflowY = "visible";
        htmlContainer.style.maxHeight = "none";
      }

      const monthSelect = document.getElementById("bulk-reading-month");
      monthSelect.addEventListener("change", (e) => {
        const newMonth = e.target.value;
        const tableDiv = document.getElementById("bulk-reading-table");
        if (tableDiv) tableDiv.innerHTML = renderTable(newMonth);
        attachRowValidation();
        const errDiv = document.getElementById("bulk-reading-errors");
        if (errDiv) errDiv.style.display = "none";
      });

      function attachRowValidation() {
        document
          .querySelectorAll(".bulk-water-table tbody tr")
          .forEach((row) => {
            const readingInput = row.querySelector(".bulk-reading-input");
            const overrideInput = row.querySelector(".bulk-override-input");
            const prevCell = row.querySelector(".bulk-prev-auto");
            const autoPrev = parseFloat(prevCell?.dataset.prev || 0);

            const updateRow = () => {
              const reading = parseFloat(readingInput?.value);
              const override = overrideInput?.value.trim();
              const effectivePrevious =
                override !== "" ? parseFloat(override) : autoPrev;
              if (
                !isNaN(reading) &&
                !isNaN(effectivePrevious) &&
                reading < effectivePrevious
              ) {
                row.classList.add("bulk-invalid-row");
              } else {
                row.classList.remove("bulk-invalid-row");
              }
            };

            readingInput?.addEventListener("input", updateRow);
            overrideInput?.addEventListener("input", updateRow);
            updateRow();
          });
      }

      attachRowValidation();
    },
    preConfirm: () => {
      const selectedMonth = document.getElementById("bulk-reading-month").value;
      if (document.activeElement) document.activeElement.blur();

      const readingInputs = document.querySelectorAll(".bulk-reading-input");
      const errors = [];
      const readings = [];

      readingInputs.forEach((inp) => {
        const tenantId = inp.dataset.tenantId;
        const row = inp.closest("tr");
        const tenantName =
          row?.querySelector("td:first-child")?.textContent.trim() || "Unknown";
        const house =
          row?.querySelector("td:nth-child(2)")?.textContent.trim() || "—";
        const prevAuto = parseFloat(
          row?.querySelector(".bulk-prev-auto")?.dataset.prev || 0
        );

        const readingStr = inp.value.trim();
        const overrideInput = row.querySelector(".bulk-override-input");
        const exemptInput = row.querySelector(".bulk-exempt-input");
        const override = overrideInput ? overrideInput.value.trim() : "";
        const exempt = exemptInput ? exemptInput.value.trim() : "";

        if (readingStr === "") return;

        const reading = parseFloat(readingStr);
        if (isNaN(reading) || reading < 0) {
          errors.push(`${tenantName} (${house}): invalid reading value`);
          return;
        }

        const effectivePrevious =
          override !== "" ? parseFloat(override) : prevAuto;
        if (!isNaN(effectivePrevious) && reading < effectivePrevious) {
          errors.push(
            `${tenantName} (${house}): reading ${reading} is less than previous ${effectivePrevious}`
          );
          return;
        }

        readings.push({
          tenantId,
          month: selectedMonth,
          reading,
          previousOverride: override !== "" ? Number(override) : null,
          exemptUnits: exempt !== "" ? Number(exempt) : 0,
        });
      });

      if (errors.length > 0) {
        const errDiv = document.getElementById("bulk-reading-errors");
        const errorList = document.getElementById("bulk-error-list");
        errorList.innerHTML = errors
          .map((err) => `<div>• ${escapeHtml(err)}</div>`)
          .join("");
        errDiv.style.display = "block";
        errDiv.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }

      if (readings.length === 0) {
        Swal.showValidationMessage("No valid readings entered.");
        return false;
      }

      const errDiv = document.getElementById("bulk-reading-errors");
      if (errDiv) errDiv.style.display = "none";
      return readings;
    },
    willClose: () => {
      styleTag.remove();
    },
  });

  if (!result.isConfirmed) return;

  const readingsArray = result.value;
  setButtonLoading(document.getElementById("bulk-water-btn"), true);
  try {
    const response = await fetchWithTimeout("/tenants/bulk-meter-reading", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify({ readings: readingsArray }),
    });
    const data = await response.json();
    if (response.ok) {
      await loadTenants();
      scheduleChartUpdate();
      let msg = `Saved ${data.saved} readings.`;
      if (data.errors && data.errors.length > 0) {
        msg += ` Skipped: ${data.errors.join(", ")}.`;
      }
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
        icon: "success",
        title: msg,
      });
    } else {
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
        icon: "error",
        title: data.message || "Save failed",
      });
    }
  } catch (err) {
    Toast.fire({ icon: "error", title: err.message });
  } finally {
    setButtonLoading(document.getElementById("bulk-water-btn"), false);
  }
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

  // Find the charge entry for current billing month
  const currentCharge = (tenant.paymentHistory || []).find(
    (e) => e.month === currentMonth && (e.amountPaid || 0) === 0 && !e.datePaid
  );

  if (!currentCharge) {
    return `Dear ${
      tenant.name
    }, no payments recorded yet. Current month KES ${currentTotal.toLocaleString()} due by ${dueStr}. Thank you!`;
  }

  const paymentsThisMonth = (tenant.paymentHistory || []).filter(
    (e) => e.month === currentMonth && e.amountPaid > 0
  );
  const paidThisMonth = paymentsThisMonth.reduce(
    (sum, e) => sum + e.amountPaid,
    0
  );

  // Overdue branch
  if (overdue > 0) {
    return `Dear ${
      tenant.name
    }, total overdue KES ${overdue.toLocaleString()}. Current month KES ${currentTotal.toLocaleString()} due by ${dueStr}. Please pay overdue.`;
  }

  // No overdue – handle credit case
  if (credit > 0) {
    const stillToPay = Math.max(
      0,
      currentCharge.totalDue - paidThisMonth - credit
    );
    if (stillToPay === 0) {
      return `Dear ${
        tenant.name
      }, no overdue, KES ${credit.toLocaleString()} credit on your account. Thank you!`;
    } else {
      return `Dear ${
        tenant.name
      }, no overdue, but KES ${stillToPay.toLocaleString()} still to pay this month after credit. Due by ${dueStr}. Thank you!`;
    }
  }

  // No overdue, no credit
  const leftToPay = Math.max(0, currentCharge.totalDue - paidThisMonth);
  if (leftToPay === 0) {
    return `Dear ${tenant.name}, all payments up to date, including this month. Thank you!`;
  }
  return `Dear ${
    tenant.name
  }, no overdue, KES ${leftToPay.toLocaleString()} still to pay this month. Due by ${dueStr}. Thank you!`;
}
// ─────────────────────────────────────────────────────

// ----- INDIVIDUAL SMS MODAL (with segment cost) -----
async function showIndividualSmsModal(tenantId, prefillMessage = "") {
  const tenant = tenantArray.find((t) => t._id === tenantId);
  if (!tenant) return;

  const templates = {
    thanks: `Dear ${tenant.name}, thank you for your payment. Have a great day!`,
    quickBalance: generateShortBalanceMessage(tenant),
    waterBill: generateWaterBillSms(tenant),
  };

  // First popup – choose template
  const { value: message } = await Swal.fire({
    title: `📱 Send SMS to ${tenant.name}`,
    html: `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <select id="individual-template" style="padding: 10px; border-radius: 40px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border);">
          <option value="custom">✏️ Custom message</option>
          <option value="thanks">🙏 Thank you</option>
          <option value="quickBalance">⚡ Quick Balance (short)</option>
          <option value="waterBill">💧 Water Bill</option>
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
      // ── Scroll fix for desktop ──
      const popup = Swal.getPopup();
      if (popup) {
        popup.style.maxHeight = "90vh";
        popup.style.overflow = "hidden";
        popup.style.display = "flex";
        popup.style.flexDirection = "column";
      }
      const htmlContainer = Swal.getHtmlContainer();
      if (htmlContainer) {
        htmlContainer.style.flex = "1";
        htmlContainer.style.overflowY = "auto";
      }

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
        } else if (val === "waterBill") {
          textarea.value = templates.waterBill;
        } else {
          textarea.value = templates[val] || "";
        }
        updateCounter();
      });
    },
  });

  if (!message) return;

  // Small delay – avoids the first click leaking into the second popup
  await new Promise((resolve) => setTimeout(resolve, 100));

  const segments = Math.max(1, Math.ceil(message.length / 160));
  const cost = segments * 0.8;

  // Use original Swal.fire to keep the history stack clean
  lastModalOpenTime = Date.now();
  const confirmResult = await originalSwalFire.call(Swal, {
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
    showLoaderOnConfirm: true,
    preConfirm: async () => {
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
      if (!response.ok || !(data.results || [])[0]?.success) {
        throw new Error(data.message || "Failed to send SMS");
      }
      return data;
    },
  });

  if (confirmResult.isConfirmed) {
    Toast.fire({ icon: "success", title: "SMS sent successfully" });
  }
}

function generateDetailedBalanceHtml(tenant, landlordName = "Your Landlord") {
  const today = getAppToday();
  const overdue = getTenantPastDueAmount(tenant, today);
  const totalOutstanding = getTenantTotalOutstanding(tenant);
  const credit = totalOutstanding < 0 ? Math.abs(totalOutstanding) : 0;

  const allMonths = [
    ...new Set(tenant.paymentHistory.map((e) => e.month)),
  ].sort();
  const monthData = new Map();

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
    const extraTotal = (chargeEntry.extraCharges || []).reduce(
      (s, c) => s + c.amount,
      0
    );
    const totalDue =
      chargeEntry.totalDue ||
      rentAmount + depositInstalment + waterCharge + garbageCharge + extraTotal;

    const paymentsThisMonth = tenant.paymentHistory.filter(
      (e) => e.month === month && e.amountPaid > 0
    );
    const paid = paymentsThisMonth.reduce((sum, e) => sum + e.amountPaid, 0);

    const monthLeft = leftByMonth.get(month) || 0;
    const dueDate = chargeEntry.dueDate ? new Date(chargeEntry.dueDate) : null;
    const isPastDueByDate = dueDate && dueDate < today && monthLeft > 0;
    const isInitialPastDue = chargeEntry.initialPastDue && monthLeft > 0;
    const isOverdue = isPastDueByDate || isInitialPastDue;

    let status = "";
    if (monthLeft <= 0) status = "Paid";
    else if (isOverdue) status = "Overdue";
    else status = "Not Due";

    monthData.set(month, {
      month,
      rentAmount,
      depositInstalment,
      waterCharge,
      garbageCharge,
      extraTotal,
      totalDue,
      paid,
      balance: monthLeft,
      status,
      isOverdue,
    });
  }

  const currentBillingMonth = getCurrentBillingMonthForTenant(tenant);
  const allMonthKeys = [...monthData.keys()].sort();
  const overdueMonths = allMonthKeys.filter(
    (m) => monthData.get(m).status === "Overdue"
  );
  const nonOverdueMonths = allMonthKeys.filter(
    (m) => monthData.get(m).status !== "Overdue"
  );

  const displaySet = new Set(overdueMonths);
  displaySet.add(currentBillingMonth);
  const recentNonOverdue = nonOverdueMonths
    .filter((m) => m !== currentBillingMonth)
    .sort()
    .slice(-3);
  for (const m of recentNonOverdue) {
    if (displaySet.size >= 3) break;
    displaySet.add(m);
  }
  const displayMonths = allMonthKeys.filter((m) => displaySet.has(m));

  const cards = [];
  for (const month of displayMonths) {
    const d = monthData.get(month);
    if (!d) continue;

    const isPaidCard = d.status === "Paid";
    const cardBg = isPaidCard ? "#F0FDF4" : d.isOverdue ? "#FEF2F2" : "#F8FAFC";
    const borderColor = isPaidCard
      ? "#10B981"
      : d.isOverdue
      ? "#EF4444"
      : "#CBD5E1";
    // 🌟 brighter green badge for Paid
    const badgeBg = isPaidCard
      ? "#10B981"
      : d.isOverdue
      ? "#FEE2E2"
      : "#DBEAFE";
    const badgeColor = isPaidCard
      ? "#FFFFFF"
      : d.isOverdue
      ? "#991B1B"
      : "#1E40AF";
    const balanceColor = d.balance > 0 ? "#DC2626" : "#059669";
    const balanceText =
      d.balance <= 0 ? "Fully paid" : `KES ${d.balance.toLocaleString()}`;

    cards.push(`
      <div style="background:${cardBg}; border-radius:16px; padding:20px; margin-bottom:18px; border:1px solid ${borderColor}; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
          <span style="font-size:20px; font-weight:700; color:#0F172A;">${
            d.month
          }</span>
          <span style="display:inline-block; background:${badgeBg}; color:${badgeColor}; padding:6px 18px; border-radius:40px; font-weight:800; font-size:14px;">${
      d.status
    }</span>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; margin:0 auto; border-collapse:collapse; font-size:16px; color:#334155;">
          <tr>
            <td style="padding:8px 12px 8px 0; text-align:left; color:#64748B;">🏠 Rent</td>
            <td style="padding:8px 0; text-align:right; font-weight:500;">KES ${d.rentAmount.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px 8px 0; text-align:left; color:#64748B;">💰 Deposit</td>
            <td style="padding:8px 0; text-align:right; font-weight:500;">${
              d.depositInstalment > 0
                ? `KES ${d.depositInstalment.toLocaleString()}`
                : "—"
            }</td>
          </tr>
          <tr>
            <td style="padding:8px 12px 8px 0; text-align:left; color:#64748B;">💧 Water</td>
            <td style="padding:8px 0; text-align:right; font-weight:500;">KES ${d.waterCharge.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px 8px 0; text-align:left; color:#64748B;">🗑️ Garbage</td>
            <td style="padding:8px 0; text-align:right; font-weight:500;">KES ${d.garbageCharge.toLocaleString()}</td>
          </tr>
          ${
            d.extraTotal > 0
              ? `
          <tr>
            <td style="padding:8px 12px 8px 0; text-align:left; color:#64748B;">📌 Extra</td>
            <td style="padding:8px 0; text-align:right; font-weight:600; color:#D97706;">KES ${d.extraTotal.toLocaleString()}</td>
          </tr>`
              : ""
          }
          <tr><td colspan="2" style="padding:0; border-top:1px solid #E2E8F0;"></td></tr>
          <tr>
            <td style="padding:14px 12px 6px 0; text-align:left; font-weight:700; color:#0F172A;">Total Due</td>
            <td style="padding:14px 0 6px 0; text-align:right; font-weight:700; font-size:18px;">KES ${d.totalDue.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding:6px 12px 6px 0; text-align:left; color:#64748B;">Paid</td>
            <td style="padding:6px 0; text-align:right;">${
              d.paid > 0 ? `KES ${d.paid.toLocaleString()}` : "—"
            }</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:14px 0 0 0; text-align:center; font-weight:700; font-size:18px; color:${balanceColor};">
              Balance: ${balanceText}
            </td>
          </tr>
        </table>
      </div>
    `);
  }

  let note = "";
  if (overdue > 0) {
    note = `<div style="background:#FEF2F2; border-left:5px solid #DC2626; padding:18px 24px; border-radius:12px; margin-top:24px; text-align:center;">
              <p style="margin:0; font-size:20px; font-weight:800; color:#DC2626;">Total overdue: KES ${overdue.toLocaleString()}</p>
              <p style="margin:8px 0 0; font-size:15px; color:#991B1B;">Please arrange payment at your earliest convenience.</p>
            </div>`;
  } else if (credit > 0) {
    note = `<div style="background:#F0FDF4; border-left:5px solid #10B981; padding:18px 24px; border-radius:12px; margin-top:24px; text-align:center;">
              <p style="margin:0; font-size:20px; font-weight:800; color:#065F46;">You have a credit of KES ${credit.toLocaleString()}.</p>
              <p style="margin:8px 0 0; font-size:15px; color:#047857;">Thank you!</p>
            </div>`;
  } else {
    note = `<div style="background:#F0FDF4; border-left:5px solid #10B981; padding:18px 24px; border-radius:12px; margin-top:24px; text-align:center;">
              <p style="margin:0; font-size:20px; font-weight:800; color:#065F46;">All payments are up to date. Thank you!</p>
            </div>`;
  }

  const innerHtml = `
    <p style="font-size:17px; color:#1E293B; margin-bottom:6px; font-weight:500;">Dear ${escapeHtml(
      tenant.name
    )}${
    tenant.houseNumber ? ` (House ${escapeHtml(tenant.houseNumber)})` : ""
  },</p>
    <p style="font-size:16px; color:#475569; line-height:1.6; margin-bottom:24px;">Here is your detailed rent statement. Please review and arrange any outstanding payments.</p>

    <div style="max-width:600px; margin:0 auto;">
      ${cards.join("")}
    </div>

    ${note}

    <div style="background:#F8FAFC; border-left:4px solid #38BDF8; border-radius:8px; padding:16px 20px; margin-top:35px; text-align:center;">
      <p style="margin:0; font-size:14px; color:#1E293B; line-height:1.6;">
        <strong>Questions?</strong> Please contact your landlord.<br>
        Statement generated on ${today.toLocaleDateString()}.
      </p>
    </div>
  `;

  return wrapPremiumEmail(innerHtml, landlordName);
}
async function showEmailModal(tenantId) {
  // 🚫 Hard lock – immediately bail if any email operation is in progress
  if (window.individualEmailInProgress) return;
  window.individualEmailInProgress = true;

  const tenant = tenantArray.find((t) => t._id === tenantId);
  if (!tenant) {
    window.individualEmailInProgress = false;
    return;
  }

  if (!tenant.email) {
    Toast.fire({
      icon: "warning",
      title: "No email address",
      text: "Please add an email address for this tenant first.",
    });
    window.individualEmailInProgress = false;
    return;
  }

  const templates = {
    thanks: `Dear ${tenant.name},\nThank you for your payment. Have a great day!`,
    quickBalance: generateShortBalanceMessage(tenant),
    detailedBalance: generateDetailedBalanceHtml(
      tenant,
      userProfile.landlordName || userProfile.name || "Your Landlord"
    ),
    waterBill: generateWaterBillEmail(
      tenant,
      userProfile.landlordName || userProfile.name || "Landlord"
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
          <option value="waterBill">💧 Water Bill</option>
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
    showLoaderOnConfirm: true,
    preConfirm: async () => {
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
        } else if (val === "waterBill") {
          subjectInput.value = "Water Bill";
          bodyArea.value = templates.waterBill;
        } else if (val === "thanks") {
          subjectInput.value = "Thank You";
          bodyArea.value = templates.thanks;
        }
      });
    },
  });

  // User cancelled or closed the modal → release lock and exit
  if (!formValues) {
    window.individualEmailInProgress = false;
    return;
  }

  // 🔑 Generate a unique idempotency key for this send
  const idempotencyKey =
    Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

  // From here, a send will happen – lock remains true until the end
  const btn = document.getElementById("modal-send-email");
  setButtonLoading(btn, true);

  try {
    let subject = formValues.subject;
    let htmlMessage;

    const templateValue = document.getElementById("email-template").value;

    if (templateValue === "detailedBalance") {
      htmlMessage = formValues.message;
    } else if (templateValue === "waterBill") {
      htmlMessage = formValues.message;
    } else if (templateValue === "quickBalance") {
      const landlordName =
        userProfile.landlordName || userProfile.name || "Landlord";
      htmlMessage = wrapPremiumEmail(
        `<p style="font-size:16px; color:#1e293b; font-weight:500;">Dear ${escapeHtml(
          tenant.name
        )},</p>
         <div style="background:#f1f5f9; padding:20px; border-radius:12px; margin:20px 0; font-size:16px; color:#0f172a; line-height:1.6;">${escapeHtml(
           formValues.message
         )}</div>`,
        landlordName
      );
      subject = "Rent Balance";
    } else {
      const landlordName =
        userProfile.landlordName || userProfile.name || "Landlord";
      htmlMessage = wrapPremiumEmail(
        `<p style="font-size:16px; color:#1e293b; font-weight:500;">${escapeHtml(
          subject
        )}</p>
         <div style="font-size:15px; color:#475569; line-height:1.6; margin-top:20px;">${escapeHtml(
           formValues.message
         ).replace(/\n/g, "<br>")}</div>`,
        landlordName
      );
    }

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
          subject: subject,
          message: htmlMessage,
          idempotencyKey, // 🔑 added here
        }),
      },
      120000
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
      originalSwalFire.call(Swal, {
        toast: true,
        position: "bottom-end",
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true,
        background: "#1e293b",
        color: "#f1f5f9",
        icon: "error",
        title: data.message || "Failed to send",
      });
    }
  } catch (err) {
    Toast.fire({ icon: "error", title: err.message });
  } finally {
    setButtonLoading(btn, false);
    window.individualEmailInProgress = false;
  }
}

function showBulkEmailModal() {
  // 🚫 Only one bulk email operation at a time
  if (window.bulkEmailInProgress) return;
  window.bulkEmailInProgress = true;

  let tenants = [...tenantArray].filter((t) => t.email);
  if (tenants.length === 0) {
    Toast.fire({ icon: "warning", title: "No tenants with email addresses." });
    window.bulkEmailInProgress = false;
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
        <option value="waterBill">💧 Water Bill</option>
      </select>
      <input id="email-bulk-subject" class="swal2-input" placeholder="Subject" value="Rent Update" style="margin:0;">
      <textarea id="email-bulk-body" rows="5" placeholder="Type your message..." style="padding:10px;border-radius:10px;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border);width:100%;resize:vertical;"></textarea>
      <div id="email-bulk-note" style="display:none;background:rgba(6,182,212,0.1);border-left:3px solid var(--accent-cyan);padding:10px;border-radius:8px;color:var(--text-secondary);font-size:0.85rem;">
        Each tenant will receive a personalised balance email.
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-start; padding: 0 4px;">
        <button id="email-select-all" style="background: linear-gradient(135deg, #3b82f6, #2563eb); border: none; color: white; padding: 8px 20px; border-radius: 40px; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: 0.1s;">✓ Select All</button>
        <button id="email-select-late" style="background: linear-gradient(135deg, #f59e0b, #d97706); border: none; color: white; padding: 8px 20px; border-radius: 40px; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: 0.1s;">⚠️ Select Late</button>
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
      // ── Scroll fix for desktop ──
      const popup = Swal.getPopup();
      if (popup) {
        popup.style.maxHeight = "90vh";
        popup.style.overflow = "hidden";
        popup.style.display = "flex";
        popup.style.flexDirection = "column";
      }
      const htmlContainer = Swal.getHtmlContainer();
      if (htmlContainer) {
        htmlContainer.style.flex = "1";
        htmlContainer.style.overflowY = "auto";
      }
      const actions = Swal.getActions();
      if (actions) {
        actions.style.flexShrink = "0";
        actions.style.marginTop = "0";
        actions.style.padding =
          "12px 16px calc(30px + env(safe-area-inset-bottom, 20px)) 16px";
        actions.style.borderTop = "1px solid var(--border, #334155)";
        actions.style.background = "var(--bg-secondary, #0f172a)";
      }

      const selectAllBtn = document.getElementById("email-select-all");
      const selectLateBtn = document.getElementById("email-select-late");
      const checkboxes = () =>
        document.querySelectorAll(".email-tenant-select");

      if (selectAllBtn) {
        selectAllBtn.addEventListener("click", () => {
          const allCB = checkboxes();
          const allChecked = Array.from(allCB).every((cb) => cb.checked);
          const newState = !allChecked;
          allCB.forEach((cb) => {
            cb.checked = newState;
          });
          selectAllBtn.textContent = newState
            ? "✕ Deselect All"
            : "✓ Select All";
        });
      }
      if (selectLateBtn) {
        selectLateBtn.addEventListener("click", () => {
          const allCB = checkboxes();
          const overdueCbs = Array.from(allCB).filter((cb) => {
            const tenant = tenants.find((t) => t._id === cb.dataset.id);
            return tenant && getTenantPastDueAmount(tenant, getAppToday()) > 0;
          });
          const allOverdueChecked = overdueCbs.every((cb) => cb.checked);
          const newState = !allOverdueChecked;
          overdueCbs.forEach((cb) => {
            cb.checked = newState;
          });
          selectLateBtn.textContent = newState
            ? "✕ Deselect Late"
            : "⚠️ Select Late";
        });
      }

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
        } else if (val === "detailedBalance" || val === "waterBill") {
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
        isWaterBillMode: templateValue === "waterBill",
      };
    },
  }).then(async (result) => {
    if (!result.isConfirmed) {
      window.bulkEmailInProgress = false;
      return;
    }
    const {
      tenantIds,
      subject,
      message,
      isBalanceMode,
      isDetailed,
      isWaterBillMode,
    } = result.value;

    const btn = document.getElementById("bulk-email-btn");
    setButtonLoading(btn, true);

    // 🔑 Generate ONE unique idempotency key for this entire batch
    const idempotencyKey =
      Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    try {
      let summary = "";
      const landlordName =
        userProfile.landlordName || userProfile.name || "Landlord";

      if (isBalanceMode) {
        const selectedTenants = tenants.filter((t) =>
          tenantIds.includes(t._id)
        );
        let successCount = 0;
        const failedNames = [];
        const BATCH_SIZE = 5;
        for (let i = 0; i < selectedTenants.length; i += BATCH_SIZE) {
          const batch = selectedTenants.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.allSettled(
            batch.map(async (tenant) => {
              const personalisedMsg = generateShortBalanceMessage(tenant);
              const htmlMsg = wrapPremiumEmail(
                `<p style="font-size:16px; color:#1e293b; font-weight:500;">Dear ${escapeHtml(
                  tenant.name
                )},</p>
                 <div style="background:#f1f5f9; padding:20px; border-radius:12px; margin:20px 0; font-size:16px; color:#0f172a; line-height:1.6;">${escapeHtml(
                   personalisedMsg
                 )}</div>`,
                landlordName
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
                      subject: "Rent Balance",
                      message: htmlMsg,
                      idempotencyKey, // 🔑
                    }),
                  },
                  120000
                );
                const data = await res.json();
                return {
                  tenant: tenant.name,
                  success: data.results?.[0]?.success,
                };
              } catch (err) {
                return { tenant: tenant.name, success: false };
              }
            })
          );
          for (const res of batchResults) {
            if (res.status === "fulfilled") {
              if (res.value.success) successCount++;
              else failedNames.push(res.value.tenant);
            } else {
              failedNames.push("unknown");
            }
          }
        }
        summary = `Sent to ${successCount} tenant(s).`;
        if (failedNames.length)
          summary += ` Failed for: ${failedNames.join(", ")}.`;
      } else if (isDetailed) {
        const selectedTenants = tenants.filter((t) =>
          tenantIds.includes(t._id)
        );
        let successCount = 0;
        const failedNames = [];
        const BATCH_SIZE = 5;
        for (let i = 0; i < selectedTenants.length; i += BATCH_SIZE) {
          const batch = selectedTenants.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.allSettled(
            batch.map(async (tenant) => {
              const personalisedMsg = generateDetailedBalanceHtml(
                tenant,
                landlordName
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
                      idempotencyKey, // 🔑
                    }),
                  },
                  120000
                );
                const data = await res.json();
                return {
                  tenant: tenant.name,
                  success: data.results?.[0]?.success,
                };
              } catch (err) {
                return { tenant: tenant.name, success: false };
              }
            })
          );
          for (const res of batchResults) {
            if (res.status === "fulfilled") {
              if (res.value.success) successCount++;
              else failedNames.push(res.value.tenant);
            } else {
              failedNames.push("unknown");
            }
          }
        }
        summary = `Sent to ${successCount} tenant(s).`;
        if (failedNames.length)
          summary += ` Failed for: ${failedNames.join(", ")}.`;
      } else if (isWaterBillMode) {
        const selectedTenants = tenants.filter((t) =>
          tenantIds.includes(t._id)
        );
        let successCount = 0;
        const failedNames = [];
        const BATCH_SIZE = 5;
        for (let i = 0; i < selectedTenants.length; i += BATCH_SIZE) {
          const batch = selectedTenants.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.allSettled(
            batch.map(async (tenant) => {
              const personalisedMsg = generateWaterBillEmail(
                tenant,
                landlordName
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
                      subject: "Water Bill",
                      message: personalisedMsg,
                      idempotencyKey, // 🔑
                    }),
                  },
                  120000
                );
                const data = await res.json();
                return {
                  tenant: tenant.name,
                  success: data.results?.[0]?.success,
                };
              } catch (err) {
                return { tenant: tenant.name, success: false };
              }
            })
          );
          for (const res of batchResults) {
            if (res.status === "fulfilled") {
              if (res.value.success) successCount++;
              else failedNames.push(res.value.tenant);
            } else {
              failedNames.push("unknown");
            }
          }
        }
        summary = `Sent to ${successCount} tenant(s).`;
        if (failedNames.length)
          summary += ` Failed for: ${failedNames.join(", ")}.`;
      } else {
        const htmlMessage = wrapPremiumEmail(
          `<p style="font-size:16px; color:#1e293b; font-weight:500;">${escapeHtml(
            subject
          )}</p>
           <div style="font-size:15px; color:#475569; line-height:1.6; margin-top:20px;">${escapeHtml(
             message
           ).replace(/\n/g, "<br>")}</div>`,
          landlordName
        );
        const response = await fetchWithTimeout(
          window.location.origin + "/tenants/send-emails",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({
              tenantIds,
              subject,
              message: htmlMessage,
              idempotencyKey, // 🔑
            }),
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
      setTimeout(() => {
        window.bulkEmailInProgress = false;
      }, 300);
    }
  });
}
// ----- EMAIL LOGS MODAL -----
function showEmailLogsModal() {
  Swal.fire({
    html: '<div style="text-align:center;padding:20px;">Loading...</div>',
    showCloseButton: true,
    showConfirmButton: false,
    background: "transparent",
    width: "auto",
    customClass: {
      popup: "sms-logs-perfect",
      closeButton: "sms-logs-perfect-close",
    },
    didOpen: async () => {
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
        .status-badge.failed { background: #ef444420; color: #ef4444; }

        .sms-group-header td {
          background: #1e293b;
          color: #94a3b8;
          font-weight: 700;
          font-size: 0.8rem;
          padding: 8px 12px;
          text-align: left;
          border-bottom: 1px solid #334155;
        }

        #clear-email-logs-btn:hover {
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

      try {
        const response = await fetchWithTimeout("/tenants/email-logs", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });
        if (!response.ok) throw new Error("Failed to fetch email logs");
        let logs = await response.json();

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
              const shortSubject =
                log.subject && log.subject.length > 40
                  ? log.subject.substring(0, 40) + "…"
                  : log.subject || "(no subject)";
              tableRows += `
                <tr>
                  <td>${escapeHtml(log.tenantName)}</td>
                  <td>${escapeHtml(log.email)}</td>
                  <td class="msg-cell">${escapeHtml(shortSubject)}</td>
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
          clearBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();

            if (!confirm("Clear all email logs? This cannot be undone."))
              return;

            try {
              await fetchWithTimeout("/tenants/email-logs", {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${localStorage.getItem("token")}`,
                },
              });
            } catch (err) {
              Toast.fire({ icon: "error", title: "Failed to clear logs" });
              return;
            }

            try {
              const response = await fetchWithTimeout("/tenants/email-logs", {
                headers: {
                  Authorization: `Bearer ${localStorage.getItem("token")}`,
                },
              });
              if (!response.ok) throw new Error("Failed to fetch new logs");
              let logs = await response.json();

              logs.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const yesterday = new Date(today);
              yesterday.setDate(yesterday.getDate() - 1);
              const groups = [];
              let currentLabel = "",
                currentGroup = [];
              for (const log of logs) {
                const d = new Date(log.sentAt);
                d.setHours(0, 0, 0, 0);
                let label =
                  d.getTime() === today.getTime()
                    ? "Today"
                    : d.getTime() === yesterday.getTime()
                    ? "Yesterday"
                    : d.toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      });
                if (label !== currentLabel) {
                  if (currentGroup.length)
                    groups.push({ label: currentLabel, logs: currentGroup });
                  currentLabel = label;
                  currentGroup = [log];
                } else currentGroup.push(log);
              }
              if (currentGroup.length)
                groups.push({ label: currentLabel, logs: currentGroup });

              let tableRows =
                groups.length === 0
                  ? `<tr><td colspan="5" style="text-align:center;padding:40px;">📭 No email logs found</td></tr>`
                  : groups
                      .map(
                        (g) => `
          <tr class="sms-group-header"><td colspan="5">${g.label}</td></tr>
          ${g.logs
            .map((log) => {
              const time = new Date(log.sentAt).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              });
              const shortSubj =
                log.subject && log.subject.length > 40
                  ? log.subject.substring(0, 40) + "…"
                  : log.subject || "(no subject)";
              return `<tr>
              <td>${escapeHtml(log.tenantName)}</td>
              <td>${escapeHtml(log.email)}</td>
              <td class="msg-cell">${escapeHtml(shortSubj)}</td>
              <td><span class="status-badge ${log.status}">${
                log.status
              }</span></td>
              <td>${time}</td>
            </tr>`;
            })
            .join("")}
        `
                      )
                      .join("");

              const tableBody = document.querySelector(".sms-logs-table tbody");
              if (tableBody) tableBody.innerHTML = tableRows;
              Toast.fire({ icon: "success", title: "Logs cleared" });
            } catch (err) {
              Toast.fire({ icon: "error", title: "Failed to refresh logs" });
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

  // ---- Build the HTML (unchanged, custom buttons at the end) ----
  let html = `
  <div style="display: flex; flex-direction: column; gap: 16px;">
    <div>
      <select id="sms-template-bulk" style="width: 100%; padding: 10px; border-radius: 40px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); margin-bottom: 8px;">
        <option value="custom">✏️ Custom message</option>
        <option value="thanks">🙏 Thank you (after payment)</option>
        <option value="quickBalance">⚡ Quick Balance (short)</option>
        <option value="waterBill">💧 Water Bill</option>
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
          <thead class="sms-sticky-header">
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

    <!-- CUSTOM BUTTONS at the bottom of the scrollable content -->
    <div style="display:flex; justify-content:center; gap:16px; margin-top:20px; padding-bottom:calc(30px + env(safe-area-inset-bottom, 20px));">
      <button id="custom-sms-cancel-btn" style="background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border: none; padding: 12px 28px; border-radius: 40px; font-size: 1rem; font-weight: 600; cursor: pointer;">Cancel</button>
      <button id="custom-sms-send-btn" style="background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; padding: 12px 28px; border-radius: 40px; font-size: 1rem; font-weight: 600; cursor: pointer;">Send</button>
    </div>
  </div>
  `;

  // ── FIX: custom buttons, full‑screen, content starts at top ──
  Swal.fire({
    title: "📱 Send SMS to Tenants",
    html: html,
    showCancelButton: false, // we use custom buttons
    showConfirmButton: false,
    showCloseButton: true,
    background: "#1e293b",
    color: "#f1f5f9",
    width: "90%",
    customClass: { popup: "sms-bulk-fixed" },
    didOpen: () => {
      // ── Force the popup to fill the viewport and scroll as one page ──
      const popup = Swal.getPopup();
      if (popup) {
        popup.style.position = "fixed";
        popup.style.top = "0";
        popup.style.left = "0";
        popup.style.width = "100%";
        popup.style.height = "100%";
        popup.style.maxHeight = "100vh";
        popup.style.margin = "0";
        popup.style.borderRadius = "0";
        popup.style.transform = "none";
        popup.style.display = "flex";
        popup.style.flexDirection = "column";
        popup.style.overflow = "hidden";
      }
      const htmlContainer = Swal.getHtmlContainer();
      if (htmlContainer) {
        htmlContainer.style.flex = "1";
        htmlContainer.style.overflowY = "auto";
        // 🔥 CRITICAL: override the global centering that hides the top content
        htmlContainer.style.alignItems = "flex-start";
        htmlContainer.style.justifyContent = "flex-start";
        htmlContainer.style.padding = "8px 16px";
        htmlContainer.scrollTop = 0;
      }

      // Bind custom buttons
      document
        .getElementById("custom-sms-cancel-btn")
        ?.addEventListener("click", () => Swal.close());
      document
        .getElementById("custom-sms-send-btn")
        ?.addEventListener("click", () => Swal.clickConfirm());

      // ── Sticky table header ──
      const stickyStyle = document.createElement("style");
      stickyStyle.textContent = `
        .sms-sticky-header th {
          position: sticky;
          top: 0;
          background: var(--bg-elevated, #1e293b);
          z-index: 2;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
      `;
      document.head.appendChild(stickyStyle);
      const smsTable = document.querySelector(".sms-bulk-fixed table");
      if (smsTable) {
        const thead = smsTable.querySelector("thead");
        if (thead) thead.classList.add("sms-sticky-header");
      }

      // ── All your existing event listeners (unchanged) ──
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
            } else if (val === "waterBill") {
              msgTextarea.value = "";
            } else if (val === "reminder") {
              newMsg =
                "Reminder: Rent is due on the scheduled date. Please pay on time to avoid penalties.";
            } else if (val === "late") {
              newMsg =
                "URGENT: Your rent payment is past due. Please clear the outstanding amount immediately to avoid penalties.";
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
          let note = isBalanceMode
            ? `<span style="color:#fbbf24; font-size:0.75rem;">(Balance enquiries may cost more for long messages)</span>`
            : "";
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
      const isWaterBillMode = templateValue === "waterBill";

      if (selected.length === 0) {
        Swal.showValidationMessage("Select at least one tenant.");
        return false;
      }
      if (!isBalanceMode && !isWaterBillMode && !message.trim()) {
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
            isBalanceMode || isWaterBillMode
              ? "Each tenant will receive a personalised message."
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
      return { tenantIds: selected, message, isBalanceMode, isWaterBillMode };
    },
  }).then(async (result) => {
    if (result.isConfirmed) {
      const { tenantIds, message, isBalanceMode, isWaterBillMode } =
        result.value;

      setButtonLoading(btn, true);
      try {
        let summary = "";
        // ========== FIX: batched sending for balance mode ==========
        if (isBalanceMode) {
          const selectedTenants = tenants.filter((t) =>
            tenantIds.includes(t._id)
          );
          let successCount = 0;
          const failedNames = [];
          const BATCH_SIZE = 5;

          for (let i = 0; i < selectedTenants.length; i += BATCH_SIZE) {
            const batch = selectedTenants.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.allSettled(
              batch.map(async (tenant) => {
                const personalisedMsg = generateShortBalanceMessage(tenant);
                try {
                  const res = await fetchWithTimeout(
                    window.location.origin + "/tenants/send-sms",
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${localStorage.getItem(
                          "token"
                        )}`,
                      },
                      body: JSON.stringify({
                        tenantIds: [tenant._id],
                        message: personalisedMsg,
                      }),
                    }
                  );
                  const data = await res.json();
                  return {
                    tenant: tenant.name,
                    success: data.results?.[0]?.success,
                  };
                } catch (err) {
                  return { tenant: tenant.name, success: false };
                }
              })
            );

            for (const res of batchResults) {
              if (res.status === "fulfilled") {
                if (res.value.success) successCount++;
                else failedNames.push(res.value.tenant);
              } else {
                failedNames.push("unknown");
              }
            }
          }
          summary = `Sent to ${successCount} tenant(s).`;
          if (failedNames.length)
            summary += ` Failed for: ${failedNames.join(", ")}.`;
        }
        // ========== FIX: batched sending for water bill mode ==========
        else if (isWaterBillMode) {
          const selectedTenants = tenants.filter((t) =>
            tenantIds.includes(t._id)
          );
          let successCount = 0;
          const failedNames = [];
          const BATCH_SIZE = 5;

          for (let i = 0; i < selectedTenants.length; i += BATCH_SIZE) {
            const batch = selectedTenants.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.allSettled(
              batch.map(async (tenant) => {
                const personalisedMsg = generateWaterBillSms(tenant);
                try {
                  const res = await fetchWithTimeout(
                    window.location.origin + "/tenants/send-sms",
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${localStorage.getItem(
                          "token"
                        )}`,
                      },
                      body: JSON.stringify({
                        tenantIds: [tenant._id],
                        message: personalisedMsg,
                      }),
                    }
                  );
                  const data = await res.json();
                  return {
                    tenant: tenant.name,
                    success: data.results?.[0]?.success,
                  };
                } catch (err) {
                  return { tenant: tenant.name, success: false };
                }
              })
            );

            for (const res of batchResults) {
              if (res.status === "fulfilled") {
                if (res.value.success) successCount++;
                else failedNames.push(res.value.tenant);
              } else {
                failedNames.push("unknown");
              }
            }
          }
          summary = `Sent to ${successCount} tenant(s).`;
          if (failedNames.length)
            summary += ` Failed for: ${failedNames.join(", ")}.`;
        }
        // ========== standard custom message (unchanged) ==========
        else {
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

const bulkEmailBtn = document.getElementById("bulk-email-btn");
if (bulkEmailBtn) {
  // Remove any existing listener to prevent duplicates
  bulkEmailBtn.replaceWith(bulkEmailBtn.cloneNode(true));
  // Re‑attach exactly once
  document.getElementById("bulk-email-btn").addEventListener("click", () => {
    showBulkEmailModal();
  });
}

async function showBulkEditTenantsModal() {
  closeDropdownIfOpen();
  const tenants = [...tenantArray].filter((t) => t.active !== false);
  if (tenants.length === 0) {
    Toast.fire({ icon: "warning", title: "No active tenants." });
    return;
  }

  // Helpers
  function getCurrentTenantData() {
    const data = [];
    const rows = document.querySelectorAll(".bulk-edit-row");
    rows.forEach((row) => {
      const id = row.dataset.tenantId;
      data.push({
        _id: id,
        name: row.querySelector(".bulk-edit-name")?.value.trim() || "",
        houseNumber: row.querySelector(".bulk-edit-house")?.value.trim() || "",
        phoneNumber: row.querySelector(".bulk-edit-phone")?.value.trim() || "",
        email: row.querySelector(".bulk-edit-email")?.value.trim() || "",
      });
    });
    return data;
  }

  function checkDuplicates() {
    const current = getCurrentTenantData();
    const nameSet = new Map();
    const houseSet = new Map();
    current.forEach((t, idx) => {
      const name = t.name.toLowerCase();
      const house = t.houseNumber.toLowerCase();
      const nameConflict = tenantArray.some(
        (et) => et._id !== t._id && et.name.toLowerCase() === name
      );
      const houseConflict = tenantArray.some(
        (et) =>
          et._id !== t._id && (et.houseNumber || "").toLowerCase() === house
      );
      const nameDup = [...nameSet.entries()].find(
        ([n, i]) => n === name && i !== idx
      );
      const houseDup = [...houseSet.entries()].find(
        ([h, i]) => h === house && i !== idx
      );

      nameSet.set(name, idx);
      houseSet.set(house, idx);

      const row = document.querySelector(
        `.bulk-edit-row[data-tenant-id="${t._id}"]`
      );
      if (row) {
        const nameEl = row.querySelector(".bulk-edit-name");
        const houseEl = row.querySelector(".bulk-edit-house");
        nameEl.style.borderColor = nameConflict || nameDup ? "#ef4444" : "";
        houseEl.style.borderColor = houseConflict || houseDup ? "#ef4444" : "";
      }
    });
  }

  function renderEditableTable() {
    let html = "";
    tenants.forEach((tenant) => {
      html += `
        <tr class="bulk-edit-row" data-tenant-id="${tenant._id}">
          <td><input type="text" class="bulk-edit-name" value="${escapeHtml(
            tenant.name
          )}"></td>
          <td><input type="text" class="bulk-edit-house" value="${escapeHtml(
            tenant.houseNumber || ""
          )}"></td>
          <td><input type="tel" class="bulk-edit-phone" value="${escapeHtml(
            tenant.phoneNumber || ""
          )}"></td>
          <td><input type="email" class="bulk-edit-email" value="${escapeHtml(
            tenant.email || ""
          )}"></td>
        </tr>`;
    });
    return html;
  }

  const styleTag = document.createElement("style");
  styleTag.textContent = `
    .bulk-payment-fullscreen .swal2-html-container { padding: 8px 0 !important; overflow-x: hidden; }
    .bulk-edit-table { width: 100%; border-collapse: collapse; }
    .bulk-edit-table th { background: var(--bg-elevated); color: var(--accent-cyan); padding: 10px 4px; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; position: sticky; top: 0; z-index: 2; }
    .bulk-edit-table td { padding: 6px 2px; }
    .bulk-edit-name, .bulk-edit-house, .bulk-edit-phone, .bulk-edit-email { width: 100%; padding: 12px 6px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-deep); color: var(--text-primary); text-align: center; font-size: 1rem; box-sizing: border-box; }
    @media (min-width: 601px) { .bulk-edit-name, .bulk-edit-house, .bulk-edit-phone, .bulk-edit-email { max-width: 160px; } }
    @media (max-width: 600px) { .bulk-edit-name, .bulk-edit-house, .bulk-edit-phone, .bulk-edit-email { max-width: none; padding: 14px 8px; font-size: 1rem; } .bulk-edit-table th, .bulk-edit-table td { padding: 8px 2px; } }
    #bulk-edit-cancel-btn, #bulk-edit-save-btn { padding: 10px 24px; border-radius: 40px; font-size: 1rem; font-weight: 600; cursor: pointer; border: none; color: white; }
    #bulk-edit-cancel-btn { background: #ef4444; }
    #bulk-edit-save-btn { background: #10b981; }
    .bulk-edit-confirm-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 10001; align-items: center; justify-content: center; }
    .bulk-edit-confirm-overlay.show { display: flex; }
    .bulk-edit-confirm-box { background: var(--bg-surface, #1e293b); border-radius: 24px; padding: 24px; max-width: 500px; width: 90%; text-align: center; border: 1px solid var(--border, #334155); box-shadow: 0 20px 40px rgba(0,0,0,0.5); color: #f1f5f9; }
    .bulk-edit-confirm-box .changes-list { text-align: left; max-height: 200px; overflow-y: auto; font-size: 0.9rem; color: #cbd5e1; margin-bottom: 20px; }
    .bulk-edit-confirm-box .change-item { margin-bottom: 8px; background: rgba(59,130,246,0.1); padding: 8px; border-radius: 8px; }
    .bulk-edit-confirm-box .change-item strong { color: #f1f5f9; }
    .bulk-edit-confirm-box .change-item span.green { color: #10b981; }
  `;
  document.head.appendChild(styleTag);

  const modalHtml = `
    <div style="display:flex; flex-direction:column; gap:16px; height:100%;">
      <p style="text-align:center; color:var(--text-muted); font-size:0.9rem;">Edit any field. Duplicate names/house numbers will be highlighted in red.</p>
      <div style="overflow-x:auto; border:1px solid var(--border); border-radius:12px; flex:1;">
        <table class="bulk-edit-table">
          <thead><tr><th>Name</th><th>House</th><th>Phone</th><th>Email</th></tr></thead>
          <tbody id="bulk-edit-tbody">${renderEditableTable()}</tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:center; gap:14px; padding:12px 0;">
        <button type="button" id="bulk-edit-cancel-btn">Cancel</button>
        <button type="button" id="bulk-edit-save-btn">💾 Save All</button>
      </div>
      <!-- Confirmation overlay – inside the Swal content -->
      <div id="bulk-edit-confirm-overlay" class="bulk-edit-confirm-overlay">
        <div class="bulk-edit-confirm-box">
          <h3 style="margin-bottom:16px;">Confirm Changes</h3>
          <div id="bulk-edit-changes-list" class="changes-list"></div>
          <div style="display:flex; justify-content:center; gap:14px; margin-top:20px;">
            <button id="bulk-edit-confirm-cancel-btn" style="background:#ef4444; color:white; border:none; padding:10px 24px; border-radius:40px; font-weight:600; cursor:pointer;">Cancel</button>
            <button id="bulk-edit-confirm-yes-btn" style="background:#10b981; color:white; border:none; padding:10px 24px; border-radius:40px; font-weight:600; cursor:pointer;">Yes, save all</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const swalInstance = originalSwalFire.call(Swal, {
    title: "✏️ Bulk Edit Tenants",
    html: modalHtml,
    showCancelButton: false,
    showConfirmButton: false,
    showCloseButton: true,
    allowOutsideClick: false,
    allowEscapeKey: false,
    background: "#1e293b",
    color: "#f1f5f9",
    width: "100%",
    grow: "fullscreen",
    customClass: { popup: "bulk-payment-fullscreen" },
    didOpen: () => {
      const htmlContainer = Swal.getHtmlContainer();
      // Store references to overlay elements inside the html container
      const overlay = htmlContainer.querySelector("#bulk-edit-confirm-overlay");
      const changesList = htmlContainer.querySelector(
        "#bulk-edit-changes-list"
      );
      const cancelConfirmBtn = htmlContainer.querySelector(
        "#bulk-edit-confirm-cancel-btn"
      );
      const yesConfirmBtn = htmlContainer.querySelector(
        "#bulk-edit-confirm-yes-btn"
      );

      // Full‑screen layout
      const popup = Swal.getPopup();
      if (popup) {
        popup.style.position = "fixed";
        popup.style.top = "0";
        popup.style.left = "0";
        popup.style.width = "100%";
        popup.style.height = "100%";
        popup.style.maxHeight = "100vh";
        popup.style.margin = "0";
        popup.style.borderRadius = "0";
        popup.style.transform = "none";
        popup.style.display = "flex";
        popup.style.flexDirection = "column";
        popup.style.overflow = "auto";
      }
      if (htmlContainer) {
        htmlContainer.style.flex = "1";
        htmlContainer.style.overflowY = "auto";
        htmlContainer.style.maxHeight = "none";
      }

      // Attach live validation
      document
        .querySelectorAll(
          ".bulk-edit-name, .bulk-edit-house, .bulk-edit-phone, .bulk-edit-email"
        )
        .forEach((inp) => inp.addEventListener("input", checkDuplicates));

      // Cancel button
      document
        .getElementById("bulk-edit-cancel-btn")
        .addEventListener("click", () => Swal.close());

      // Save button – show overlay
      document
        .getElementById("bulk-edit-save-btn")
        .addEventListener("click", () => {
          checkDuplicates();
          const currentData = getCurrentTenantData();
          const changes = [];
          currentData.forEach((t) => {
            const original = tenantArray.find((ot) => ot._id === t._id);
            if (!original) return;
            const updates = {};
            if (t.name !== original.name) updates.name = t.name;
            if (t.houseNumber !== (original.houseNumber || ""))
              updates.houseNumber = t.houseNumber;
            if (t.phoneNumber !== (original.phoneNumber || ""))
              updates.phoneNumber = t.phoneNumber;
            if (t.email !== (original.email || "")) updates.email = t.email;
            if (Object.keys(updates).length > 0) {
              changes.push({
                _id: t._id,
                ...updates,
                originalName: original.name,
                originalHouse: original.houseNumber || "—",
              });
            }
          });

          if (changes.length === 0) {
            Toast.fire({ icon: "info", title: "No changes detected." });
            return;
          }

          changesList.innerHTML = changes
            .map(
              (c) => `
          <div class="change-item">
            <strong>${escapeHtml(c.originalName)}</strong> (${escapeHtml(
                c.originalHouse
              )})<br>
            ${
              c.name
                ? `→ Name: <span class="green">${escapeHtml(c.name)}</span><br>`
                : ""
            }
            ${
              c.houseNumber
                ? `→ House: <span class="green">${escapeHtml(
                    c.houseNumber
                  )}</span><br>`
                : ""
            }
            ${
              c.phoneNumber
                ? `→ Phone: <span class="green">${escapeHtml(
                    c.phoneNumber
                  )}</span><br>`
                : ""
            }
            ${
              c.email
                ? `→ Email: <span class="green">${escapeHtml(
                    c.email
                  )}</span><br>`
                : ""
            }
          </div>
        `
            )
            .join("");

          overlay.classList.add("show");
          window.__bulkEditChanges = changes;
        });

      // Overlay buttons
      cancelConfirmBtn.addEventListener("click", () => {
        overlay.classList.remove("show");
        window.__bulkEditChanges = null;
      });

      yesConfirmBtn.addEventListener("click", async () => {
        const changes = window.__bulkEditChanges;
        if (!changes) return;

        const saveBtn = document.getElementById("bulk-edit-save-btn");
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = `<span class="custom-loader" style="margin-right:8px;"></span> Saving...`;
        saveBtn.disabled = true;

        try {
          const response = await fetchWithTimeout(
            "/tenants/bulk-edit",
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              },
              body: JSON.stringify({ tenants: changes }),
            },
            120000
          );
          const data = await response.json();

          if (response.ok) {
            await loadTenants();
            scheduleChartUpdate();
            let msg = `Updated ${data.updated} tenant(s).`;
            if (data.errors?.length)
              msg += ` Skipped: ${data.errors
                .map((e) => e.message)
                .join(", ")}.`;
            originalSwalFire.call(Swal, {
              toast: true,
              position: "bottom-end",
              showConfirmButton: false,
              timer: 4000,
              timerProgressBar: true,
              background: "#1e293b",
              color: "#f1f5f9",
              icon: "success",
              title: msg,
            });

            // ✅ FIX: guard against missing tbody
            const tbody = document.getElementById("bulk-edit-tbody");
            if (tbody) {
              tbody.innerHTML = renderEditableTable();
              document
                .querySelectorAll(
                  ".bulk-edit-name, .bulk-edit-house, .bulk-edit-phone, .bulk-edit-email"
                )
                .forEach((inp) =>
                  inp.addEventListener("input", checkDuplicates)
                );
            }
          } else {
            Toast.fire({ icon: "error", title: data.message || "Save failed" });
          }
        } catch (err) {
          Toast.fire({ icon: "error", title: err.message });
        } finally {
          saveBtn.innerHTML = originalText;
          saveBtn.disabled = false;
          overlay.classList.remove("show");
          window.__bulkEditChanges = null;
        }
      });
    },
    willClose: () => {
      styleTag.remove();
    },
  });

  return swalInstance;
}

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
          // Inject the premium styles
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
            clearBtn.addEventListener("click", async (e) => {
              e.stopPropagation();
              e.stopImmediatePropagation();

              // Use browser confirm dialog – simple and reliable
              if (!confirm("Clear all SMS logs? This cannot be undone."))
                return;

              try {
                await fetchWithTimeout("/tenants/sms-logs", {
                  method: "DELETE",
                  headers: {
                    Authorization: `Bearer ${localStorage.getItem("token")}`,
                  },
                });
              } catch (err) {
                Toast.fire({ icon: "error", title: "Failed to clear logs" });
                return;
              }

              // Refresh the logs table without closing the modal
              try {
                const response = await fetchWithTimeout("/tenants/sms-logs", {
                  headers: {
                    Authorization: `Bearer ${localStorage.getItem("token")}`,
                  },
                });
                if (!response.ok) throw new Error("Failed to fetch new logs");
                let logs = await response.json();

                logs.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));

                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                const groups = [];
                let currentLabel = "",
                  currentGroup = [];
                for (const log of logs) {
                  const d = new Date(log.sentAt);
                  d.setHours(0, 0, 0, 0);
                  let label =
                    d.getTime() === today.getTime()
                      ? "Today"
                      : d.getTime() === yesterday.getTime()
                      ? "Yesterday"
                      : d.toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        });
                  if (label !== currentLabel) {
                    if (currentGroup.length)
                      groups.push({ label: currentLabel, logs: currentGroup });
                    currentLabel = label;
                    currentGroup = [log];
                  } else currentGroup.push(log);
                }
                if (currentGroup.length)
                  groups.push({ label: currentLabel, logs: currentGroup });

                let tableRows =
                  groups.length === 0
                    ? `<tr><td colspan="5" style="text-align:center;padding:40px;">📭 No SMS logs found</td></tr>`
                    : groups
                        .map(
                          (g) => `
          <tr class="sms-group-header"><td colspan="5">${g.label}</td></tr>
          ${g.logs
            .map((log) => {
              const time = new Date(log.sentAt).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              });
              const shortMsg =
                log.message.length > 50
                  ? log.message.substring(0, 50) + "…"
                  : log.message;
              return `<tr>
              <td>${escapeHtml(log.tenantName)}</td>
              <td>${escapeHtml(log.phoneNumber)}</td>
              <td class="msg-cell">${escapeHtml(shortMsg)}</td>
              <td><span class="status-badge ${log.status}">${
                log.status
              }</span></td>
              <td>${time}</td>
            </tr>`;
            })
            .join("")}
        `
                        )
                        .join("");

                const tableBody = document.querySelector(
                  ".sms-logs-table tbody"
                );
                if (tableBody) tableBody.innerHTML = tableRows;
                Toast.fire({ icon: "success", title: "Logs cleared" });
              } catch (err) {
                Toast.fire({ icon: "error", title: "Failed to refresh logs" });
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

// Helper to safely close the dropdown before opening a modal
function closeDropdownIfOpen() {
  const dropdown = document.getElementById("topbar-menu-dropdown");
  if (dropdown && dropdown.style.display !== "none") {
    dropdown.style.display = "none";
    isDropdownOpen = false;
    const menuBtn = document.getElementById("topbar-menu-btn");
    if (menuBtn) menuBtn.blur();

    // Remove the dropdown's history entry safely
    window.ignoreNextPopstate = true; // <-- prevents the popstate handler from firing
    popModalState(); // <-- pops the dropdown's entry
  }
}

// Topbar menu toggle
const menuBtn = document.getElementById("topbar-menu-btn");
const menuDropdown = document.getElementById("topbar-menu-dropdown");

if (menuBtn && menuDropdown) {
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden =
      menuDropdown.style.display === "none" ||
      menuDropdown.style.display === "";
    if (isHidden) {
      menuDropdown.style.display = "flex";
      pushModalState();
      isDropdownOpen = true;
    } else {
      menuDropdown.style.display = "none";
      popModalState();
      isDropdownOpen = false;
      menuBtn.blur(); // ← removes the focus highlight
    }
  });

  document.addEventListener("click", (e) => {
    if (!menuBtn.contains(e.target) && !menuDropdown.contains(e.target)) {
      if (menuDropdown.style.display !== "none") {
        menuDropdown.style.display = "none";
        popModalState();
        isDropdownOpen = false;
        menuBtn.blur(); // ← removes the focus highlight
      }
    }
  });
}

// ========================
// BACK BUTTON PROTECTION (final – no infinite loop)
// ========================
let modalOpenCount = 0;
let isDropdownOpen = false;
let backButtonClosing = false; // prevents recursive popstate
let lastModalOpenTime = 0;

function pushModalState() {
  window.history.pushState({ modal: true }, "");
  modalOpenCount++;
  lastModalOpenTime = Date.now();
}

function popModalState() {
  if (modalOpenCount > 0) {
    window.history.back();
    modalOpenCount--;
  }
}

window.addEventListener("popstate", (event) => {
  // Ignore popstate if a modal is being replaced (e.g., after clearing logs)
  if (window.ignoreNextPopstate) {
    window.ignoreNextPopstate = false;
    return;
  }

  // 1. Close any open SweetAlert2 modal
  if (Swal.isVisible()) {
    backButtonClosing = true;
    Swal.close();
    backButtonClosing = false;
  }

  // 2. Close the topbar dropdown if open
  const dropdown = document.getElementById("topbar-menu-dropdown");
  if (dropdown && dropdown.style.display !== "none") {
    dropdown.style.display = "none";
    isDropdownOpen = false;
  }

  // 3. Close all custom modals
  const overlay = document.getElementById("modal-overlay");
  [
    "tenant-actions-modal",
    "profile-modal",
    "payment-modal",
    "utilities-modal",
  ].forEach((id) => {
    const m = document.getElementById(id);
    if (m) m.style.display = "none";
  });
  if (window._closeGlobalSettingsModal) window._closeGlobalSettingsModal();
  if (overlay) overlay.style.display = "none";
  document.body.classList.remove("modal-open");

  modalOpenCount = 0;
  isDropdownOpen = false;

  // Stay on the page (push a fresh state)
  window.history.pushState({ modal: false }, "");
});

// Intercept ALL SweetAlert2 popups
const originalSwalFire = Swal.fire;
Swal.fire = function (options) {
  closeDropdownIfOpen();
  pushModalState();
  const swalInstance = originalSwalFire.call(Swal, options);

  const cleanup = () => {
    if (!backButtonClosing) {
      popModalState();
    }
  };
  swalInstance.then(cleanup).catch(cleanup);
  return swalInstance;
};

// ──────────────────────────────────────────────
//   WATER BILL TEMPLATE HELPERS
// ──────────────────────────────────────────────

// Returns an object with current month’s water data, or null if no reading
function getTenantWaterData(tenant) {
  const currentMonth = getCurrentMonth();
  const reading = (tenant.waterMeterReadings || []).find(
    (r) => r.month === currentMonth
  );
  if (!reading) return null;

  const allReadings = [...(tenant.waterMeterReadings || [])].sort((a, b) =>
    a.month.localeCompare(b.month)
  );
  // Previous reading for display (the one just before current month)
  let prevReading = 0;
  for (const r of allReadings) {
    if (r.month < currentMonth) prevReading = r.reading;
    else break;
  }

  return {
    month: currentMonth,
    reading: reading.reading,
    prevReading: prevReading,
    unitsUsed: reading.unitsUsed,
    cost: reading.cost,
    rate: reading.rate,
    dueDate: getTenantNextDueDate(tenant),
  };
}

// Short SMS for water bill
function generateWaterBillSms(tenant) {
  const data = getTenantWaterData(tenant);
  if (!data) {
    return `Dear ${
      tenant.name
    }, no water reading has been recorded for ${getCurrentMonth()} yet.`;
  }

  const dueStr = data.dueDate
    ? new Date(data.dueDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
      })
    : "the due date";

  return `Dear ${tenant.name}, your water bill for ${
    data.month
  } is KES ${data.cost.toLocaleString()}. You used ${
    data.unitsUsed
  } units at KES ${data.rate}/unit. Please pay by ${dueStr}. Thank you!`;
}

// Detailed HTML email for water bill (with history)
function generateWaterBillEmail(tenant, landlordName) {
  const data = getTenantWaterData(tenant);
  if (!data) {
    return wrapPremiumEmail(
      `<p style="font-size:16px; color:#1e293b;">Dear ${escapeHtml(
        tenant.name
      )},</p>
       <p style="font-size:15px; color:#475569;">No water reading has been recorded for ${escapeHtml(
         getCurrentMonth()
       )} yet.</p>`,
      landlordName
    );
  }

  // Build history table (all readings, newest first)
  const allReadings = [...(tenant.waterMeterReadings || [])].sort((a, b) =>
    b.month.localeCompare(a.month)
  );

  let historyRows = "";
  allReadings.forEach((r) => {
    historyRows += `
      <tr>
        <td style="padding:10px 8px; border-bottom:1px solid #e0e0e0; text-align:center;">${escapeHtml(
          r.month
        )}</td>
        <td style="padding:10px 8px; border-bottom:1px solid #e0e0e0; text-align:right;">${
          r.reading
        }</td>
        <td style="padding:10px 8px; border-bottom:1px solid #e0e0e0; text-align:right;">${
          r.unitsUsed
        }</td>
        <td style="padding:10px 8px; border-bottom:1px solid #e0e0e0; text-align:right;">${r.rate.toLocaleString()}</td>
        <td style="padding:10px 8px; border-bottom:1px solid #e0e0e0; text-align:right; font-weight:600;">${r.cost.toLocaleString()}</td>
      </tr>`;
  });

  const dueStr = data.dueDate
    ? new Date(data.dueDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
      })
    : "the due date";

  const innerHtml = `
       <p style="font-size:17px; color:#1e293b; margin-bottom:4px; font-weight:500;">Dear ${escapeHtml(
         tenant.name
       )}${
    tenant.houseNumber ? ` (House ${escapeHtml(tenant.houseNumber)})` : ""
  },</p>
    <p style="font-size:16px; color:#475569; line-height:1.6; margin-bottom:20px;">
      Here is your water bill for <strong>${escapeHtml(data.month)}</strong>.
      Please pay by <strong>${escapeHtml(dueStr)}</strong>.
    </p>

    <!-- Current month summary -->
    <table style="width:100%; border-collapse:collapse; font-size:16px; margin-bottom:30px;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:12px 8px; text-align:center;">Month</th>
          <th style="padding:12px 8px; text-align:center;">Reading</th>
          <th style="padding:12px 8px; text-align:center;">Previous</th>
          <th style="padding:12px 8px; text-align:center;">Units</th>
          <th style="padding:12px 8px; text-align:center;">Rate (KES)</th>
          <th style="padding:12px 8px; text-align:center;">Cost (KES)</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background:#e8f5e9;">
          <td style="padding:12px 8px; text-align:center; font-weight:600;">${escapeHtml(
            data.month
          )}</td>
          <td style="padding:12px 8px; text-align:right;">${data.reading}</td>
          <td style="padding:12px 8px; text-align:right;">${
            data.prevReading
          }</td>
          <td style="padding:12px 8px; text-align:right;">${data.unitsUsed}</td>
          <td style="padding:12px 8px; text-align:right;">${data.rate.toLocaleString()}</td>
          <td style="padding:12px 8px; text-align:right; font-weight:700; color:#d32f2f;">${data.cost.toLocaleString()}</td>
        </tr>
      </tbody>
    </table>

    <!-- History -->
    <p style="font-size:16px; color:#1e293b; font-weight:600;">Previous Water Bills</p>
    <table style="width:100%; border-collapse:collapse; font-size:15px;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:10px 8px; text-align:center;">Month</th>
          <th style="padding:10px 8px; text-align:center;">Reading</th>
          <th style="padding:10px 8px; text-align:center;">Units</th>
          <th style="padding:10px 8px; text-align:center;">Rate (KES)</th>
          <th style="padding:10px 8px; text-align:center;">Cost (KES)</th>
        </tr>
      </thead>
      <tbody>
        ${historyRows}
      </tbody>
    </table>

    <p style="font-size:15px; color:#64748b; margin-top:30px; text-align:center;">
      If you have any questions, please contact your landlord.
    </p>
  `;

  return wrapPremiumEmail(innerHtml, landlordName);
}

// ========================
// CLEAN MODAL CLOSE (only when tapping outside – time guard applied)
// ========================
document.addEventListener("click", (e) => {
  // Ignore any click within 400ms of a modal opening (prevents mobile retarget)
  if (Date.now() - lastModalOpenTime < 400) return;

  // Don't close if click is inside any modal or the dropdown
  if (
    e.target.closest(".tenant-modal") ||
    e.target.closest(".swal2-popup") ||
    e.target.closest("#topbar-menu-dropdown") ||
    e.target.closest("#topbar-menu-btn")
  )
    return;

  // Don't close if no modal is open
  const overlay = document.getElementById("modal-overlay");
  if (!overlay || overlay.style.display === "none") return;

  // Close all custom modals
  popModalState();
  if (window._closeGlobalSettingsModal) window._closeGlobalSettingsModal();
  document.getElementById("tenant-actions-modal").style.display = "none";
  document.getElementById("profile-modal").style.display = "none";
  document.getElementById("payment-modal").style.display = "none";
  document.getElementById("utilities-modal").style.display = "none";
  document.getElementById("import-export-modal").style.display = "none";
  overlay.style.display = "none";
  document.body.classList.remove("modal-open");
});

// Submenu toggling (the only dropdown click handler)
document
  .getElementById("topbar-menu-dropdown")
  ?.addEventListener("click", (e) => {
    const toggle = e.target.closest(".submenu-toggle");
    if (toggle) {
      const submenu = toggle.nextElementSibling;
      if (submenu?.classList.contains("submenu")) {
        const isOpen = submenu.classList.toggle("open");
        toggle.innerHTML = toggle.innerHTML.replace(/[▸▾]/, isOpen ? "▾" : "▸");
      }
      e.stopPropagation(); // prevent the document click from closing anything
    }
  });
