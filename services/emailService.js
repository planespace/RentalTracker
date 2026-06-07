//services/emailService.js
import nodemailer from "nodemailer";
import EmailLog from "../models/EmailLog.js";
import { Tenant } from "../models/Tenant.js";
import Settings from "../models/Settings.js";
import { getOverdueTenants } from "./smsService.js";

// ---------- CREATE TRANSPORTER WITH RELIABLE SETTINGS ----------
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465, // SSL directly
  secure: true, // TLS without STARTTLS delay
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // no spaces!
  },
  connectionTimeout: 8000, // give up after 8s trying to connect
  greetingTimeout: 8000, // wait max 8s for SMTP greeting
  socketTimeout: 12000, // max 12s of inactivity
});

// ---------- SEND EMAIL WITH TIMEOUT WRAPPER ----------
export async function sendEmail(
  tenantEmail,
  tenantName,
  subject,
  message,
  userId
) {
  const logEntry = new EmailLog({
    userId,
    tenantName,
    email: tenantEmail,
    subject,
    body: message,
    status: "pending",
    sentAt: new Date(),
  });
  await logEntry.save();

  // Wrap the actual sending in a race against a timeout
  const timeoutMs = 8000; // 8 seconds

  const sendPromise = transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: tenantEmail,
    subject: subject,
    html: message,
  });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error("Email send timed out after 8s")),
      timeoutMs
    )
  );

  try {
    const info = await Promise.race([sendPromise, timeoutPromise]);
    logEntry.messageId = info.messageId;
    logEntry.status = "sent";
    await logEntry.save();
    return info;
  } catch (error) {
    console.error("Email send failed:", error.message);
    logEntry.status = "failed";
    logEntry.error = error.message;
    logEntry.failedAt = new Date();
    await logEntry.save();
    throw error;
  }
}

// ---------- REST OF THE FILE REMAINS UNCHANGED ----------
export async function sendOverdueEmailRemindersForUser(userId, force = false) {
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
    console.log(`[Email Reminder] Auto reminders disabled for user ${userId}`);
    return [];
  }

  const overdueTenants = await getOverdueTenants(userId);
  const results = [];

  for (const tenant of overdueTenants) {
    if (!tenant.email) continue;

    const months = [
      ...new Set(tenant.paymentHistory.map((e) => e.month)),
    ].sort();
    const overdueMonths = [];
    let prevCumulative = 0;

    for (const month of months) {
      const chargeEntry = tenant.paymentHistory.find(
        (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
      );
      if (!chargeEntry?.dueDate) continue;
      const due = new Date(chargeEntry.dueDate);
      if (due >= new Date()) continue;

      const cumulative = chargeEntry.remainingBalance;
      const standalone = cumulative - prevCumulative;
      prevCumulative = cumulative;
      if (standalone > 0) {
        const rent = chargeEntry.baseRent || tenant.rent;
        const water = chargeEntry.waterCharge || 0;
        const garbage = chargeEntry.garbageCharge || 0;
        overdueMonths.push({
          month,
          standalone,
          total: chargeEntry.totalDue || rent + water + garbage,
          rent,
          water,
          garbage,
        });
      }
    }

    if (overdueMonths.length === 0) continue;

    const totalOverdue = overdueMonths.reduce(
      (sum, m) => sum + m.standalone,
      0
    );
    let body = `Dear ${tenant.name},\n\nOverdue Rent Reminder\n\n`;
    for (const m of overdueMonths) {
      body += `- ${m.month}: KES ${m.standalone.toLocaleString()} remaining\n`;
      body += `  (Total: KES ${m.total.toLocaleString()} — Rent: KES ${m.rent.toLocaleString()}, Water: KES ${m.water.toLocaleString()}, Garbage: KES ${m.garbage.toLocaleString()})\n\n`;
    }
    body += `Total overdue: KES ${totalOverdue.toLocaleString()}\n`;
    body += `\nPlease pay your overdue amount at your earliest convenience. Thank you!`;

    try {
      await sendEmail(
        tenant.email,
        tenant.name,
        "Overdue Rent Reminder",
        body,
        userId
      );
      results.push({ tenant: tenant.name, success: true });
    } catch (err) {
      results.push({ tenant: tenant.name, success: false, error: err.message });
    }
  }
  return results;
}

export async function sendBulkEmails(tenantIds, subject, message, userId) {
  const tenants = await Tenant.find({
    _id: { $in: tenantIds },
    userId,
    active: true,
  });
  const results = [];
  for (const tenant of tenants) {
    if (!tenant.email) {
      results.push({
        tenant: tenant.name,
        success: false,
        error: "No email address",
      });
      continue;
    }
    try {
      await sendEmail(tenant.email, tenant.name, subject, message, userId);
      results.push({ tenant: tenant.name, success: true });
    } catch (err) {
      results.push({ tenant: tenant.name, success: false, error: err.message });
    }
  }
  return results;
}
