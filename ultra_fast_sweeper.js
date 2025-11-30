const { ethers } = require("ethers");
const WebSocket = require("ws");
const { PreSignedTxPool } = require("./presigned_pool");
const { PreFlightValidator } = require("./preflight_validator");
require("dotenv").config();

/**
 * Ultra-Fast Sweeper Bot
 *
 * Combines:
 * 1. Pre-signed transaction pool (instant broadcast)
 * 2. Multi-path shotgun submission (BloxRoute + multiple RPCs)
 * 3. Dynamic gas bidding (outbid attackers)
 *
 * Target: Sub-100ms reaction time
 */
class UltraFastSweeper {
  constructor(config) {
    this.config = config;
    console.log("⚡ Initializing Ultra-Fast Sweeper...");

    this.provider = null;
    this.backupProviders = [];
    this.signer = null;
    this.preSignedPool = null;

    // Performance tracking
    this.stats = {
      detectionToSend: [],
      successfulSweeps: 0,
      failedSweeps: 0,
    };
  }

  async initialize() {
    console.log("🔧 Configuration:");
    console.log(`  - Safe: ${this.config.safeAddress}`);
    console.log(`  - Vault: ${this.config.vaultAddress}`);
    console.log(`  - Sweeper: ${this.config.sweeperAddress}`);
    console.log(`  - USDT: ${this.config.usdtContract}`);
    console.log(`  - Emergency Gas Multiplier: ${this.config.emergencyGasMult}x`);

    if (!this.config.rpcUrl) throw new Error("RPC_URL missing");
    if (!this.config.privateKey) throw new Error("PRIVATE_KEY missing");

    // Primary provider
    console.log("\n📡 Setting up primary RPC...");
    this.provider = new ethers.providers.JsonRpcProvider(this.config.rpcUrl);
    const network = await this.provider.getNetwork();
    console.log(`✅ Primary RPC connected - Chain ID: ${network.chainId}`);

    // Setup backup providers for shotgun submission
    await this.setupBackupProviders();

    // Wallet setup
    console.log("🔑 Setting up wallet...");
    this.signer = new ethers.Wallet(this.config.privateKey, this.provider);
    console.log(`✅ Wallet: ${this.signer.address}`);

    // Initialize pre-signed transaction pool
    console.log("\n🎯 Initializing pre-signed transaction pool...");
    this.preSignedPool = new PreSignedTxPool({
      ...this.config,
      poolSize: this.config.poolSize || 5,
      gasRefreshInterval: this.config.gasRefreshInterval || 12000,
    });

    await this.preSignedPool.initialize(
      this.provider,
      this.config.privateKey,
      this.config.sweeperAddress
    );

    // Initialize pre-flight validator (premium tier)
    this.preFlightValidator = new PreFlightValidator(this.config);
    await this.preFlightValidator.initialize();

    console.log("\n✅ Ultra-Fast Sweeper initialized and ready!");
    this.printCapabilities();

    return true;
  }

  /**
   * Setup multiple backup RPC providers for shotgun submission
   */
  async setupBackupProviders() {
    console.log("\n🔫 Setting up shotgun submission providers...");

    const backupRpcs = [
      this.config.infuraHttp,
      this.config.drpcHttp,      // dRPC with MEV protection
      this.config.quicknodeHttp,
      this.config.ankrHttp,
      this.config.nodiesHttp,
    ].filter(Boolean); // Remove undefined/null

    console.log(`   Found ${backupRpcs.length} backup RPC endpoints`);

    for (const rpcUrl of backupRpcs) {
      try {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        await provider.getNetwork(); // Test connection
        this.backupProviders.push(provider);

        // Identify dRPC for logging
        const isDrpc = rpcUrl.includes('drpc');
        const label = isDrpc ? '(MEV Protected)' : '';
        console.log(`   ✅ Added backup ${label}: ${rpcUrl.substring(0, 50)}...`);
      } catch (error) {
        console.log(`   ⚠️ Skipped failed RPC: ${rpcUrl.substring(0, 50)}...`);
      }
    }

    console.log(`✅ Shotgun configured with ${this.backupProviders.length + 1} providers`);
  }

