//controllers/autController.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import crypto from "crypto";
async function register(req, res) {
  try {
    let { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required." });
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters." });
    }

    let matchingUser = await User.findOne({ email });
    if (matchingUser) {
      return res.status(409).json({ message: "Email already exists" });
    }
    let hashedPassword = await bcrypt.hash(password, 10);
    let newUser = new User({ name, email, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: "Successfully registered user" });
  } catch (error) {
    res.status(500).json({ message: "Registration failed. Please try again." });
  }
}

async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required." });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      // Don't reveal whether the email exists – still return success
      return res.json({
        success: true,
        message: "If that email is registered, a reset link has been sent.",
      });
    }

    // Generate a reset token
    const token = crypto.randomBytes(32).toString("hex");
    user.resetToken = token;
    user.resetTokenExpiry = Date.now() + 3600000; // 1 hour
    await user.save();

    // Send email with reset link
    const resetUrl = `${req.protocol}://${req.get(
      "host"
    )}/reset-password.html?token=${token}`;
    const htmlBody = `
      <p>You requested a password reset for your Paradise Suites account.</p>
      <p>Click the link below to choose a new password (valid for 1 hour):</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>If you didn't request this, ignore this email.</p>
    `;

    // Use the existing email service
    const { sendEmail } = await import("../services/emailService.js");
    await sendEmail(
      user.email,
      user.name,
      "Password Reset – Paradise Suites",
      htmlBody,
      user._id.toString()
    );

    res.json({
      success: true,
      message: "If that email is registered, a reset link has been sent.",
    });
  } catch (error) {
    // 🔁 FIX: Hide the raw error from the client
    console.error("Forgot password error:", error); // keep detailed log for you
    res
      .status(500)
      .json({ message: "Could not send reset email. Please try again later." });
  }
}

async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword)
      return res
        .status(400)
        .json({ message: "Token and new password are required." });

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() },
    });

    if (!user)
      return res.status(400).json({ message: "Invalid or expired token." });

    // Hash the new password (use the same bcrypt setup as register)
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();

    res.json({
      success: true,
      message: "Password updated. You can now log in.",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function login(req, res) {
  try {
    let { email, password } = req.body;
    let matchingUser = await User.findOne({ email });
    if (!matchingUser) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const isMatch = await bcrypt.compare(password, matchingUser.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const token = jwt.sign({ id: matchingUser._id }, process.env.JWT_SECRET, {
      expiresIn: "365d",
    });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ message: "Registration failed" });
  }
}

async function getUserProfile(req, res) {
  try {
    const user = await User.findById(req.userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function checkEmail(req, res) {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: "Email required" });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    res.json({ exists: !!user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateUserProfile(req, res) {
  try {
    const { name, email, phone, landlordName } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;
    if (phone !== undefined) user.phone = phone;
    if (landlordName !== undefined) user.landlordName = landlordName;
    await user.save();
    const { password, ...userWithoutPassword } = user.toObject();
    res.json({ user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function changePassword(req, res) {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Both old and new passwords are required." });
    }
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "New password must be at least 6 characters." });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Old password is incorrect." });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true, message: "Password changed successfully." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// Already existing forgotPassword and resetPassword functions – I'll include them here as well for clarity, but you only need to add them if you haven't already.
// (You already added forgotPassword / resetPassword earlier – if not, add them from the previous message.)

export {
  register,
  login,
  getUserProfile,
  updateUserProfile,
  forgotPassword,
  resetPassword,
  changePassword,
  checkEmail,
};
