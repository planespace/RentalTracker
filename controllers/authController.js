//controllers/autController.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

async function register(req, res) {
  try {
    let { name, email, password } = req.body;
    let matchingUser = await User.findOne({ email });
    if (matchingUser) {
      return res.status(409).json({ message: "Email already exists" });
    }
    let hashedPassword = await bcrypt.hash(password, 10);
    let newUser = new User({ name, email, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: "Successfully registered user" });
  } catch (error) {
    console.log("Error creating user:", error);
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
    console.log("Failed to login", error);
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

export { register, login, getUserProfile, updateUserProfile };
