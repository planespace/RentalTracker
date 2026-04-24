//server.js

require("dotenv").config();
let express = require("express");
let mongoose = require("mongoose");
let cors = require("cors");
let connectTOMongoDB = require("./config/db");
let app = express();
let tenantRoutes = require("./routes/tenantRoutes");
let authRoutes = require("./routes/authRoutes");
const devDateMiddleware = require("./middleware/devDate");
app.use(devDateMiddleware);
app.use(express.json());
app.use(cors());
const path = require("path");
// Serve static files from the current directory (where mainPage.html, login.html, etc. live)
app.use(express.static(path.join(__dirname)));
app.use("/tenants", tenantRoutes);
app.use("/auth", authRoutes);

connectTOMongoDB().then(() => {
  // Run sync on startup
  const {
    syncAllTenantsToCurrentMonth,
  } = require("./controllers/tenantController");
  syncAllTenantsToCurrentMonth();
  // Then every hour
  setInterval(syncAllTenantsToCurrentMonth, 60 * 60 * 1000);
});

let PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server successfully started on port ${PORT}`);
});
