// config/db.js
let express = require("express");
let mongoose = require("mongoose");
// Connection and port and listen
async function connectTOMongoDB() {
  mongoose
    .connect("mongodb://127.0.0.1:27017/rental_tracker")
    .then(() => {
      console.log("Successfully connected to mongodb ✅");
    })
    .catch((error) => {
      console.log("Error connecting to mongoDB ❌: ", error);
    });
}

module.exports = connectTOMongoDB;
