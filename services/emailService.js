// services/emailService.js
import SibApiV3Sdk from "sib-api-v3-sdk";
import https from "https";
import EmailLog from "../models/EmailLog.js";
import { Tenant } from "../models/Tenant.js";
import Settings from "../models/Settings.js";
import User from "../models/User.js";
import { getOverdueTenants } from "./smsService.js";

// Configure Brevo client
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications["api-key"];
apiKey.apiKey = process.env.BREVO_API_KEY;

// ── Keep‑alive agent – reuse TLS connections ──
const agent = new https.Agent({ keepAlive: true });
defaultClient.defaultAgent = agent;

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
function wrapPremiumEmail(
  innerHtml,
  landlordName = "Landlord",
  landlordPhone = ""
) {
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
      <h1 style="margin:0; font-size:28px; font-weight:800; color:#ffffff; letter-spacing:1px;">PARADISE SUITES</h1>
      <p style="margin:10px 0 0; font-size:16px; color:#cbd5e1;">Landlord: ${escapeHtml(
        landlordName
      )}</p>
      ${
        landlordPhone
          ? `<p style="margin:6px 0 0; font-size:15px; color:#94a3b8;">Phone: ${escapeHtml(
              landlordPhone
            )}</p>`
          : ""
      }
    </div>
    <div style="padding:32px 24px;">
      ${innerHtml}
    </div>
    <div style="background:#0f172a; padding:16px 24px; text-align:center;">
      <p style="margin:0; font-size:12px; color:#94a3b8;">&copy; ${today.getFullYear()} Paradise Suites. All rights reserved.</p>
      <p style="margin:8px 0 0; font-size:12px; color:#f87171;">🔒 We never send paybill numbers via email. Please ask the landlord or caretaker directly.</p>
    </div>
  </div>
</body>
</html>`;
}

// Send a single email via Brevo (optimized)
export async function sendEmail(
  toEmail,
  tenantName,
  subject,
  htmlBody,
  userId
) {
  console.log(`✉️ sendEmail called for ${toEmail} (${tenantName})`);
  // Fire and forget initial log – do not await
  const logEntry = new EmailLog({
    userId,
    tenantName,
    email: toEmail,
    subject,
    body: htmlBody,
    status: "pending",
    sentAt: new Date(),
  });
  logEntry.save().catch((err) => console.error("Log save failed", err));

  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
  sendSmtpEmail.sender = {
    email: process.env.EMAIL_USER,
    name: "Paradise Suites",
  };
  sendSmtpEmail.to = [{ email: toEmail }];
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = htmlBody;

  // Fast retry: 3 attempts, 50 ms delay
  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
      logEntry.messageId = response.messageId || null;
      logEntry.status = "sent";
      await logEntry.save();
      console.log(`✅ Email sent to ${toEmail} (attempt ${attempt})`);
      return response;
    } catch (error) {
      lastError = error;
      console.error(
        `❌ Attempt ${attempt} failed for ${toEmail}: ${error.message}`
      );
      if (attempt < maxRetries) {
        // Very short delay – only 50 ms
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  // All attempts failed
  logEntry.status = "failed";
  logEntry.error = lastError.message;
  logEntry.failedAt = new Date();
  await logEntry.save();
  throw lastError;
}

// Send overdue reminder emails for a user (parallel batches of 5)
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
    const monthData = new Map();

    for (const month of allMonths) {
      const ce = allEntries.find(
        (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
      );
      if (!ce) continue;

      const cumulative = ce.remainingBalance;
      const monthLeft = Math.max(0, cumulative) - Math.max(0, prevCumulative);
      leftByMonth.set(month, monthLeft);
      prevCumulative = cumulative;

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

      const monthLeftVal = leftByMonth.get(month) || 0;
      const dueDate = ce.dueDate ? new Date(ce.dueDate) : null;
      const isPastDueByDate = dueDate && dueDate < refDate && monthLeftVal > 0;
      const isInitialPastDue = ce.initialPastDue && monthLeftVal > 0;
      const isOverdue = isPastDueByDate || isInitialPastDue;

      let status = "";
      if (monthLeftVal <= 0) {
        status = "Paid";
      } else if (isOverdue) {
        status = "Overdue";
      } else {
        status = "Not Due";
      }

      monthData.set(month, {
        month,
        rentAmount,
        depositInstalment,
        waterCharge,
        garbageCharge,
        extraTotal,
        totalDue,
        paid,
        balance: monthLeftVal,
        status,
        isOverdue,
      });
    }

    // Determine current billing month
    const currentBillingMonth =
      allMonths.find((month) => {
        const ce = allEntries.find(
          (e) => e.month === month && (e.amountPaid || 0) === 0 && !e.datePaid
        );
        if (ce?.dueDate) return new Date(ce.dueDate) >= refDate;
        return false;
      }) || allMonths[allMonths.length - 1];

    const overdueMonths = allMonths.filter(
      (m) => monthData.get(m).status === "Overdue"
    );
    const nonOverdueMonths = allMonths.filter(
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

    const displayMonths = allMonths.filter((m) => displaySet.has(m));

    // Build card HTML with compact, centered table
    let cardsHtml = "";
    for (const month of displayMonths) {
      const d = monthData.get(month);
      if (!d) continue;

      const cardBorder = d.isOverdue ? "#dc2626" : "#16a34a";
      const cardBg = d.isOverdue ? "#fff5f5" : "#f0fdf4";
      const balanceColor = d.balance > 0 ? "#dc2626" : "#16a34a";

      cardsHtml += `
        <div style="background:${cardBg}; border-left:5px solid ${cardBorder}; border-radius:12px; padding:20px; margin-bottom:16px; box-shadow:0 2px 4px rgba(0,0,0,0.04);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <span style="font-size:20px; font-weight:700; color:#0f172a;">${
              d.month
            }</span>
            <span style="margin-left:auto; display:inline-block; padding:5px 16px; border-radius:20px; font-weight:700; font-size:15px; background:${cardBorder}; color:white;">${
        d.status
      }</span>
          </div>
          <div style="max-width:450px; margin:0 auto; text-align:center;">
            <table style="margin:0 auto; border-collapse:collapse; font-size:15px; color:#334155;">
              <tr>
                <td style="padding:6px 12px 6px 0; text-align:left; color:#64748b;">Rent</td>
                <td style="padding:6px 0; text-align:right;">KES ${d.rentAmount.toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding:6px 12px 6px 0; text-align:left; color:#64748b;">Deposit</td>
                <td style="padding:6px 0; text-align:right;">${
                  d.depositInstalment > 0
                    ? `KES ${d.depositInstalment.toLocaleString()}`
                    : "—"
                }</td>
              </tr>
              <tr>
                <td style="padding:6px 12px 6px 0; text-align:left; color:#64748b;">Water</td>
                <td style="padding:6px 0; text-align:right;">KES ${d.waterCharge.toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding:6px 12px 6px 0; text-align:left; color:#64748b;">Garbage</td>
                <td style="padding:6px 0; text-align:right;">KES ${d.garbageCharge.toLocaleString()}</td>
              </tr>
              ${
                d.extraTotal > 0
                  ? `<tr>
                      <td style="padding:6px 12px 6px 0; text-align:left; color:#64748b;">Extra</td>
                      <td style="padding:6px 0; text-align:right; color:#fbbf24; font-weight:600;">KES ${d.extraTotal.toLocaleString()}</td>
                    </tr>`
                  : ""
              }
              <tr>
                <td colspan="2" style="padding:0; border-top:1px solid #e2e8f0;"></td>
              </tr>
              <tr>
                <td style="padding:10px 12px 6px 0; text-align:left; color:#64748b;">Total Due</td>
                <td style="padding:10px 0 6px 0; text-align:right; font-weight:600;">KES ${d.totalDue.toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding:6px 12px 6px 0; text-align:left; color:#64748b;">Paid</td>
                <td style="padding:6px 0; text-align:right;">${
                  d.paid > 0 ? `KES ${d.paid.toLocaleString()}` : "—"
                }</td>
              </tr>
              <tr>
                <td colspan="2" style="padding:10px 0 0 0; text-align:center; font-weight:700; font-size:17px; color:${balanceColor};">
                  Balance: KES ${d.balance.toLocaleString()}
                </td>
              </tr>
            </table>
          </div>
        </div>
      `;
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

    let note = "";
    if (totalOverdue > 0) {
      note = `<div style="background:#fff5f5; border-left:5px solid #dc2626; padding:18px 24px; border-radius:10px; margin-top:28px; text-align:center;">
                <p style="margin:0; font-size:18px; font-weight:700; color:#dc2626;">Total overdue: KES ${totalOverdue.toLocaleString()}</p>
                <p style="margin:6px 0 0; font-size:15px; color:#b91c1c;">Please pay at your earliest convenience.</p>
              </div>`;
    } else {
      note = `<div style="background:#ecfdf5; border-left:5px solid #16a34a; padding:18px 24px; border-radius:10px; margin-top:28px; text-align:center;">
                <p style="margin:0; font-size:18px; font-weight:700; color:#16a34a;">All payments are up to date. Thank you!</p>
              </div>`;
    }

    const innerHtml = `
      <p style="font-size:17px; color:#1e293b; margin-bottom:4px; font-weight:500;">Dear ${escapeHtml(
        tenant.name
      )}${
      tenant.houseNumber ? ` (House ${escapeHtml(tenant.houseNumber)})` : ""
    },</p>
      <p style="font-size:16px; color:#475569; line-height:1.6; margin-bottom:20px;">Here is your detailed rent statement. Please review and arrange any outstanding payments.</p>

      <div style="max-width:600px; margin:0 auto;">
        ${cardsHtml}
      </div>

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
        "Overdue Rent Reminder – Paradise Suites",
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
// Bulk send (used by manual email sending) – parallel batches of 5
export async function sendBulkEmails(tenantIds, subject, message, userId) {
  const tenants = await Tenant.find({
    _id: { $in: tenantIds },
    userId,
    active: true,
  });
  const results = [];

  const BATCH_SIZE = 5;
  for (let i = 0; i < tenants.length; i += BATCH_SIZE) {
    const batch = tenants.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (tenant) => {
        if (!tenant.email) {
          return {
            tenant: tenant.name,
            success: false,
            error: "No email address",
          };
        }
        try {
          await sendEmail(tenant.email, tenant.name, subject, message, userId);
          return { tenant: tenant.name, success: true };
        } catch (err) {
          return { tenant: tenant.name, success: false, error: err.message };
        }
      })
    );
    for (const res of batchResults) {
      results.push(
        res.status === "fulfilled"
          ? res.value
          : { tenant: "unknown", success: false, error: res.reason?.message }
      );
    }
  }

  return results;
}
