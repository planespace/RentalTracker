// data.js Handles DATA - localStorage & tenantArray
// TODO Add and get from localStorage function

function addToLocalStorage() {
  localStorage.setItem("tenantArray", JSON.stringify(tenantArray));
}

function getFromLocalStorage() {
  let data = localStorage.getItem("tenantArray");
  if (data) {
    return JSON.parse(data);
  } else {
    return [];
  }
}

function getNextMonthString(currentMonth) {
  let [year, month] = currentMonth.split("-").map(Number);
  let date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() + 1);
  let newYear = date.getFullYear();
  let newMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${newYear}-${newMonth}`;
}

function getAppMonth() {
  let stored = localStorage.getItem("appCurrentMonth");
  if (stored) {
    return stored;
  }
  return getCurrentMonth();
}

function setAppMonth(month) {
  localStorage.setItem("appCurrentMonth", month);
}

function advanceAppMonth() {
  let current = getAppMonth();
  let next = getNextMonthString(current);
  setAppMonth(next);
  return next;
}
