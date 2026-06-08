//routes/authRoutes.js

import express from "express";
const router = express.Router();
import authMiddleware from "../middleware/auth.js";
import {
  register,
  login,
  getUserProfile,
  updateUserProfile,
  resetPassword,
  forgotPassword,
  changePassword,
} from "../controllers/authController.js";

router.post("/register", register);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/login", login);
router.get("/profile", authMiddleware, getUserProfile);
router.patch("/profile", authMiddleware, updateUserProfile);
router.patch("/change-password", authMiddleware, changePassword);
export default router;
