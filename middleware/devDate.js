// middleware/devDate.js
const mockdate = require("mockdate");

function devDateMiddleware(req, res, next) {
  // Only allow in non‑production environments
  if (process.env.NODE_ENV === "production") return next();

  const devDateHeader = req.headers["x-dev-date"];
  if (devDateHeader) {
    const parsedDate = new Date(devDateHeader);
    if (!isNaN(parsedDate.getTime())) {
      mockdate.set(parsedDate);
    }
  }

  // Reset after the response finishes
  res.on("finish", () => {
    mockdate.reset();
  });

  next();
}

module.exports = devDateMiddleware;
