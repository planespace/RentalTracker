// config/db.js
import mongoose from "mongoose";
async function connectTOMongoDB() {
  const uri =
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/rental_tracker";
  await mongoose.connect(uri);
  console.log("✅ Successfully connected to MongoDB");
}
export default connectTOMongoDB;
