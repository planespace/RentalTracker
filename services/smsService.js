//services/smsService.js

import africastalking from "africastalking";
import { Tenant } from "../models/Tenant.js";
import mongoose from "mongoose";
import SmsLog from "../models/SmsLog.js";

const Settings = mongoose.model("Settings");

const client = africastalking({
  username: process.env.AFRICASTALKING_USERNAME,
  apiKey: process.env.AFRICASTALKING_API_KEY,
});
const sms = client.SMS;

function formatPhoneNumber(phone) {
  if (!phone) return null;
  let cleaned = phone.toString().replace(/\D/g, "");
  if (
    cleaned.length === 10 &&
    (cleaned.startsWith("07") || cleaned.startsWith("01"))
  ) {
    return "+254" + cleaned.substring(1);
  }
  if (cleaned.length === 12 && cleaned.startsWith("254")) {
    return "+" + cleaned;
  }
  if (
    cleaned.length === 9 &&
    (cleaned.startsWith("7") || cleaned.startsWith("1"))
  ) {
    return "+254" + cleaned;
  }
  if (cleaned.length === 13 && cleaned.startsWith("2540")) {
    return "+254" + cleaned.substring(4);
  }
  const lastNine = cleaned.slice(-9);
  if (
    lastNine.length === 9 &&
    (lastNine.startsWith("7") || lastNine.startsWith("1"))
  ) {
    return "+254" + lastNine;
  }
  console.error(`[SMS] Cannot format phone number: ${phone}`);
  return null;
}

export async function sendSms(
  tenantPhone,
  message,
  tenantId,
  tenantName,
  userId
) {
  let to;
  const isTestMode = process.env.TEST_MODE === "true";

  console.log(`[SMS DEBUG] TEST_MODE = ${isTestMode}`);
  console.log(`[SMS DEBUG] Username = ${process.env.AFRICASTALKING_USERNAME}`);
  console.log(
    `[SMS DEBUG] API Key first 5 chars = ${process.env.AFRICASTALKING_API_KEY?.substring(
      0,
      5
    )}`
  );
  console.log(`[SMS DEBUG] Tenant phone = ${tenantPhone}`);
  console.log(`[SMS DEBUG] Message = ${message.substring(0, 20)}...`);

  // Create log entry (pending)
  const logEntry = new SmsLog({
    userId,
    tenantId,
    tenantName,
    phoneNumber: tenantPhone,
    message,
    status: "pending",
    sentAt: new Date(),
  });
  await logEntry.save();

  if (isTestMode) {
    to = "+254725880924";
    console.log(`[TEST MODE] Sending to sandbox number: ${to}`);
  } else {
    to = formatPhoneNumber(tenantPhone);
    console.log(`[SMS DEBUG] Formatted phone = ${to}`);
    if (!to) {
      logEntry.status = "failed";
      logEntry.error = "Invalid phone number format";
      logEntry.failedAt = new Date();
      await logEntry.save();
      throw new Error(`Invalid phone number: ${tenantPhone}`);
    }
    console.log(`[LIVE MODE] Sending to tenant: ${to}`);
  }

  const fromSender = isTestMode ? "BEAST" : undefined;
  const smsOptions = { to, message };
  if (fromSender) smsOptions.from = fromSender;

  try {
    console.log(`[SMS DEBUG] About to send SMS to ${to}...`);
    const result = await sms.send(smsOptions);

    console.log("[SMS DEBUG] Full API response:");
    console.log(JSON.stringify(result, null, 2));

    const recipient = result?.SMSMessageData?.Recipients?.[0];
    const messageId = recipient?.messageId;
    const deliveryStatus = recipient?.status; // "Success" or "UserInBlacklist" etc.

    if (messageId && messageId !== "None") {
      logEntry.messageId = messageId;
    }

    if (deliveryStatus === "Success") {
      logEntry.status = "sent";
    } else {
      logEntry.status = "failed";
      logEntry.error = deliveryStatus || "Unknown error";
      logEntry.failedAt = new Date();
    }

    await logEntry.save();
    console.log(
      `[SMS DEBUG] SMS result: ${deliveryStatus}, messageId: ${messageId}`
    );
    return result;
  } catch (error) {
    console.error(`[SMS DEBUG] SMS send error:`, error);
    logEntry.status = "failed";
    logEntry.error = error.message;
    logEntry.failedAt = new Date();
    await logEntry.save();
    throw error;
  }
}

export async function sendBulkSms(tenantIds, message, userId) {
  const tenants = await Tenant.find({
    _id: { $in: tenantIds },
    userId,
    active: true,
  });
  const results = [];
  for (const tenant of tenants) {
    try {
      await sendSms(
        tenant.phoneNumber,
        message,
        tenant._id.toString(),
        tenant.name,
        userId
      );
      results.push({ tenant: tenant.name, success: true });
    } catch (err) {
      results.push({ tenant: tenant.name, success: false, error: err.message });
    }
  }
  return results;
}

