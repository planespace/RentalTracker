//services/emailService.js
import SibApiV3Sdk from "sib-api-v3-sdk";
import EmailLog from "../models/EmailLog.js";
import { Tenant } from "../models/Tenant.js";
import Settings from "../models/Settings.js";
import { getOverdueTenants } from "./smsService.js";

// Configure Brevo client
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications["api-key"];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

/**
 * Send a single email via Brevo
 */
export async function sendEmail(
  toEmail,
  tenantName,
  subject,
  htmlBody,
  userId
) {
  // Create pending log entry
  const logEntry = new EmailLog({
    userId,
    tenantName,
    email: toEmail,
    subject,
    body: htmlBody,
    status: "pending",
    sentAt: new Date(),
  });
  await logEntry.save();

  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
  sendSmtpEmail.sender = {
    email: process.env.EMAIL_USER,
    name: "Rental Tracker",
  };
  sendSmtpEmail.to = [{ email: toEmail }];
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = htmlBody;

  try {
    const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logEntry.messageId = response.messageId || null;
    logEntry.status = "sent";
    await logEntry.save();
    console.log(
      `✅ Email sent to ${toEmail} (Brevo ID: ${response.messageId})`
    );
    return response;
  } catch (error) {
    console.error(`❌ Brevo error for ${toEmail}:`, error.message);
    logEntry.status = "failed";
    logEntry.error = error.message;
    logEntry.failedAt = new Date();
    await logEntry.save();
    throw error;
  }
}

// ---------- Reminder & bulk functions (unchanged) ----------

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
