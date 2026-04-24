// middleware/devDate.js

function devDateMiddleware(req, res, next) {
  // In production, do nothing – not even require mockdate.
  if (process.env.NODE_ENV === "production") return next();

  // Non‑production: load mockdate dynamically
  const mockdate = require("mockdate");

  const devDateHeader = req.headers["x-dev-date"];
  if (devDateHeader) {
    const parsedDate = new Date(devDateHeader);
    if (!isNaN(parsedDate.getTime())) {
      mockdate.set(parsedDate);
    }
  }

  res.on("finish", () => {
    mockdate.reset();
  });

  next();
}

module.exports = devDateMiddleware;
