//utils.js
function formatDate(isoString) {
  if (!isoString) return "—";
  // If it's already a Date object, convert it to a string
  if (isoString instanceof Date) {
    return isoString.toISOString().split("T")[0];
  }
  return isoString.split("T")[0];
}

function formatCurrency(amount) {
  return amount.toLocaleString();
}

function getCurrentMonth() {
  if (devModeActive && currentDevDate) {
    // currentDevDate is YYYY-MM-DD, e.g. "2026-05-06"
    return currentDevDate.slice(0, 7); // "2026-05"
  }
  // fallback to real month via the server's currentDate
  if (!currentAppDate) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
      2,
      "0"
    )}`;
  }
  const d = new Date(currentAppDate);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

function getPreviousMonthString(monthString) {
  let [year, month] = monthString.split("-").map(Number);
  let date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() - 1);
  let newYear = date.getFullYear();
  let newMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${newYear}-${newMonth}`;
}

function getNextMonthString(monthString) {
  let [year, month] = monthString.split("-").map(Number);
  let date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() + 1);
  let newYear = date.getFullYear();
  let newMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${newYear}-${newMonth}`;
}

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
