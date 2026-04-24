// config/db.js
const mongoose = require("mongoose");

async function connectTOMongoDB() {
  // Use the environment variable if available, otherwise fall back to local
  const uri =
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/rental_tracker";

  await mongoose.connect(uri);
  console.log(`✅ Successfully connected to MongoDB`);
}

module.exports = connectTOMongoDB;
