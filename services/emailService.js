// services/emailService.js
import SibApiV3Sdk from "sib-api-v3-sdk";
import EmailLog from "../models/EmailLog.js";
import { Tenant } from "../models/Tenant.js";
import Settings from "../models/Settings.js";
import User from "../models/User.js";
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
export async function sendOverdueEmailRemindersForUser(
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
      autoEmailRemindersEnabled: true,
    });
    await settings.save();
  }

  if (!force && !settings.autoEmailRemindersEnabled) {
    console.log(
      `[Email Reminder] Auto email reminders disabled for user ${userId}`
    );
    return [];
  }

  const overdueTenants = await getOverdueTenants(userId, todayOverride);
  const results = [];

  const user = await User.findById(userId);
  const landlordName = user?.landlordName || user?.name || "Landlord";

  const refDate = todayOverride || new Date();

  for (const tenant of overdueTenants) {
    if (!tenant.email) continue;

    const allEntries = [...tenant.paymentHistory].sort((a, b) => {
      if (a.month !== b.month) return a.month.localeCompare(b.month);
      const aDate = a.datePaid ? new Date(a.datePaid).getTime() : 0;
      const bDate = b.datePaid ? new Date(b.datePaid).getTime() : 0;
      if (aDate !== bDate) return aDate - bDate;
      return a._id.toString().localeCompare(b._id.toString());
    });

    const allMonths = [...new Set(allEntries.map((e) => e.month))].sort();
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

    const leftByMonth = new Map();
    let prevCumulative = 0;
    for (const month of allMonths) {
      const ce = allEntries.find(
        (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
      );
      if (!ce) continue;
      const cumulative = ce.remainingBalance;
      const monthLeft = Math.max(0, cumulative) - Math.max(0, prevCumulative);
      leftByMonth.set(month, monthLeft);
      prevCumulative = cumulative;
    }

    let currentBillingMonth = allMonths[allMonths.length - 1];
    for (const month of allMonths) {
      const ce = allEntries.find(
        (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
      );
      if (ce?.dueDate && new Date(ce.dueDate) >= refDate) {
        currentBillingMonth = month;
        break;
      }
    }

    let tableRows = "";
    for (const month of allMonths) {
      const ce = allEntries.find(
        (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
      );
      if (!ce || month > currentBillingMonth) continue;

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

      const waterCharge = ce.waterCharge || 0;
      const garbageCharge = ce.garbageCharge || 0;
      const extraTotal = (ce.extraCharges || []).reduce(
        (s, c) => s + c.amount,
        0
      );
      const totalDue =
        ce.totalDue ||
        rentAmount +
          depositInstalment +
          waterCharge +
          garbageCharge +
          extraTotal;

      const paymentsThisMonth = allEntries.filter(
        (e) => e.month === month && e.amountPaid > 0
      );
      const paid = paymentsThisMonth.reduce((sum, e) => sum + e.amountPaid, 0);

      const monthLeft = leftByMonth.get(month) || 0;
      const dueDate = ce.dueDate ? new Date(ce.dueDate) : null;
      const isPastDueByDate = dueDate && dueDate < refDate && monthLeft > 0;
      const isInitialPastDue = ce.initialPastDue && monthLeft > 0;
      const isOverdue = isPastDueByDate || isInitialPastDue;

      const balance = ce.remainingBalance;
      let status = "";
      if (balance <= 0) status = "Paid";
      else if (isOverdue) status = "Overdue";
      else status = "Pending";

      const rowBg = isOverdue ? "#fff5f5" : "transparent";
      const statusColor = isOverdue ? "#d32f2f" : "#2e7d32";

      tableRows += `
        <tr style="background:${rowBg};">
          <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important; font-weight:600;">${escapeHtml(
            month
          )}</td>
          <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important;">${rentAmount.toLocaleString()}</td>
          <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important;">${
            depositInstalment > 0 ? depositInstalment.toLocaleString() : "—"
          }</td>
          <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important;">${waterCharge.toLocaleString()}</td>
          <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important;">${garbageCharge.toLocaleString()}</td>
          <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important; ${
            extraTotal > 0 ? "color:#fbbf24; font-weight:600;" : ""
          }">${extraTotal > 0 ? extraTotal.toLocaleString() : "—"}</td>
          <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important; font-weight:600;">${totalDue.toLocaleString()}</td>
          <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important;">${
            paid > 0 ? paid.toLocaleString() : "—"
          }</td>
          <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important; font-weight:700; ${
            monthLeft > 0 ? "color:#d32f2f;" : "color:#2e7d32;"
          }">${monthLeft.toLocaleString()}</td>
          <td style="padding:14px 8px; border-bottom:1px solid #e0e0e0; text-align:center !important; font-weight:700; color:${statusColor};">${status}</td>
        </tr>`;
    }

    const totalOverdue = Array.from(leftByMonth.keys())
      .filter((month) => {
        const ce = allEntries.find(
          (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
        );
        if (!ce?.dueDate) return false;
        return (
          new Date(ce.dueDate) < refDate && (leftByMonth.get(month) || 0) > 0
        );
      })
      .reduce((sum, month) => sum + (leftByMonth.get(month) || 0), 0);

    let note =
      totalOverdue > 0
        ? `<div style="background:#fff5f5; border-left:5px solid #d32f2f; padding:18px 24px; border-radius:10px; margin-top:28px; text-align:center;">
           <p style="margin:0; font-size:18px; font-weight:700; color:#d32f2f;">Total overdue: KES ${totalOverdue.toLocaleString()}</p>
           <p style="margin:6px 0 0; font-size:15px; color:#b71c1c;">Please pay at your earliest convenience.</p>
         </div>`
        : `<div style="background:#e8f5e9; border-left:5px solid #2e7d32; padding:18px 24px; border-radius:10px; margin-top:28px; text-align:center;">
           <p style="margin:0; font-size:18px; font-weight:700; color:#2e7d32;">All payments are up to date. Thank you!</p>
         </div>`;

    const innerHtml = `
      <p style="font-size:17px; color:#1e293b; margin-bottom:4px; font-weight:500;">Dear ${escapeHtml(
        tenant.name
      )},</p>
      <p style="font-size:16px; color:#475569; line-height:1.6; margin-bottom:20px;">Here is your detailed rent statement. Please review and arrange any outstanding payments.</p>

      <table style="width:100%; border-collapse:collapse; font-size:16px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Month</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Rent</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Deposit</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Water</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Garbage</th>
            <th style="padding:16px 6px; text-align:center !important; font-weight:700; color:#0f172a; border-bottom:2px solid #cbd5e1;">Extra</th>
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
        This statement was generated on ${refDate.toLocaleDateString()}.
      </p>
    `;

    const wrappedHtml = wrapPremiumEmail(innerHtml, landlordName);

    try {
      await sendEmail(
        tenant.email,
        tenant.name,
        "Overdue Rent Reminder",
        wrappedHtml,
        userId
      );

      const newestOverdueMonth = allMonths
        .filter((month) => {
          const ce = allEntries.find(
            (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
          );
          if (!ce?.dueDate) return false;
          return (
            new Date(ce.dueDate) < refDate && (leftByMonth.get(month) || 0) > 0
          );
        })
        .pop();

      if (!force && newestOverdueMonth) {
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
