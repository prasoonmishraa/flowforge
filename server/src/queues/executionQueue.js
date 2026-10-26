import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis({
  host: "127.0.0.1",
  port: 6379,
});

const executionQueue = new Queue("execution", {
  connection,
});

export default executionQueue;
