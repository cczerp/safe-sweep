const ethers = require("ethers");

/**
 * TxPool Monitor (Premium Tier Feature)
 *
 * Uses txpool_content RPC method to get entire mempool in ONE call instead of
 * individual eth_getTransactionByHash calls for each pending transaction.
 *
 * Benefits:
 * - Much faster: 1 call vs thousands of calls
 * - Lower latency: ~50-100ms vs ~500-1000ms
 * - More complete: see ALL pending transactions at once
 * - Better for high-frequency monitoring
 *
 * Available on dRPC premium tier (pay-as-you-go).
 */
class TxPoolMonitor {
  constructor(config) {
    this.config = config;
    this.provider = null;
    this.enabled = false;
    this.scanInterval = null;
    this.lastScanTime = 0;
    this.scanIntervalMs = 500; // Scan every 500ms

    this.stats = {
      scans: 0,
      totalTxsSeen: 0,
      avgTxsPerScan: 0,
      avgScanTime: 0,
      errors: 0,
    };
  }

  async initialize() {
    console.log("\n🔍 Initializing TxPool Monitor (Premium)...");

    if (!this.config.drpcHttp) {
      console.log("   ⚠️  No dRPC HTTP configured - txpool monitoring disabled");
      return false;
    }

    try {
      this.provider = new ethers.providers.JsonRpcProvider(this.config.drpcHttp);

      // Test if txpool_content is available
      await this.testTxPoolAccess();

      console.log("   ✅ TxPool monitor active (premium tier)");
      console.log(`   ⏱️  Scanning every ${this.scanIntervalMs}ms`);
      this.enabled = true;
      return true;
    } catch (error) {
      console.error("   ❌ TxPool access failed:", error.message);
      console.log("   ℹ️  Falling back to WebSocket pending transactions");
      return false;
    }
  }

  async testTxPoolAccess() {
    try {
      const result = await this.provider.send("txpool_content", []);
      console.log(`   ✅ txpool_content available (${Object.keys(result.pending || {}).length} pending txs)`);
      return true;
    } catch (error) {
      throw new Error(`txpool_content not available: ${error.message}`);
    }
  }

  /**
   * Start continuous monitoring of the transaction pool
   */
  startMonitoring(onTransactionDetected) {
    if (!this.enabled) {
      console.log("⚠️  TxPool monitor not enabled");
      return;
    }

    console.log("\n🎯 Starting TxPool continuous monitoring...");

    this.scanInterval = setInterval(async () => {
      await this.scanTxPool(onTransactionDetected);
    }, this.scanIntervalMs);
  }

  /**
   * Scan the transaction pool and invoke callback for each transaction
   */
  async scanTxPool(onTransactionDetected) {
    if (!this.enabled) return;

    const startTime = Date.now();

    try {
      // Get entire mempool in one call
      const txpool = await this.provider.send("txpool_content", []);
      const pending = txpool.pending || {};

      const txCount = Object.values(pending).reduce((sum, accountTxs) => {
        return sum + Object.keys(accountTxs).length;
      }, 0);

      this.stats.scans++;
      this.stats.totalTxsSeen += txCount;
      this.stats.avgTxsPerScan = Math.floor(this.stats.totalTxsSeen / this.stats.scans);

      // Process each transaction
      for (const [fromAddress, accountTxs] of Object.entries(pending)) {
        for (const [nonce, tx] of Object.entries(accountTxs)) {
          // Normalize transaction format to match eth_getTransaction
          const normalizedTx = this.normalizeTxFormat(tx, fromAddress);

          // Invoke callback with the transaction
          if (onTransactionDetected) {
            await onTransactionDetected(normalizedTx);
          }
        }
      }

      const scanTime = Date.now() - startTime;
      this.lastScanTime = scanTime;
      this.stats.avgScanTime = Math.floor(
        (this.stats.avgScanTime * (this.stats.scans - 1) + scanTime) / this.stats.scans
      );

      if (this.config.debug && txCount > 0) {
        console.log(
          `📊 TxPool scan: ${txCount} txs in ${scanTime}ms (avg: ${this.stats.avgScanTime}ms, ${this.stats.avgTxsPerScan} txs/scan)`
        );
      }
    } catch (error) {
      this.stats.errors++;
      if (this.config.debug) {
        console.error(`❌ TxPool scan failed:`, error.message);
      }
    }
  }

  /**
   * Normalize txpool_content transaction format to match eth_getTransaction
   */
  normalizeTxFormat(tx, fromAddress) {
    return {
      hash: tx.hash,
      from: fromAddress,
      to: tx.to,
      value: tx.value,
      data: tx.input || tx.data,
      nonce: parseInt(tx.nonce, 16),
      gasLimit: tx.gas,
      gasPrice: tx.gasPrice,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      type: tx.type,
      chainId: tx.chainId,
    };
  }

  stopMonitoring() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
      console.log("🛑 TxPool monitoring stopped");
    }
  }

  getStats() {
    return {
      ...this.stats,
      enabled: this.enabled,
      lastScanTime: this.lastScanTime,
    };
  }

  printStatus() {
    if (!this.enabled) return;

    console.log("\n📊 TXPOOL MONITOR STATUS:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━");
    const stats = this.getStats();
    console.log(`   Scans: ${stats.scans}`);
    console.log(`   Total Txs Seen: ${stats.totalTxsSeen}`);
    console.log(`   Avg Txs/Scan: ${stats.avgTxsPerScan}`);
    console.log(`   Avg Scan Time: ${stats.avgScanTime}ms`);
    console.log(`   Last Scan Time: ${stats.lastScanTime}ms`);
    console.log(`   Errors: ${stats.errors}`);
  }
}

module.exports = { TxPoolMonitor };
