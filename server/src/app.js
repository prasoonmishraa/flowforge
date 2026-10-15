import express from "express";
import cors from "cors";
import helmet from "helmet";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";

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

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
