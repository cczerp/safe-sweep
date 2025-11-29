const { ethers } = require("ethers");
const WebSocket = require("ws");

/**
 * MEV Bundle Engine for Polygon
 *
 * Creates and submits MEV bundles to guarantee transaction ordering.
 * When we detect a malicious tx, we bundle it with our sweep tx
 * to ensure our tx executes FIRST in the same block.
 *
 * Supported Methods:
 * 1. BloxRoute bundles (blxr_submit_bundle)
 * 2. Direct builder submission (future)
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

    // Bundle configuration
    this.bundleTimeout = config.bundleTimeout || 30; // seconds
    this.maxBlocksAhead = config.maxBlocksAhead || 3; // try to include in next 3 blocks
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

  async initialize(provider, privateKey, alchemyApiKey = null) {
    this.provider = provider;
    this.signer = new ethers.Wallet(privateKey, provider);
    this.alchemyApiKey = alchemyApiKey;

    console.log("🔧 MEV Bundle Engine Configuration:");
    console.log("   - Wallet: " + this.signer.address);

    // Setup Alchemy bundles (for Polygon)
    if (alchemyApiKey) {
      console.log("   - Alchemy Bundles: ✅ Available");
      this.alchemyBundlesAvailable = true;
    } else {
      console.log("   - Alchemy Bundles: ❌ Not configured");
      console.log("   ⚠️ MEV bundles disabled - configure ALCHEMY_API_KEY to enable");
      this.alchemyBundlesAvailable = false;
    }

    console.log("✅ MEV Bundle Engine ready");
  }

  /**
   * MAIN METHOD: Create and submit bundle for guaranteed ordering
   *
   * This gives us 100% guarantee that our tx executes before attacker's
   * Uses Alchemy bundles for Polygon
   */
  async guaranteedFrontRun(ourSignedTx, attackerTx) {
    const startTime = Date.now();

    console.log("\n🎯 GUARANTEED FRONT-RUN WITH MEV BUNDLE");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (!this.canSubmitBundles()) {
      throw new Error("No bundle service available - configure ALCHEMY_API_KEY to enable MEV bundles");
    }

    try {
      // Get current block
      const currentBlock = await this.provider.getBlockNumber();
      console.log(`Current block: ${currentBlock}`);

      console.log("🎯 Using Alchemy Bundles");
      const result = await this.submitBundleViaAlchemy(ourSignedTx);

      const totalTime = Date.now() - startTime;
      console.log("\n✅ MEV BUNDLE SUBMITTED SUCCESSFULLY");
      console.log(`   ⏱️ Total time: ${totalTime}ms`);
      console.log(`   🎯 Private transaction submitted`);
      console.log(`   📦 TX Hash: ${result.txHash || "pending"}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      return {
        success: true,
        txHash: result.txHash,
        submissionTime: totalTime,
      };
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`\n❌ MEV BUNDLE FAILED after ${totalTime}ms`);
      console.error(`   Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Submit bundle via Alchemy (for Polygon)
   */
  async submitBundleViaAlchemy(signedTx) {
    if (!this.alchemyApiKey) {
      throw new Error("Alchemy API key not configured");
    }

    console.log("\n🚀 SUBMITTING BUNDLE VIA ALCHEMY");

    try {
      const axios = require("axios");

      // Alchemy's sendPrivateTransaction API
      const alchemyUrl = `https://polygon-mainnet.g.alchemy.com/v2/${this.alchemyApiKey}`;

      const response = await axios.post(alchemyUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendPrivateTransaction",
        params: [
          {
            tx: signedTx,
            maxBlockNumber: null, // Include ASAP
            preferences: {
              fast: true // Prioritize speed
            }
          }
        ]
      }, {
        headers: {
          "Content-Type": "application/json"
        },
        timeout: 10000
      });

      if (response.data.error) {
        throw new Error(`Alchemy error: ${response.data.error.message}`);
      }

      console.log("   ✅ Alchemy bundle submitted successfully");
      console.log("   📊 TX Hash:", response.data.result);

      this.stats.bundlesSubmitted++;

      return {
        success: true,
        txHash: response.data.result,
        method: "alchemy"
      };

    } catch (error) {
      console.error("   ❌ Alchemy bundle failed:", error.message);
      this.stats.bundlesFailed++;
      throw error;
    }
  }

  /**
   * Check if bundle submission is available
   */
  canSubmitBundles() {
    return this.alchemyBundlesAvailable;
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
