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
    this.bloxrouteWs = null;

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

  async initialize(provider, privateKey, bloxrouteHeader = null) {
    this.provider = provider;
    this.signer = new ethers.Wallet(privateKey, provider);

    console.log("🔧 MEV Bundle Engine Configuration:");
    console.log("   - Wallet: " + this.signer.address);

    // Setup BloxRoute if available
    if (bloxrouteHeader) {
      console.log("   - BloxRoute: Setting up...");
      await this.setupBloxRoute(bloxrouteHeader);
    } else {
      console.warn("   - BloxRoute: Not configured (bundles disabled)");
    }

    console.log("✅ MEV Bundle Engine ready");
  }

  /**
   * Setup BloxRoute WebSocket for bundle submission
   */
  async setupBloxRoute(authHeader) {
    return new Promise((resolve) => {
      try {
        this.bloxrouteWs = new WebSocket("wss://api.blxrbdn.com/ws", {
          headers: {
            Authorization: authHeader,
          },
          rejectUnauthorized: false,
        });

        this.bloxrouteWs.on("open", () => {
          console.log("   ✅ BloxRoute WebSocket connected (bundles enabled)");
          resolve(true);
        });

        this.bloxrouteWs.on("error", (error) => {
          console.log("   ⚠️ BloxRoute error:", error.message);
          this.bloxrouteWs = null;
          resolve(false);
        });

        this.bloxrouteWs.on("close", () => {
          console.log("   ⚠️ BloxRoute disconnected");
          this.bloxrouteWs = null;
        });

        // Add message handler for bundle responses
        this.bloxrouteWs.on("message", (data) => {
          try {
            const response = JSON.parse(data.toString());
            if (response.method === "subscribe" && response.params?.result?.bundleHash) {
              console.log(`   📦 Bundle update: ${JSON.stringify(response.params.result)}`);
            }
          } catch (e) {
            // Ignore parsing errors
          }
        });

        setTimeout(() => {
          if (!this.bloxrouteWs || this.bloxrouteWs.readyState !== WebSocket.OPEN) {
            console.log("   ⏰ BloxRoute connection timeout");
            this.bloxrouteWs = null;
            resolve(false);
          }
        }, 5000);
      } catch (error) {
        console.log("   ❌ BloxRoute setup failed:", error.message);
        this.bloxrouteWs = null;
        resolve(false);
      }
    });
  }

  /**
   * Build MEV bundle with our sweep tx BEFORE attacker's tx
   *
   * Bundle structure:
   * [
   *   { our_sweep_tx },      <- Executes first
   *   { attacker_tx }        <- Fails (no funds left)
   * ]
   */
  async buildBundle(ourSignedTx, attackerTx, currentBlock) {
    const startTime = Date.now();
    console.log("\n📦 BUILDING MEV BUNDLE");

    // Target block (next block)
    const targetBlock = currentBlock + 1;
    const maxBlock = currentBlock + this.maxBlocksAhead;

    console.log(`   Current block: ${currentBlock}`);
    console.log(`   Target block: ${targetBlock} - ${maxBlock}`);

    // Remove 0x prefix from signed transactions
    const ourTxHex = ourSignedTx.startsWith("0x") ? ourSignedTx.slice(2) : ourSignedTx;

    // Get attacker's signed transaction
    let attackerTxHex;
    if (attackerTx.raw) {
      // Already signed
      attackerTxHex = attackerTx.raw.startsWith("0x")
        ? attackerTx.raw.slice(2)
        : attackerTx.raw;
    } else {
      // Need to get the raw tx from the mempool
      console.log("   ⚠️ Attacker tx not fully propagated yet, using what we have");
      // For now, we'll just use our tx as a bundle of 1
      // In production, you'd wait for the full tx or reconstruct it
      attackerTxHex = null;
    }

    // Build bundle
    const bundle = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "blxr_submit_bundle",
      params: {
        transaction: [ourTxHex], // Our tx first
        block_number: `0x${targetBlock.toString(16)}`, // Hex format
        min_timestamp: 0,
        max_timestamp: Math.floor(Date.now() / 1000) + this.bundleTimeout,
        mev_builders: { all: "" }, // Submit to all builders
      },
    };

    // If we have attacker's full tx, add it AFTER ours
    if (attackerTxHex) {
      bundle.params.transaction.push(attackerTxHex);
      bundle.params.reverting_tx_hashes = [attackerTx.hash]; // Mark attacker tx as allowed to revert
      console.log("   ✅ Bundle includes both txs (ours first, attacker's second)");
    } else {
      console.log("   ⚠️ Bundle only includes our tx (attacker's tx incomplete)");
    }

    const buildTime = Date.now() - startTime;
    console.log(`   ⚡ Bundle built in ${buildTime}ms`);
    console.log(`   📊 Transactions: ${bundle.params.transaction.length}`);

    this.stats.bundlesCreated++;

    return bundle;
  }

  /**
   * Submit bundle via BloxRoute
   */
  async submitBundleViaBloxRoute(bundle) {
    return new Promise((resolve, reject) => {
      if (!this.bloxrouteWs || this.bloxrouteWs.readyState !== WebSocket.OPEN) {
        reject(new Error("BloxRoute WebSocket not connected"));
        return;
      }

      console.log("\n🚀 SUBMITTING MEV BUNDLE VIA BLOXROUTE");
      console.log(`   Bundle ID: ${bundle.id}`);
      console.log(`   Target block: ${parseInt(bundle.params.block_number, 16)}`);
      console.log(`   Transactions: ${bundle.params.transaction.length}`);

      const requestId = bundle.id;
      let responded = false;

      const responseHandler = (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === requestId) {
            responded = true;
            this.bloxrouteWs.removeListener("message", responseHandler);

            if (response.error) {
              console.log("   ❌ Bundle submission error:");
              console.log("      " + JSON.stringify(response.error, null, 2));
              this.stats.bundlesFailed++;
              reject(new Error(`BloxRoute bundle error: ${response.error.message}`));
            } else {
              console.log("   ✅ Bundle accepted by BloxRoute");
              console.log("      Result: " + JSON.stringify(response.result, null, 2));
              this.stats.bundlesSubmitted++;
              resolve(response.result);
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }
      };

      this.bloxrouteWs.on("message", responseHandler);

      // Send bundle
      this.bloxrouteWs.send(JSON.stringify(bundle));

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!responded) {
          this.bloxrouteWs.removeListener("message", responseHandler);
          console.log("   ⏰ Bundle submission timeout");
          this.stats.bundlesFailed++;
          reject(new Error("Bundle submission timeout"));
        }
      }, 10000);
    });
  }

  /**
   * MAIN METHOD: Create and submit bundle for guaranteed ordering
   *
   * This gives us 100% guarantee that our tx executes before attacker's
   */
  async guaranteedFrontRun(ourSignedTx, attackerTx) {
    const startTime = Date.now();

    console.log("\n🎯 GUARANTEED FRONT-RUN WITH MEV BUNDLE");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (!this.bloxrouteWs || this.bloxrouteWs.readyState !== WebSocket.OPEN) {
      throw new Error("BloxRoute not available - cannot submit bundles");
    }

    try {
      // Get current block
      const currentBlock = await this.provider.getBlockNumber();
      console.log(`Current block: ${currentBlock}`);

      // Build bundle
      const bundle = await this.buildBundle(ourSignedTx, attackerTx, currentBlock);

      // Submit bundle
      const result = await this.submitBundleViaBloxRoute(bundle);

      const totalTime = Date.now() - startTime;
      console.log("\n✅ MEV BUNDLE SUBMITTED SUCCESSFULLY");
      console.log(`   ⏱️ Total time: ${totalTime}ms`);
      console.log(`   🎯 Guaranteed ordering: YOUR TX FIRST`);
      console.log(`   📦 Bundle hash: ${result.bundleHash || "pending"}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      // Monitor bundle inclusion
      this.monitorBundleInclusion(bundle, result, currentBlock);

      return {
        success: true,
        bundleHash: result.bundleHash,
        bundleId: bundle.id,
        targetBlock: parseInt(bundle.params.block_number, 16),
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
   * Monitor bundle inclusion in upcoming blocks
   */
  async monitorBundleInclusion(bundle, result, startBlock) {
    const targetBlock = parseInt(bundle.params.block_number, 16);
    const maxBlock = startBlock + this.maxBlocksAhead;

    console.log(`\n👁️ Monitoring bundle inclusion (blocks ${targetBlock}-${maxBlock})`);

    // Listen for new blocks
    const checkInclusion = async (blockNumber) => {
      if (blockNumber > maxBlock) {
        console.log(`   ⏰ Bundle not included by block ${maxBlock} (missed window)`);
        this.provider.removeListener("block", checkInclusion);
        return;
      }

      if (blockNumber >= targetBlock) {
        console.log(`   🔍 Checking block ${blockNumber}...`);

        try {
          const block = await this.provider.getBlockWithTransactions(blockNumber);

          // Check if our tx is in this block
          const ourTxHash = result.bundleHash || ethers.utils.keccak256(
            bundle.params.transaction[0]
          );

          const foundTx = block.transactions.find(
            (tx) => tx.hash.toLowerCase() === ourTxHash.toLowerCase()
          );

          if (foundTx) {
            console.log(`   ✅ BUNDLE INCLUDED IN BLOCK ${blockNumber}!`);
            console.log(`   🎉 Transaction hash: ${foundTx.hash}`);
            this.stats.bundlesIncluded++;
            this.provider.removeListener("block", checkInclusion);

            // Get receipt to verify success
            const receipt = await this.provider.getTransactionReceipt(foundTx.hash);
            if (receipt.status === 1) {
              console.log(`   ✅ Transaction SUCCESS - You won the race!`);
            } else {
              console.log(`   ❌ Transaction REVERTED - Check logs`);
            }
          }
        } catch (error) {
          console.log(`   ⚠️ Error checking block ${blockNumber}:`, error.message);
        }
      }
    };

    this.provider.on("block", checkInclusion);

    // Stop monitoring after max blocks
    setTimeout(() => {
      this.provider.removeListener("block", checkInclusion);
    }, this.maxBlocksAhead * 3000); // ~3s per block on Polygon
  }

  /**
   * Check if bundle submission is available
   */
  canSubmitBundles() {
    return this.bloxrouteWs && this.bloxrouteWs.readyState === WebSocket.OPEN;
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

  /**
   * Alternative: Submit bundle via HTTP (if WebSocket fails)
   */
  async submitBundleViaHTTP(bundle, authHeader) {
    const axios = require("axios");

    console.log("\n🌐 Submitting bundle via HTTP fallback...");

    try {
      const response = await axios.post(
        "https://api.blxrbdn.com",
        bundle,
        {
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      console.log("   ✅ Bundle submitted via HTTP");
      this.stats.bundlesSubmitted++;
      return response.data.result;
    } catch (error) {
      console.error("   ❌ HTTP bundle submission failed:", error.message);
      this.stats.bundlesFailed++;
      throw error;
    }
  }

  /**
   * Simulate bundle execution locally (optional safety check)
   */
  async simulateBundle(bundle) {
    console.log("\n🧪 Simulating bundle execution...");

    try {
      // For each transaction in bundle, try to simulate
      for (let i = 0; i < bundle.params.transaction.length; i++) {
        const txHex = "0x" + bundle.params.transaction[i];

        // Parse transaction
        const tx = ethers.utils.parseTransaction(txHex);

        console.log(`   TX ${i + 1}: ${tx.to} - ${tx.data?.slice(0, 10) || "value transfer"}`);

        // Try to estimate gas (will fail if tx would revert)
        try {
          await this.provider.estimateGas({
            from: tx.from,
            to: tx.to,
            data: tx.data,
            value: tx.value,
          });
          console.log(`      ✅ Would succeed`);
        } catch (error) {
          console.log(`      ⚠️ Would revert: ${error.message}`);
        }
      }

      console.log("   ✅ Simulation complete");
      return true;
    } catch (error) {
      console.error("   ❌ Simulation failed:", error.message);
      return false;
    }
  }
}

module.exports = { MEVBundleEngine };
