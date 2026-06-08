//models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  phone: { type: String, default: "" },
  landlordName: { type: String, default: "" },
  resetToken: { type: String, default: null },
  resetTokenExpiry: { type: Date, default: null },
});

const User = mongoose.model("User", userSchema);
export default User;