export async function getOverdueTenants(userId, todayOverride) {
  const today = todayOverride ? new Date(todayOverride) : new Date();
  today.setHours(0, 0, 0, 0);
  const todayUTC = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  );
  const todayStr = `${todayUTC.getUTCFullYear()}-${String(
    todayUTC.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(todayUTC.getUTCDate()).padStart(2, "0")}`;

  const allTenants = await Tenant.find({ userId, active: true });
  const overdue = [];

  for (const tenant of allTenants) {
    const months = [
      ...new Set(tenant.paymentHistory.map((e) => e.month)),
    ].sort();
    let hasOverdue = false;
    for (const month of months) {
      const monthEntries = tenant.paymentHistory.filter(
        (e) => e.month === month
      );
      monthEntries.sort((a, b) => {
        const aDate = a.datePaid ? new Date(a.datePaid).getTime() : 0;
        const bDate = b.datePaid ? new Date(b.datePaid).getTime() : 0;
        return aDate - bDate;
      });
      const latest = monthEntries[monthEntries.length - 1];
      if (!latest || !latest.dueDate) continue;
      const dueUTC = new Date(latest.dueDate);
      const dueStr = `${dueUTC.getUTCFullYear()}-${String(
        dueUTC.getUTCMonth() + 1
      ).padStart(2, "0")}-${String(dueUTC.getUTCDate()).padStart(2, "0")}`;
      if (dueStr >= todayStr) break;
      if (latest.remainingBalance > 0) hasOverdue = true;
    }
    if (hasOverdue) overdue.push(tenant);
  }
  return overdue;
}

export async function sendOverdueRemindersForUser(
  userId,
  todayOverride,
  force = false
) {
  let settings = await Settings.findById("global_" + userId);
  if (!settings) {
    settings = new Settings({
      _id: "global_" + userId,
      garbageFee: 0,
      waterRatePerUnit: 0,
      defaultDueDay: 1,
      autoRemindersEnabled: true,
    });
    await settings.save();
  }
  if (!settings.autoRemindersEnabled) {
    console.log(`[Reminder] Auto reminders disabled for user ${userId}`);
    return [];
  }

  const today = todayOverride ? new Date(todayOverride) : new Date();
  today.setHours(0, 0, 0, 0);
  const todayUTC = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  );
  const todayStr = `${todayUTC.getUTCFullYear()}-${String(
    todayUTC.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(todayUTC.getUTCDate()).padStart(2, "0")}`;

  const allTenants = await Tenant.find({ userId, active: true });
  const results = [];

  for (const tenant of allTenants) {
    const months = [
      ...new Set(tenant.paymentHistory.map((e) => e.month)),
    ].sort();
    let totalOverdue = 0;
    let newestOverdueMonth = null; // most recent month that is overdue
    let earliestDueDate = null;

    for (const month of months) {
      const monthEntries = tenant.paymentHistory.filter(
        (e) => e.month === month
      );
      monthEntries.sort((a, b) => {
        const aDate = a.datePaid ? new Date(a.datePaid).getTime() : 0;
        const bDate = b.datePaid ? new Date(b.datePaid).getTime() : 0;
        if (aDate !== bDate) return aDate - bDate;
        return a._id.toString().localeCompare(b._id.toString());
      });
      const latest = monthEntries[monthEntries.length - 1];
      if (!latest || !latest.dueDate) continue;
      const dueUTC = new Date(latest.dueDate);
      const dueStr = `${dueUTC.getUTCFullYear()}-${String(
        dueUTC.getUTCMonth() + 1
      ).padStart(2, "0")}-${String(dueUTC.getUTCDate()).padStart(2, "0")}`;
      if (dueStr >= todayStr) break;

      if (latest.remainingBalance > 0) {
        totalOverdue = latest.remainingBalance; // cumulative, includes all past
        newestOverdueMonth = month;
        if (!earliestDueDate) earliestDueDate = dueUTC;
      }
    }

    if (totalOverdue === 0 || !newestOverdueMonth) continue;

    // Don't resend if we already reminded for this exact month (unless forced)
    if (
      !force &&
      tenant.reminderSentMonths &&
      tenant.reminderSentMonths.includes(newestOverdueMonth)
    ) {
      console.log(
        `[Reminder] Already sent for ${tenant.name} (${newestOverdueMonth}), skipping`
      );
      continue;
    }

    const dueDateStr = earliestDueDate
      ? earliestDueDate.toLocaleDateString("en-KE", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "recently";

    // Build a single message with the total overdue amount (covers all overdue months)
    let message;
    if (settings.reminderTemplate) {
      message = settings.reminderTemplate
        .replace(/{name}/g, tenant.name)
        .replace(/{amount}/g, totalOverdue.toLocaleString())
        .replace(/{dueDate}/g, dueDateStr)
        .replace(/{monthsCount}/g, "1");
    } else {
      message = `Dear ${
        tenant.name
      }, your overdue rent is KES ${totalOverdue.toLocaleString()} (due: ${dueDateStr}). Please pay to avoid penalties.`;
    }

    try {
      console.log(`[Reminder] Sending to ${tenant.name}: ${message}`);
      await sendSms(
        tenant.phoneNumber,
        message,
        tenant._id.toString(),
        tenant.name,
        userId
      );

      if (!force) {
        if (!tenant.reminderSentMonths) tenant.reminderSentMonths = [];
        tenant.reminderSentMonths.push(newestOverdueMonth);
        await tenant.save();
      }
      results.push({
        tenant: tenant.name,
        success: true,
        month: newestOverdueMonth,
        forced: force,
      });
    } catch (err) {
      console.error(`[Reminder] Failed for ${tenant.name}:`, err.message);
      results.push({ tenant: tenant.name, success: false, error: err.message });
    }
  }
  return results;
}