  /**
   * Wait for transaction confirmation with timeout
   */
  async waitForConfirmation(txHash, maxWaitTime = 60000) {
    console.log(`\n⏳ Waiting for transaction confirmation...`);
    console.log(`   TX Hash: ${txHash}`);

    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const receipt = await this.provider.getTransactionReceipt(txHash);

        if (receipt) {
          const waitTime = Date.now() - startTime;
          if (receipt.status === 1) {
            console.log(`✅ Transaction CONFIRMED in block ${receipt.blockNumber} (${waitTime}ms)`);
            console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
            return { success: true, receipt, waitTime };
          } else {
            console.log(`❌ Transaction REVERTED in block ${receipt.blockNumber} (${waitTime}ms)`);
            return { success: false, receipt, waitTime, reason: "Transaction reverted" };
          }
        }

        // Not mined yet, wait and check again
        await new Promise(resolve => setTimeout(resolve, checkInterval));

      } catch (error) {
        // Error checking receipt, retry
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
    }

    console.log(`⏰ Transaction confirmation timeout after ${maxWaitTime}ms`);
    return { success: false, reason: "Confirmation timeout" };
  }

  /**
   * SHOTGUN SUBMISSION: Send same transaction through ALL paths simultaneously
   * Returns as soon as first path succeeds and confirms transaction
   */
  async shotgunBroadcast(signedTx, txType = "sweep", maxRetries = 2, preSignedTxHash = null) {
    let lastError = null;

    // PRE-FLIGHT VALIDATION (Premium Tier)
    if (this.preFlightValidator && this.preFlightValidator.enabled) {
      const validation = await this.preFlightValidator.validateTransaction(signedTx);
      if (!validation.valid) {
        console.log(`\n❌ PRE-FLIGHT VALIDATION FAILED!`);
        console.log(`   Reason: ${validation.reason}`);
        console.log(`   ⚠️  Skipping broadcast to avoid wasted gas`);
        throw new Error(`Pre-flight validation failed: ${validation.reason}`);
      }
    }

    for (let retry = 0; retry <= maxRetries; retry++) {
      if (retry > 0) {
        console.log(`\n🔄 Retry ${retry}/${maxRetries} for ${txType} sweep...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between retries
      }

      try {
        const startTime = Date.now();
        console.log(`\n🔫 SHOTGUN BROADCAST: ${txType}${retry > 0 ? ` (Retry ${retry})` : ""}`);
        console.log(`   Targeting ${this.backupProviders.length + 1} RPC providers`);

        const broadcastPromises = [];

        // Path 1: Primary RPC
        const primaryPromise = this.provider
          .sendTransaction(signedTx)
          .then((result) => {
            console.log(`   ✅ Primary RPC SUCCESS (${Date.now() - startTime}ms)`);
            return { source: "Primary RPC", result, time: Date.now() - startTime };
          })
          .catch((err) => {
            console.log(`   ❌ Primary RPC failed: ${err.message}`);
            if (err.error && err.error.message) {
              console.log(`      Error details: ${err.error.message}`);
            }
            return null;
          });
        broadcastPromises.push(primaryPromise);

        // Path 2+: All backup RPCs
        for (let i = 0; i < this.backupProviders.length; i++) {
          const provider = this.backupProviders[i];
          const backupPromise = provider
            .sendTransaction(signedTx)
            .then((result) => {
              console.log(`   ✅ Backup RPC ${i + 1} SUCCESS (${Date.now() - startTime}ms)`);
              return { source: `Backup RPC ${i + 1}`, result, time: Date.now() - startTime };
            })
            .catch((err) => {
              console.log(`   ❌ Backup RPC ${i + 1} failed: ${err.message}`);
              if (err.error && err.error.message) {
                console.log(`      Error details: ${err.error.message}`);
              }
              return null;
            });
          broadcastPromises.push(backupPromise);
        }

        // Wait for all to complete, return first success
        const results = await Promise.all(broadcastPromises);
        const successResults = results.filter((r) => r !== null);

        if (successResults.length === 0) {
          throw new Error("All shotgun paths failed!");
        }

        // Return the fastest successful submission
        const fastest = successResults.sort((a, b) => a.time - b.time)[0];

        console.log(`\n🎯 SHOTGUN RESULT:`);
        console.log(`   ✅ ${successResults.length}/${broadcastPromises.length} paths succeeded`);
        console.log(`   ⚡ Fastest: ${fastest.source} in ${fastest.time}ms`);

        // Extract transaction hash
        const txHash = fastest.result.hash || fastest.result.txHash || fastest.result;

        // Wait for confirmation (with timeout)
        const confirmation = await this.waitForConfirmation(txHash, 30000);

        if (confirmation.success) {
          return fastest.result;
        } else {
          throw new Error(`Transaction broadcast but failed: ${confirmation.reason}`);
        }

      } catch (error) {
        lastError = error;
        console.error(`❌ Shotgun attempt ${retry + 1} failed: ${error.message}`);

        // Get full error message (check nested error structures)
        const fullErrorMsg = error.message +
                            (error.error?.message || '') +
                            (error.body || '');

        // Check if error is due to gas price being too low
        const isGasTooLow = fullErrorMsg.includes("gas price below minimum") ||
                            fullErrorMsg.includes("gas tip cap") ||
                            fullErrorMsg.includes("insufficient");

        if (isGasTooLow) {
          console.log("⚠️ Gas price too low! Network gas prices have increased.");

          // Parse required gas from error message (check all error locations)
          // Error format: "gas tip cap 5250000000, minimum needed 25000000000"
          const minNeededMatch = fullErrorMsg.match(/minimum needed (\d+)/);
          let requiredTip = null;

          if (minNeededMatch) {
            requiredTip = minNeededMatch[1]; // In wei as string
            const requiredGwei = (parseInt(requiredTip) / 1e9).toFixed(2);
            console.log(`   📊 Network requires: ${requiredGwei} gwei minimum`);
            console.log(`   🎯 Regenerating with 2x safety margin: ${(requiredGwei * 2).toFixed(2)} gwei`);
          } else {
            console.log(`   ⚠️  Could not parse required gas from error, using current network prices`);
          }

          // Release the current transaction back to pool
          if (preSignedTxHash) {
            this.preSignedPool.releaseTransaction(preSignedTxHash);
          }

          // Force immediate pool regeneration with required gas
          try {
            console.log("🔄 Forcing pool regeneration with network gas prices...");
            await this.preSignedPool.forceRegenerateWithGas(requiredTip);
            console.log("✅ Pool regenerated with fresh gas prices");
          } catch (regenError) {
            console.error("❌ Pool regeneration failed:", regenError.message);
          }
        }

        // If this was the last retry, throw the error
        if (retry === maxRetries) {
          // Release the pre-signed transaction back to pool on final failure
          if (preSignedTxHash && !isGasTooLow) { // Don't release if already released above
            console.log("⚠️ All broadcast attempts failed, releasing transaction back to pool");
            this.preSignedPool.releaseTransaction(preSignedTxHash);
          }
          throw error;
        }

        // Otherwise, continue to next retry
      }
    }

    // Should never reach here, but just in case
    throw lastError || new Error("Shotgun broadcast failed after all retries");
  }

  /**
   * EMERGENCY SWEEP USDT - Uses pre-signed tx + shotgun
   * Target: <100ms from call to broadcast
   */
  async emergencySweepUSDT() {
    const startTime = Date.now();
    console.log("\n🚨 EMERGENCY USDT SWEEP INITIATED");

    // Step 1: Grab pre-signed tx (instant)
    const preSigned = this.preSignedPool.getNextUSDTTx();

    if (!preSigned) {
      console.error("❌ No pre-signed USDT transaction available!");
      console.log("⚠️ Falling back to on-demand signing...");
      return await this.fallbackSweepUSDT();
    }

    const grabTime = Date.now() - startTime;
    console.log(`⚡ Pre-signed tx retrieved in ${grabTime}ms`);
    console.log(`   - Nonce: ${preSigned.nonce}`);
    console.log(`   - Hash: ${preSigned.txHash}`);

    if (this.config.dryRun) {
      console.log("🔍 DRY RUN - would broadcast pre-signed USDT sweep");
      console.log(`   Total time: ${Date.now() - startTime}ms`);
      return { isDryRun: true };
    }

    // Step 2: Shotgun broadcast (multi-path)
    // Pass pre-signed txHash so it can be released back to pool if broadcast fails
    const txResponse = await this.shotgunBroadcast(preSigned.signedTx, "USDT", 2, preSigned.txHash);

    const totalTime = Date.now() - startTime;
    console.log(`\n✅ USDT SWEEP BROADCAST COMPLETE`);
    console.log(`   ⚡ Total reaction time: ${totalTime}ms`);
    console.log(`   📊 Hash: ${txResponse.hash || preSigned.txHash}`);

    this.stats.detectionToSend.push(totalTime);
    this.stats.successfulSweeps++;

    // Trigger immediate pool regeneration (don't wait)
    this.preSignedPool.checkAndRegeneratePools().catch(err => {
      console.error("⚠️ Pool regeneration error:", err.message);
    });

    return txResponse;
  }

  /**
   * EMERGENCY SWEEP MATIC - Uses pre-signed tx + shotgun
   */
  async emergencySweepMATIC() {
    const startTime = Date.now();
    console.log("\n🚨 EMERGENCY MATIC SWEEP INITIATED");

    const preSigned = this.preSignedPool.getNextMATICTx();

    if (!preSigned) {
      console.error("❌ No pre-signed MATIC transaction available!");
      return await this.fallbackSweepMATIC();
    }

    const grabTime = Date.now() - startTime;
    console.log(`⚡ Pre-signed tx retrieved in ${grabTime}ms`);

    if (this.config.dryRun) {
      console.log("🔍 DRY RUN - would broadcast pre-signed MATIC sweep");
      return { isDryRun: true };
    }

    // Pass pre-signed txHash so it can be released back to pool if broadcast fails
    const txResponse = await this.shotgunBroadcast(preSigned.signedTx, "MATIC", 2, preSigned.txHash);

    const totalTime = Date.now() - startTime;
    console.log(`\n✅ MATIC SWEEP BROADCAST COMPLETE`);
    console.log(`   ⚡ Total reaction time: ${totalTime}ms`);

    this.stats.detectionToSend.push(totalTime);
    this.stats.successfulSweeps++;

    // Trigger immediate pool regeneration (don't wait)
    this.preSignedPool.checkAndRegeneratePools().catch(err => {
      console.error("⚠️ Pool regeneration error:", err.message);
    });

    return txResponse;
  }

  /**
   * EMERGENCY SWEEP TOKEN - Uses pre-signed tx + shotgun
   */
  async emergencySweepToken(tokenAddress) {
    const startTime = Date.now();
    console.log(`\n🚨 EMERGENCY TOKEN SWEEP: ${tokenAddress}`);

    const preSigned = await this.preSignedPool.getNextTokenTx(tokenAddress);

    if (!preSigned) {
      console.error(`❌ No pre-signed transaction for ${tokenAddress}!`);
      return await this.fallbackSweepToken(tokenAddress);
    }

    const grabTime = Date.now() - startTime;
    console.log(`⚡ Pre-signed tx retrieved in ${grabTime}ms`);

    if (this.config.dryRun) {
      console.log("🔍 DRY RUN - would broadcast pre-signed token sweep");
      return { isDryRun: true };
    }

    // Pass pre-signed txHash so it can be released back to pool if broadcast fails
    const txResponse = await this.shotgunBroadcast(preSigned.signedTx, "TOKEN", 2, preSigned.txHash);

    const totalTime = Date.now() - startTime;
    console.log(`\n✅ TOKEN SWEEP BROADCAST COMPLETE`);
    console.log(`   ⚡ Total reaction time: ${totalTime}ms`);

    this.stats.detectionToSend.push(totalTime);
    this.stats.successfulSweeps++;

    // Trigger immediate pool regeneration (don't wait)
    this.preSignedPool.checkAndRegeneratePools().catch(err => {
      console.error("⚠️ Pool regeneration error:", err.message);
    });

    return txResponse;
  }

  /**
   * Fallback methods when pool is exhausted
   */
  async fallbackSweepUSDT() {
    console.log("🔄 FALLBACK: Building USDT sweep on-demand...");
    // Import the CleanSweeperBot for fallback
    const { CleanSweeperBot } = require("./sweeper_bot");
    const fallbackBot = new CleanSweeperBot(this.config);
    await fallbackBot.initialize();
    return await fallbackBot.sweepToken(this.config.usdtContract);
  }

  async fallbackSweepMATIC() {
    console.log("🔄 FALLBACK: Building MATIC sweep on-demand...");
    const { CleanSweeperBot } = require("./sweeper_bot");
    const fallbackBot = new CleanSweeperBot(this.config);
    await fallbackBot.initialize();
    return await fallbackBot.sweepMatic();
  }

  async fallbackSweepToken(tokenAddress) {
    console.log(`🔄 FALLBACK: Building token sweep on-demand for ${tokenAddress}...`);
    const { CleanSweeperBot } = require("./sweeper_bot");
    const fallbackBot = new CleanSweeperBot(this.config);
    await fallbackBot.initialize();
    return await fallbackBot.sweepToken(tokenAddress);
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    const times = this.stats.detectionToSend;

    if (times.length === 0) {
      return {
        avgReactionTime: 0,
        minReactionTime: 0,
        maxReactionTime: 0,
        successRate: 0,
        totalSweeps: 0,
      };
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    return {
      avgReactionTime: Math.round(avg),
      minReactionTime: min,
      maxReactionTime: max,
      successRate:
        this.stats.successfulSweeps /
        (this.stats.successfulSweeps + this.stats.failedSweeps),
      totalSweeps: this.stats.successfulSweeps + this.stats.failedSweeps,
    };
  }

  /**
   * Print system capabilities
   */
  printCapabilities() {
    console.log("\n⚡ ULTRA-FAST SWEEPER CAPABILITIES:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `   🎯 Pre-signed pool: ${this.preSignedPool.poolSize} txs per asset`
    );
    console.log(
      `   🔫 Shotgun paths: ${this.backupProviders.length + 1} RPC providers`
    );
    console.log(`   ⚡ Target reaction: <100ms detection → broadcast`);
    console.log(`   💎 Gas strategy: ${this.config.emergencyGasMult}x emergency`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const poolStats = this.preSignedPool.getPoolStats();
    console.log("\n📊 Pre-Signed Pool Status:");
    console.log(`   USDT: ${poolStats.usdt.available}/${poolStats.usdt.total} ready`);
    console.log(`   MATIC: ${poolStats.matic.available}/${poolStats.matic.total} ready`);
    console.log(`   Base Nonce: ${poolStats.baseNonce}`);
  }

  /**
   * Health check
   */
  async healthCheck() {
    console.log("\n🏥 HEALTH CHECK:");

    const poolStats = this.preSignedPool.getPoolStats();
    console.log(`   Pre-signed pool: ${poolStats.usdt.available > 0 ? "✅" : "⚠️"} Ready`);
    console.log(`   RPC providers: ✅ ${this.backupProviders.length + 1} available`);

    const perfStats = this.getPerformanceStats();
    if (perfStats.totalSweeps > 0) {
      console.log(`\n📈 PERFORMANCE:`);
      console.log(`   Avg reaction: ${perfStats.avgReactionTime}ms`);
      console.log(`   Best time: ${perfStats.minReactionTime}ms`);
      console.log(`   Success rate: ${(perfStats.successRate * 100).toFixed(1)}%`);
    }
  }
}

module.exports = { UltraFastSweeper };
