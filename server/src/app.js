import express from "express";
import cors from "cors";
import helmet from "helmet";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import pool from "./db.js";

const app = express();

app.use(helmet());

app.use(cors());

app.use(express.json());

// Health-check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "flowforge-api",
  });
});

app.get("/api/workflows", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, is_active, created_at
       FROM workflows
       ORDER BY created_at DESC`
    );

    res.status(200).json({
      workflows: result.rows,
    });
  } catch (error) {
    next(error);
  }
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
