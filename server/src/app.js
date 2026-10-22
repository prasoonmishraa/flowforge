import express from "express";
import cors from "cors";
import helmet from "helmet";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import pool from "./db.js";
import {
  createWorkflowSchema,
  updateWorkflowSchema,
} from "./validators/workflowValidator.js";
import { isValidWorkflowId } from "./utils/validateWorkflowId.js";

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
       ORDER BY created_at DESC`,
    );

    res.status(200).json({
      workflows: result.rows,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/workflows/:id", async (req, res, next) => {
  if (!isValidWorkflowId(req.params.id)) {
    return res.status(400).json({
      error: {
        code: "INVALID_WORKFLOW_ID",
        message: "Workflow ID must be a positive integer",
      },
    });
  }
  try {
    const result = await pool.query(
      `SELECT id, name, description, is_active, created_at
       FROM workflows
       WHERE id = $1`,
      [req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: "WORKFLOW_NOT_FOUND",
          message: "Workflow not found",
        },
      });
    }

    return res.status(200).json({
      workflow: result.rows[0],
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/workflows", async (req, res, next) => {
  const validation = createWorkflowSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid workflow data",
        details: validation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }

  const { name, description } = validation.data;

  try {
    const result = await pool.query(
      `INSERT INTO workflows (name, description)
       VALUES ($1, $2)
       RETURNING id, name, description, is_active, created_at`,
      [name, description ?? null],
    );

    return res.status(201).json({
      workflow: result.rows[0],
    });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/workflows/:id", async (req, res, next) => {
  const validation = updateWorkflowSchema.safeParse(req.body);
  if (!isValidWorkflowId(req.params.id)) {
    return res.status(400).json({
      error: {
        code: "INVALID_WORKFLOW_ID",
        message: "Workflow ID must be a positive integer",
      },
    });
  }

  if (!validation.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid workflow data",
        details: validation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }

  const fields = validation.data;
  const values = [];
  const updates = [];

  for (const [field, value] of Object.entries(fields)) {
    values.push(value);
    updates.push(`${field} = $${values.length}`);
  }

  values.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE workflows
       SET ${updates.join(", ")}
       WHERE id = $${values.length}
       RETURNING id, name, description, is_active, created_at`,
      values,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: "WORKFLOW_NOT_FOUND",
          message: "Workflow not found",
        },
      });
    }

    return res.status(200).json({
      workflow: result.rows[0],
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/workflows/:id/executions", async (req, res, next) => {
  if (!isValidWorkflowId(req.params.id)) {
    return res.status(400).json({
      error: {
        code: "INVALID_WORKFLOW_ID",
        message: "Workflow ID must be a positive integer",
      },
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const workflowResult = await client.query(
      `SELECT id, is_active
       FROM workflows
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id],
    );

    if (workflowResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: {
          code: "WORKFLOW_NOT_FOUND",
          message: "Workflow not found",
        },
      });
    }

    if (!workflowResult.rows[0].is_active) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: {
          code: "WORKFLOW_INACTIVE",
          message: "Cannot execute an inactive workflow",
        },
      });
    }

    const executionResult = await client.query(
      `INSERT INTO executions (workflow_id, status)
       VALUES ($1, $2)
       RETURNING id, workflow_id, status, started_at, finished_at, created_at`,
      [req.params.id, "pending"],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      execution: executionResult.rows[0],
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }

    return next(error);
  } finally {
    client?.release();
  }
});

app.get("/api/workflows/:id/executions", async (req, res, next) => {
  const { id } = req.params;

  if (!isValidWorkflowId(id)) {
    return res.status(400).json({
      error: {
        code: "INVALID_WORKFLOW_ID",
        message: "Workflow ID must be a positive integer",
      },
    });
  }

  let client;

  try {
    client = await pool.connect();

    const workflowResult = await client.query(
      "SELECT id FROM workflows WHERE id = $1",
      [id],
    );

    if (workflowResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: "WORKFLOW_NOT_FOUND",
          message: "Workflow not found",
        },
      });
    }

    const executionsResult = await client.query(
      `SELECT id, workflow_id, status, started_at, finished_at, created_at
       FROM executions
       WHERE workflow_id = $1
       ORDER BY created_at DESC`,
      [id],
    );

    return res.status(200).json({
      executions: executionsResult.rows,
    });
  } catch (error) {
    return next(error);
  } finally {
    client?.release();
  }
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
