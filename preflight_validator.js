const ethers = require("ethers");

/**
 * Pre-Flight Validator (Premium Tier Feature)
 *
 * Uses trace_call and debug_traceCall to simulate sweep transactions BEFORE
 * sending them to the network. This ensures they will succeed and helps catch:
 * - Insufficient gas
 * - Contract reverts
 * - Nonce conflicts
 * - Balance issues
 *
 * Benefits:
 * - Don't waste gas on failed transactions
 * - Faster debugging (know WHY it will fail)
 * - Can adjust parameters before sending
 * - Higher success rate
 *
 * Available on dRPC premium tier.
 */
class PreFlightValidator {
  constructor(config) {
    this.config = config;
    this.provider = null;
    this.enabled = false;

    this.stats = {
      validations: 0,
      passed: 0,
      failed: 0,
      avgValidationTime: 0,
    };
  }

  async initialize() {
    console.log("\n✈️  Initializing Pre-Flight Validator (Premium)...");

    if (!this.config.drpcHttp) {
      console.log("   ⚠️  No dRPC HTTP configured - pre-flight validation disabled");
      return false;
    }

    try {
      this.provider = new ethers.providers.JsonRpcProvider(this.config.drpcHttp);

      // Test if trace_call is available
      await this.testTraceAccess();

      console.log("   ✅ Pre-flight validator active");
      this.enabled = true;
      return true;
    } catch (error) {
      console.error("   ❌ Trace access failed:", error.message);
      console.log("   ℹ️  Proceeding without pre-flight validation");
      return false;
    }
  }

  async testTraceAccess() {
    try {
      // Test trace_call with a simple transaction
      await this.provider.send("trace_call", [
        {
          from: "0x0000000000000000000000000000000000000000",
          to: "0x0000000000000000000000000000000000000000",
          value: "0x0",
        },
        ["trace"],
        "latest",
      ]);
      console.log("   ✅ trace_call available");
      return true;
    } catch (error) {
      throw new Error(`trace_call not available: ${error.message}`);
    }
  }

  /**
   * Validate a signed transaction before broadcasting
   */
  async validateTransaction(signedTx) {
    if (!this.enabled) {
      return { valid: true, reason: "validator_disabled" };
    }

    const startTime = Date.now();
    this.stats.validations++;

    try {
      // Parse the signed transaction
      const tx = ethers.utils.parseTransaction(signedTx);

      if (this.config.debug) {
        console.log(`\n✈️  PRE-FLIGHT: Simulating transaction...`);
        console.log(`   From: ${tx.from}`);
        console.log(`   To: ${tx.to}`);
        console.log(`   Gas: ${tx.gasLimit.toString()}`);
        console.log(`   MaxFee: ${ethers.utils.formatUnits(tx.maxFeePerGas, "gwei")} gwei`);
      }

      // Method 1: Use trace_call to simulate
      const traceResult = await this.simulateWithTrace(tx);

      // Method 2: Use debug_traceCall for detailed info (if trace_call passes)
      let debugInfo = null;
      if (traceResult.success && this.config.verbose) {
        debugInfo = await this.simulateWithDebug(tx);
      }

      const validationTime = Date.now() - startTime;
      this.stats.avgValidationTime = Math.floor(
        (this.stats.avgValidationTime * (this.stats.validations - 1) + validationTime) /
          this.stats.validations
      );

      if (traceResult.success) {
        this.stats.passed++;
        if (this.config.debug) {
          console.log(`   ✅ PRE-FLIGHT PASSED (${validationTime}ms)`);
          if (debugInfo) {
            console.log(`   Gas Used: ${debugInfo.gasUsed} / ${tx.gasLimit.toString()}`);
          }
        }
        return {
          valid: true,
          gasUsed: debugInfo?.gasUsed,
          validationTime,
        };
      } else {
        this.stats.failed++;
        console.log(`   ❌ PRE-FLIGHT FAILED (${validationTime}ms)`);
        console.log(`   Reason: ${traceResult.error}`);
        return {
          valid: false,
          reason: traceResult.error,
          validationTime,
        };
      }
    } catch (error) {
      this.stats.failed++;
      console.error(`   ❌ PRE-FLIGHT ERROR:`, error.message);
      return {
        valid: false,
        reason: error.message,
      };
    }
  }

