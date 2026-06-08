//services/emailService.js
import SibApiV3Sdk from "sib-api-v3-sdk";
import EmailLog from "../models/EmailLog.js";
import { Tenant } from "../models/Tenant.js";
import Settings from "../models/Settings.js";
import User from "../models/User.js"; // ✅ static import
import { getOverdueTenants } from "./smsService.js";

// Configure Brevo client
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications["api-key"];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// Helper to escape HTML
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Premium email wrapper (logo‑free)
function wrapPremiumEmail(innerHtml, landlordName = "Landlord") {
  const today = new Date();
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
</head>
<body style="margin:0; padding:0; background:#f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <div style="max-width:700px; margin:30px auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 8px 30px rgba(0,0,0,0.08);">
    <div style="background:#0f172a; padding:36px 24px; text-align:center;">
      <h1 style="margin:0; font-size:28px; font-weight:800; color:#ffffff; letter-spacing:1px;">RENTAL TRACKER</h1>
      <p style="margin:10px 0 0; font-size:16px; color:#cbd5e1;">Landlord: ${escapeHtml(
        landlordName
      )}</p>
    </div>
    <div style="padding:32px 24px;">
      ${innerHtml}
    </div>
    <div style="background:#0f172a; padding:16px 24px; text-align:center;">
      <p style="margin:0; font-size:12px; color:#94a3b8;">&copy; ${today.getFullYear()} Rental Tracker. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

// Send a single email via Brevo
export async function sendEmail(
  toEmail,
  tenantName,
  subject,
  htmlBody,
  userId
) {
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

// Send overdue reminder emails for a user
export async function sendOverdueEmailRemindersForUser(userId, force = false) {
  // Load settings
  let settings = await Settings.findById("global_" + userId);
  if (!settings) {
    settings = new Settings({
      _id: "global_" + userId,
      garbageFee: 0,
      waterRatePerUnit: 0,
      defaultDueDay: 1,
      autoRemindersEnabled: true,
      autoEmailRemindersEnabled: true, // 👈 ensure it exists
    });
    await settings.save();
  }

  // Respect the email‑reminder toggle
  if (!settings.autoEmailRemindersEnabled) {
    console.log(
      `[Email Reminder] Auto email reminders disabled for user ${userId}`
    );
    return [];
  }

  const overdueTenants = await getOverdueTenants(userId);
  const results = [];

  // Fetch landlord info once
  const User = (await import("../models/User.js")).default;
  const user = await User.findById(userId);
  const landlordName = user?.landlordName || user?.name || "Landlord";

  for (const tenant of overdueTenants) {
    if (!tenant.email) continue;

    // ---------- Build list of overdue months ----------
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

    // ---------- Once‑per‑month guard ----------
    const newestOverdueMonth = overdueMonths[overdueMonths.length - 1]?.month;
    if (!newestOverdueMonth) continue;

    if (
      !force &&
      tenant.emailReminderSentMonths &&
      tenant.emailReminderSentMonths.includes(newestOverdueMonth)
    ) {
      console.log(
        `[Email Reminder] Already sent for ${tenant.name} (${newestOverdueMonth}), skipping`
      );
      continue;
    }

    const totalOverdue = overdueMonths.reduce(
      (sum, m) => sum + m.standalone,
      0
    );

    // ---------- Build HTML content ----------
    let htmlBody = `
      <p style="font-size:16px; color:#1e293b;">Dear ${escapeHtml(
        tenant.name
      )},</p>
      <p style="font-size:15px; color:#475569;">You have the following overdue rent:</p>
      <table style="width:100%; border-collapse:collapse; margin:20px 0; font-size:15px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:10px; text-align:left;">Month</th>
            <th style="padding:10px; text-align:right;">Amount Owed</th>
          </tr>
        </thead>
        <tbody>
    `;
    overdueMonths.forEach((m) => {
      htmlBody += `
        <tr>
          <td style="padding:10px; border-bottom:1px solid #e0e0e0;">${escapeHtml(
            m.month
          )}</td>
          <td style="padding:10px; text-align:right; border-bottom:1px solid #e0e0e0;">KES ${m.standalone.toLocaleString()}</td>
        </tr>
      `;
    });
    htmlBody += `
        </tbody>
      </table>
      <p style="font-size:16px; font-weight:700; color:#d32f2f;">Total overdue: KES ${totalOverdue.toLocaleString()}</p>
      <p style="font-size:15px; color:#475569; margin-top:20px;">Please pay at your earliest convenience. Thank you!</p>
    `;

    const wrappedHtml = wrapPremiumEmail(htmlBody, landlordName);

    // ---------- Send and record ----------
    try {
      await sendEmail(
        tenant.email,
        tenant.name,
        "Overdue Rent Reminder",
        wrappedHtml,
        userId
      );

      // Remember that we sent the email for this month
      if (!force) {
        if (!tenant.emailReminderSentMonths)
          tenant.emailReminderSentMonths = [];
        tenant.emailReminderSentMonths.push(newestOverdueMonth);
        await tenant.save();
      }

      results.push({ tenant: tenant.name, success: true });
    } catch (err) {
      results.push({ tenant: tenant.name, success: false, error: err.message });
    }
  }
  return results;
}

// Bulk send (used by manual email sending)
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
