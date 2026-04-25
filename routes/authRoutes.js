//routes/authRoutes.js

import express from "express";
const router = express.Router();
import authMiddleware from "../middleware/auth.js";
import {
  register,
  login,
  getUserProfile,
  updateUserProfile,
} from "../controllers/authController.js";

router.post("/register", register);
router.post("/login", login);
router.get("/profile", authMiddleware, getUserProfile);
router.patch("/profile", authMiddleware, updateUserProfile);

export default router;
