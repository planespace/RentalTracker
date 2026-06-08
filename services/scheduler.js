//services/scheduler.js
import cron from "node-cron";
import { sendOverdueRemindersForUser } from "./smsService.js";
import { sendOverdueEmailRemindersForUser } from "./emailService.js";
// This function will run daily for each user (you can extend to iterate over all users)
export function startScheduler() {
  // Run every day at 8:00 AM Nairobi time
  cron.schedule(
    "0 1 * * *",
    async () => {
      console.log("⏰ Running daily overdue reminders...");
      // You need to get all unique userIds from tenants
      // For simplicity, you can store users in a collection and loop.
      // Here I assume you have a User model and you want to send for every landlord.
      const User = (await import("../models/User.js")).default;
      const users = await User.find({}, "_id");
      for (const user of users) {
        try {
          await sendOverdueRemindersForUser(user._id.toString());
        } catch (err) {
          console.error(`Failed for user ${user._id}:`, err);
        }
      }
    },
    {
      timezone: "Africa/Nairobi",
    }
  );
  console.log("✅ SMS reminder scheduler started.");
}

// Email reminders at 9:00 AM Nairobi time
cron.schedule(
  "0 1 * * *",
  async () => {
    console.log("⏰ Running daily email reminders...");
    const User = (await import("../models/User.js")).default;
    const users = await User.find({}, "_id");
    for (const user of users) {
      try {
        await sendOverdueEmailRemindersForUser(user._id.toString());
      } catch (err) {
        console.error(`Email reminder failed for user ${user._id}:`, err);
      }
    }
  },
  { timezone: "Africa/Nairobi" }
);
