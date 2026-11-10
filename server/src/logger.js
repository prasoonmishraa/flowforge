import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: {
    application: "flowforge",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
