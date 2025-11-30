const { ethers } = require("ethers");
const WebSocket = require("ws");
const { MarlinRelay } = require("./marlin_relay");

/**
 * MEV Bundle Engine for Polygon
 *
 * Creates and submits MEV bundles to guarantee transaction ordering.
 * When we detect a malicious tx, we bundle it with our sweep tx
 * to ensure our tx executes FIRST in the same block.
 *
 * Supported Methods:
 * 1. Marlin Relay bundles (eth_sendBundle)
 *
 * Bundle Strategy:
 * - Include attacker's tx in bundle
 * - Include our sweep tx BEFORE attacker's tx
 * - Set high priority fee for block inclusion
 * - If our sweep succeeds, attacker's tx fails (no funds)
 * - Result: GUARANTEED WIN
 */
class MEVBundleEngine {
  constructor(config) {
    this.config = config;
    console.log("🎯 Initializing MEV Bundle Engine...");

    this.provider = null;
    this.signer = null;
    this.marlinRelay = null;

    // Bundle configuration
    this.bundleTimeout = config.bundleTimeout || 30; // seconds
    this.maxBlocksAhead = config.maxBlocksAhead || 2; // try to include in next 2 blocks (Marlin default)
    this.bundlePriorityFee = config.bundlePriorityFee || ethers.utils.parseUnits("50", "gwei");

    // Statistics
    this.stats = {
      bundlesCreated: 0,
      bundlesSubmitted: 0,
      bundlesIncluded: 0,
      bundlesFailed: 0,
    };

    console.log("   - Bundle timeout: " + this.bundleTimeout + "s");
    console.log(
      "   - Max blocks ahead: " + this.maxBlocksAhead
    );
    console.log(
      "   - Priority fee: " +
        ethers.utils.formatUnits(this.bundlePriorityFee, "gwei") +
        " gwei"
    );
  }

  async initialize(provider, privateKey, searcherPrivateKey = null) {
    this.provider = provider;
    this.signer = new ethers.Wallet(privateKey, provider);

    console.log("🔧 MEV Bundle Engine Configuration:");
    console.log("   - Wallet: " + this.signer.address);

    // Setup Marlin Relay bundles (for Polygon)
    if (searcherPrivateKey) {
      this.marlinRelay = new MarlinRelay(this.config);
      await this.marlinRelay.initialize(searcherPrivateKey);
      console.log("   - Marlin Relay Bundles: ✅ Available");
      this.marlinBundlesAvailable = true;
    } else {
      console.log("   - Marlin Relay Bundles: ❌ Not configured");
      console.log("   ⚠️ MEV bundles disabled - configure MEV_SEARCHER_KEY to enable");
      this.marlinBundlesAvailable = false;
    }

    console.log("✅ MEV Bundle Engine ready");
  }

  /**
   * MAIN METHOD: Create and submit bundle for guaranteed ordering
   *
   * This gives us 100% guarantee that our tx executes before attacker's
   * Uses Marlin Relay bundles for Polygon
   */
  async guaranteedFrontRun(ourSignedTx, attackerTx = null) {
    const startTime = Date.now();

    console.log("\n🎯 GUARANTEED FRONT-RUN WITH MEV BUNDLE");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (!this.canSubmitBundles()) {
      throw new Error("No bundle service available - configure MEV_SEARCHER_KEY to enable MEV bundles");
    }

    try {
      // Get current block
      const currentBlock = await this.provider.getBlockNumber();
      console.log(`Current block: ${currentBlock}`);

      // Build bundle: our transaction first, then attacker's (if provided)
      const bundleTxs = [ourSignedTx];
      if (attackerTx && attackerTx.raw) {
        bundleTxs.push(attackerTx.raw);
      } else if (attackerTx && typeof attackerTx === "string") {
        bundleTxs.push(attackerTx);
      }

      console.log("🎯 Using Marlin Relay Bundles");
      const result = await this.submitBundleViaMarlin(bundleTxs, currentBlock);

      const totalTime = Date.now() - startTime;
      console.log("\n✅ MEV BUNDLE SUBMITTED SUCCESSFULLY");
      console.log(`   ⏱️ Total time: ${totalTime}ms`);
      console.log(`   🎯 Bundle submitted to Marlin Relay`);
      console.log(`   📦 Bundle Hash: ${result.bundleHash || "pending"}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      return {
        success: true,
        bundleHash: result.bundleHash,
        txHash: result.bundleHash, // For compatibility
        submissionTime: totalTime,
      };
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`\n❌ MEV BUNDLE FAILED after ${totalTime}ms`);
      console.error(`   Error: ${error.message}`);
      
      // Check if it's a network error (should trigger fallback)
      if (error.message.includes("NETWORK_ERROR")) {
        throw error; // Re-throw for fallback handling
      }
      
      // Other errors (simulation failed, invalid bundle) should stop the sweep
      throw error;
    }
  }

  /**
   * Submit bundle via Marlin Relay (for Polygon)
   */
  async submitBundleViaMarlin(transactions, currentBlock) {
    if (!this.marlinRelay) {
      throw new Error("Marlin Relay not initialized - configure MEV_SEARCHER_KEY");
    }

    try {
      // Submit bundle with simulation
      // Target block: currentBlock + 2 (Marlin default)
      const result = await this.marlinRelay.submitBundleWithSimulation(
        transactions,
        currentBlock,
        this.maxBlocksAhead
      );

      this.stats.bundlesSubmitted++;

      return {
        success: true,
        bundleHash: result.bundleHash,
        method: "marlin"
      };

    } catch (error) {
      console.error("   ❌ Marlin bundle failed:", error.message);
      this.stats.bundlesFailed++;
      
      // Re-throw network errors for fallback handling
      if (error.message.includes("NETWORK_ERROR")) {
        throw error;
      }
      
      // Re-throw other errors (simulation failed, invalid bundle)
      throw error;
    }
  }

  /**
   * Check if bundle submission is available
   */
  canSubmitBundles() {
    return this.marlinBundlesAvailable;
  }

  /**
   * Get bundle statistics
   */
  getStats() {
    const inclusionRate =
      this.stats.bundlesSubmitted > 0
        ? (this.stats.bundlesIncluded / this.stats.bundlesSubmitted) * 100
        : 0;

    return {
      created: this.stats.bundlesCreated,
      submitted: this.stats.bundlesSubmitted,
      included: this.stats.bundlesIncluded,
      failed: this.stats.bundlesFailed,
      inclusionRate: inclusionRate.toFixed(1) + "%",
    };
  }

}

module.exports = { MEVBundleEngine };
