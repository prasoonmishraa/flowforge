import executionQueue from "../queues/executionQueue.js";

try {
  const job = await executionQueue.add("test-job", {
    message: "Hello from FlowForge",
  });

  console.log(`Added job ${job.id}`);
} catch (error) {
  console.error("Failed to enqueue job:", error);
  process.exitCode = 1;
} finally {
  await executionQueue.close();
}