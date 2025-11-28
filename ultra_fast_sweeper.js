const { ethers } = require("ethers");
const WebSocket = require("ws");
const { PreSignedTxPool } = require("./presigned_pool");
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
    this.bloxrouteWs = null;
    this.signer = null;
    this.preSignedPool = null;

    // BloxRoute reconnection management
    this.bloxrouteReconnectAttempts = 0;
    this.maxBloxrouteReconnectAttempts = 5;
    this.bloxrouteReconnectDelay = 2000;
    this.bloxrouteReconnecting = false;

    // Performance tracking
    this.stats = {
      detectionToSend: [],
      successfulSweeps: 0,
      failedSweeps: 0,
      bloxrouteReconnections: 0,
    };
  }

  async initialize() {
    console.log("🔧 Configuration:");
    console.log(`  - Safe: ${this.config.safeAddress}`);
    console.log(`  - Vault: ${this.config.vaultAddress}`);
    console.log(`  - Sweeper: ${this.config.sweeperAddress}`);
    console.log(`  - USDT: ${this.config.usdtContract}`);
    console.log(`  - Emergency Gas Multiplier: ${this.config.emergencyGasMult}x`);
    console.log(
      `  - BloxRoute: ${this.config.bloxrouteHeader ? "✅ Enabled" : "❌ Disabled"}`
    );

    if (!this.config.rpcUrl) throw new Error("RPC_URL missing");
    if (!this.config.privateKey) throw new Error("PRIVATE_KEY missing");

    // Primary provider
    console.log("\n📡 Setting up primary RPC...");
    this.provider = new ethers.providers.JsonRpcProvider(this.config.rpcUrl);
    const network = await this.provider.getNetwork();
    console.log(`✅ Primary RPC connected - Chain ID: ${network.chainId}`);

    // Setup backup providers for shotgun submission
    await this.setupBackupProviders();

    // Setup BloxRoute WebSocket
    if (this.config.bloxrouteHeader) {
      console.log("🔗 Setting up BloxRoute...");
      await this.setupBloxRoute();
    }

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
      this.config.quicknodeHttp,
      this.config.alchemyHttp,
      this.config.infuraHttp,
      this.config.ankrHttp,
      this.config.nodiesHttp,
    ].filter(Boolean); // Remove undefined/null

    console.log(`   Found ${backupRpcs.length} backup RPC endpoints`);

    for (const rpcUrl of backupRpcs) {
      try {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        await provider.getNetwork(); // Test connection
        this.backupProviders.push(provider);
        console.log(`   ✅ Added backup: ${rpcUrl.substring(0, 50)}...`);
      } catch (error) {
        console.log(`   ⚠️ Skipped failed RPC: ${rpcUrl.substring(0, 50)}...`);
      }
    }

    console.log(`✅ Shotgun configured with ${this.backupProviders.length + 1} providers`);
  }

  /**
   * Setup BloxRoute WebSocket connection with auto-reconnect
   */
  async setupBloxRoute(isReconnect = false) {
    return new Promise((resolve) => {
      try {
        const attemptText = isReconnect ? `(attempt ${this.bloxrouteReconnectAttempts + 1}/${this.maxBloxrouteReconnectAttempts})` : "";
        console.log(`${isReconnect ? "🔄 Reconnecting" : "🔗 Connecting"} to BloxRoute ${attemptText}...`);

        const ws = new WebSocket("wss://api.blxrbdn.com/ws", {
          headers: {
            Authorization: this.config.bloxrouteHeader,
          },
          rejectUnauthorized: false,
        });

        const connectionTimeout = setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            console.log("⏰ BloxRoute connection timeout");
            ws.terminate();
            this.scheduleBloxrouteReconnect();
            resolve();
          }
        }, 10000);

        ws.on("open", () => {
          clearTimeout(connectionTimeout);
          console.log("✅ BloxRoute WebSocket connected");

          // Clean up old connection if reconnecting
          if (this.bloxrouteWs && this.bloxrouteWs !== ws) {
            try {
              this.bloxrouteWs.removeAllListeners();
              this.bloxrouteWs.terminate();
            } catch (e) {
              // Ignore
            }
          }

          this.bloxrouteWs = ws;
          this.bloxrouteReconnectAttempts = 0;
          this.bloxrouteReconnectDelay = 2000;

          if (isReconnect) {
            this.stats.bloxrouteReconnections++;
            console.log(`   Total BloxRoute reconnections: ${this.stats.bloxrouteReconnections}`);
          }

          resolve();
        });

        ws.on("error", (error) => {
          clearTimeout(connectionTimeout);
          console.log("⚠️ BloxRoute error:", error.message);
          this.scheduleBloxrouteReconnect();
          resolve();
        });

        ws.on("close", (code, reason) => {
          console.log(`⚠️ BloxRoute disconnected (code: ${code}, reason: ${reason || "unknown"})`);
          if (this.bloxrouteWs === ws) {
            this.bloxrouteWs = null;
          }
          this.scheduleBloxrouteReconnect();
        });

      } catch (error) {
        console.log("⚠️ BloxRoute setup failed:", error.message);
        this.scheduleBloxrouteReconnect();
        resolve();
      }
    });
  }

  /**
   * Schedule BloxRoute reconnection with exponential backoff
   */
  scheduleBloxrouteReconnect() {
    if (this.bloxrouteReconnecting) {
      return; // Already scheduled
    }

    if (this.bloxrouteReconnectAttempts >= this.maxBloxrouteReconnectAttempts) {
      console.log(`⚠️ Max BloxRoute reconnection attempts (${this.maxBloxrouteReconnectAttempts}) reached`);
      console.log("   BloxRoute will stay offline. Shotgun will use RPC providers only.");
      return;
    }

    this.bloxrouteReconnecting = true;

    // Exponential backoff: 2s, 4s, 8s, 16s, 32s, max 60s
    const delay = Math.min(this.bloxrouteReconnectDelay * Math.pow(2, this.bloxrouteReconnectAttempts), 60000);

    console.log(`🔄 Scheduling BloxRoute reconnection in ${delay / 1000}s...`);

    setTimeout(async () => {
      this.bloxrouteReconnectAttempts++;
      this.bloxrouteReconnecting = false;
      await this.setupBloxRoute(true);
    }, delay);
  }

  /**
   * Send via BloxRoute private relay
   */
  async sendViaBloxRoute(signedTx) {
    return new Promise((resolve, reject) => {
      if (!this.bloxrouteWs || this.bloxrouteWs.readyState !== WebSocket.OPEN) {
        reject(new Error("BloxRoute not connected"));
        return;
      }

      const txHex = signedTx.startsWith("0x") ? signedTx.slice(2) : signedTx;

      const request = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "blxr_private_tx",
        params: {
          transaction: txHex,
          timeout: 30,
          mev_builders: { all: "" },
          node_validation: true,
        },
      };

      const responseHandler = (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === request.id) {
            this.bloxrouteWs.removeListener("message", responseHandler);
            if (response.error) {
              reject(new Error(`BloxRoute: ${response.error.message}`));
            } else {
              resolve(response.result);
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }
      };

      this.bloxrouteWs.on("message", responseHandler);
      this.bloxrouteWs.send(JSON.stringify(request));

      setTimeout(() => {
        this.bloxrouteWs.removeListener("message", responseHandler);
        reject(new Error("BloxRoute timeout"));
      }, 10000);
    });
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
  async shotgunBroadcast(signedTx, txType = "sweep", maxRetries = 2) {
    let lastError = null;

    for (let retry = 0; retry <= maxRetries; retry++) {
      if (retry > 0) {
        console.log(`\n🔄 Retry ${retry}/${maxRetries} for ${txType} sweep...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between retries
      }

      try {
        const startTime = Date.now();
        console.log(`\n🔫 SHOTGUN BROADCAST: ${txType}${retry > 0 ? ` (Retry ${retry})` : ""}`);
        console.log(`   Targeting ${this.backupProviders.length + 1} providers${this.bloxrouteWs && this.bloxrouteWs.readyState === WebSocket.OPEN ? " + BloxRoute" : ""}`);

        const broadcastPromises = [];

        // Path 1: BloxRoute (if available)
        if (this.bloxrouteWs && this.bloxrouteWs.readyState === WebSocket.OPEN) {
          const bloxPromise = this.sendViaBloxRoute(signedTx)
            .then((result) => {
              console.log(`   ✅ BloxRoute SUCCESS (${Date.now() - startTime}ms)`);
              return { source: "BloxRoute", result, time: Date.now() - startTime };
            })
            .catch((err) => {
              console.log(`   ❌ BloxRoute failed: ${err.message}`);
              return null;
            });
          broadcastPromises.push(bloxPromise);
        }

        // Path 2: Primary RPC
        const primaryPromise = this.provider
          .sendTransaction(signedTx)
          .then((result) => {
            console.log(`   ✅ Primary RPC SUCCESS (${Date.now() - startTime}ms)`);
            return { source: "Primary RPC", result, time: Date.now() - startTime };
          })
          .catch((err) => {
            console.log(`   ❌ Primary RPC failed: ${err.message.substring(0, 100)}`);
            return null;
          });
        broadcastPromises.push(primaryPromise);

        // Path 3+: All backup RPCs
        for (let i = 0; i < this.backupProviders.length; i++) {
          const provider = this.backupProviders[i];
          const backupPromise = provider
            .sendTransaction(signedTx)
            .then((result) => {
              console.log(`   ✅ Backup RPC ${i + 1} SUCCESS (${Date.now() - startTime}ms)`);
              return { source: `Backup RPC ${i + 1}`, result, time: Date.now() - startTime };
            })
            .catch((err) => {
              console.log(`   ❌ Backup RPC ${i + 1} failed`);
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

        // If this was the last retry, throw the error
        if (retry === maxRetries) {
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
    const txResponse = await this.shotgunBroadcast(preSigned.signedTx, "USDT");

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

    const txResponse = await this.shotgunBroadcast(preSigned.signedTx, "MATIC");

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

    const txResponse = await this.shotgunBroadcast(preSigned.signedTx, "TOKEN");

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
      `   🔫 Shotgun paths: ${this.backupProviders.length + 1} RPCs ${
        this.bloxrouteWs ? "+ BloxRoute" : ""
      }`
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
    console.log(
      `   BloxRoute: ${
        this.bloxrouteWs && this.bloxrouteWs.readyState === WebSocket.OPEN
          ? "✅"
          : "❌"
      } ${this.bloxrouteWs ? "Connected" : "Disconnected"}`
    );
    console.log(`   Backup RPCs: ✅ ${this.backupProviders.length} available`);

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
