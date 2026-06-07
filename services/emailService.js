//services/emailService.js
import nodemailer from "nodemailer";
import EmailLog from "../models/EmailLog.js";
import { Tenant } from "../models/Tenant.js";
import Settings from "../models/Settings.js";
import { getOverdueTenants } from "./smsService.js";

// ---------- CREATE TRANSPORTER ----------
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587, // STARTTLS
  secure: false, // plain connection first, then upgrade to TLS
  requireTLS: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 12000,
  greetingTimeout: 12000,
  socketTimeout: 15000,
  debug: true, // show SMTP commands in console
  logger: true, // log to console
});

// Helper to send with detailed error logging
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

  try {
    // Attempt to send – if this fails, we'll get the real error
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: tenantEmail,
      subject: subject,
      html: message,
    });
    logEntry.messageId = info.messageId;
    logEntry.status = "sent";
    await logEntry.save();
    console.log(`✅ Email sent to ${tenantEmail}: ${info.messageId}`);
    return info;
  } catch (error) {
    // Log the full error for Render logs
    console.error(`❌ Email error for ${tenantEmail}:`, error.message);
    console.error(error.stack);

    logEntry.status = "failed";
    logEntry.error = error.message;
    logEntry.failedAt = new Date();
    await logEntry.save();
    throw error; // let the caller handle it
  }
}

// ---------- REMINDER FUNCTIONS (unchanged, but ensure they still import correctly) ----------
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