  /**
   * Simulate transaction using trace_call
   */
  async simulateWithTrace(tx) {
    try {
      const result = await this.provider.send("trace_call", [
        {
          from: tx.from,
          to: tx.to,
          gas: ethers.utils.hexValue(tx.gasLimit),
          gasPrice: tx.gasPrice ? ethers.utils.hexValue(tx.gasPrice) : undefined,
          maxFeePerGas: tx.maxFeePerGas ? ethers.utils.hexValue(tx.maxFeePerGas) : undefined,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas
            ? ethers.utils.hexValue(tx.maxPriorityFeePerGas)
            : undefined,
          value: ethers.utils.hexValue(tx.value),
          data: tx.data,
        },
        ["trace"],
        "latest",
      ]);

      // Check if transaction would revert
      if (result.output === "0x") {
        // Empty output might indicate revert
        return { success: false, error: "Transaction would revert (empty output)" };
      }

      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Simulate transaction using debug_traceCall for detailed analysis
   */
  async simulateWithDebug(tx) {
    try {
      const result = await this.provider.send("debug_traceCall", [
        {
          from: tx.from,
          to: tx.to,
          gas: ethers.utils.hexValue(tx.gasLimit),
          gasPrice: tx.gasPrice ? ethers.utils.hexValue(tx.gasPrice) : undefined,
          maxFeePerGas: tx.maxFeePerGas ? ethers.utils.hexValue(tx.maxFeePerGas) : undefined,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas
            ? ethers.utils.hexValue(tx.maxPriorityFeePerGas)
            : undefined,
          value: ethers.utils.hexValue(tx.value),
          data: tx.data,
        },
        "latest",
        {
          // Get gas usage without full step-by-step trace
          tracer: "callTracer",
        },
      ]);

      return {
        gasUsed: result.gasUsed ? parseInt(result.gasUsed, 16) : null,
        output: result.output,
      };
    } catch (error) {
      // Debug trace failed, but that's ok
      return null;
    }
  }

  /**
   * Analyze why a transaction failed using debug_traceTransaction
   * (after it's already been broadcast and failed)
   */
  async analyzeFailedTransaction(txHash) {
    if (!this.enabled) {
      console.log("⚠️  Pre-flight validator not enabled");
      return null;
    }

    try {
      console.log(`\n🔍 ANALYZING FAILED TRANSACTION: ${txHash}`);

      const result = await this.provider.send("debug_traceTransaction", [
        txHash,
        {
          tracer: "callTracer",
        },
      ]);

      console.log(`   Type: ${result.type}`);
      console.log(`   Gas Used: ${parseInt(result.gasUsed, 16)}`);

      if (result.error) {
        console.log(`   ❌ Error: ${result.error}`);
      }

      if (result.revertReason) {
        console.log(`   ❌ Revert Reason: ${result.revertReason}`);
      }

      return result;
    } catch (error) {
      console.error(`❌ Failed to analyze transaction:`, error.message);
      return null;
    }
  }

  getStats() {
    return {
      ...this.stats,
      enabled: this.enabled,
      successRate: this.stats.validations > 0 ? (this.stats.passed / this.stats.validations) * 100 : 0,
    };
  }

  printStatus() {
    if (!this.enabled) return;

    console.log("\n✈️  PRE-FLIGHT VALIDATOR STATUS:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    const stats = this.getStats();
    console.log(`   Validations: ${stats.validations}`);
    console.log(`   Passed: ${stats.passed}`);
    console.log(`   Failed: ${stats.failed}`);
    console.log(`   Success Rate: ${stats.successRate.toFixed(1)}%`);
    console.log(`   Avg Validation Time: ${stats.avgValidationTime}ms`);
  }
}

module.exports = { PreFlightValidator };
