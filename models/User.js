//models/User.js
let mongoose = require("mongoose");
const { register } = require("node:module");

let userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  phone: { type: String, default: "" },
  landlordName: { type: String, default: "" },
});

let User = mongoose.model("User", userSchema);

module.exports = User;
