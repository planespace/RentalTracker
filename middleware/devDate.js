// middleware/devDate.js

import mockdate from "mockdate";

function devDateMiddleware(req, res, next) {
  // In production, only activate if the request contains the X-Dev-Date header
  // (the frontend only sends it when ?dev=true is in the URL).
  const devDateHeader = req.headers["x-dev-date"];
  if (!devDateHeader) return next(); // no header → normal operation

  // Dev mode is requested – load mockdate dynamically

  const parsedDate = new Date(devDateHeader);
  if (!isNaN(parsedDate.getTime())) {
    mockdate.set(parsedDate);
  }

  res.on("finish", () => {
    mockdate.reset();
  });

  next();
}

export default devDateMiddleware;
