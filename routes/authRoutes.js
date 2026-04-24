const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const {
  register,
  login,
  getUserProfile,
  updateUserProfile,
} = require("../controllers/authController");

router.post("/register", register);
router.post("/login", login);
router.get("/profile", authMiddleware, getUserProfile);
router.patch("/profile", authMiddleware, updateUserProfile);

module.exports = router;
