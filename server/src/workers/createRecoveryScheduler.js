export function createRecoveryScheduler({
  recoverExpiredExecutions,
  intervalMs = 30_000,
  logger = console,
  schedule = setInterval,
  cancel = clearInterval,
}) {
  let isShuttingDown = false;
  let scanPromise = null;
  let intervalId = null;

  async function runScan() {
    if (isShuttingDown || scanPromise) {
      return;
    }

    const currentScan = (async () => {
      try {
        const result = await recoverExpiredExecutions();

        logger.log(
          `[Recovery] Scanned: ${result.scannedCount}, submitted: ${result.enqueuedCount}`,
        );
      } catch (error) {
        logger.error("[Recovery] Scan failed:", error);
      }
    })();

    scanPromise = currentScan;

    try {
      await currentScan;
    } finally {
      if (scanPromise === currentScan) {
        scanPromise = null;
      }
    }
  }

  async function start() {
    logger.log("[Recovery] Scheduler started");
    logger.log("[Recovery] Running initial scan...");

    await runScan();

    if (!isShuttingDown) {
      intervalId = schedule(() => {
        void runScan();
      }, intervalMs);

      logger.log(
        `[Recovery] Next scan scheduled in ${intervalMs / 1000} seconds`,
      );
    }
  }

  async function stop() {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

    if (intervalId !== null) {
      cancel(intervalId);
      intervalId = null;
    }

    if (scanPromise) {
      await scanPromise;
    }
  }

  return { start, stop };
}
