const { ethers } = require("ethers");
const { UltraFastSweeper } = require("./ultra_fast_sweeper");
const { DynamicGasBidder } = require("./dynamic_gas_bidder");
require("dotenv").config();

/**
 * Ultimate Defense Monitor
 *
 * Combines ALL optimization strategies:
 * 1. Mempool monitoring for early threat detection
 * 2. Pre-signed transaction pool for instant response
 * 3. Dynamic gas bidding to outbid attackers
 * 4. Shotgun submission through multiple paths
 *
 * Target: WIN THE RACE EVERY TIME
 */
class UltimateDefenseMonitor {
  constructor(config) {
    this.config = config;
    console.log("🛡️ Initializing Ultimate Defense Monitor...");

    this.provider = null;
    this.wsProvider = null;
    this.sweeper = null;
    this.gasBidder = null;

    this.isMonitoring = false;
    this.detectedThreats = new Map(); // Track threats we've responded to

    // Performance tracking
    this.stats = {
      threatsDetected: 0,
      responsesSent: 0,
      usedPreSigned: 0,
      usedDynamicGas: 0,
      avgDetectionTime: [],
    };
  }

  async initialize() {
    console.log("\n🔧 Ultimate Defense Monitor Configuration:");
    console.log(`  - Safe Address: ${this.config.safeAddress}`);
    console.log(`  - Vault Address: ${this.config.vaultAddress}`);
    console.log(`  - USDT Contract: ${this.config.usdtContract}`);
    console.log(`  - Emergency Gas: ${this.config.emergencyGasMult}x`);
    console.log(`  - Gas Premium: +${(this.config.gasPremium || 0.5) * 100}%`);

    // Setup providers
    console.log("\n📡 Connecting to network...");
    this.provider = new ethers.providers.JsonRpcProvider(this.config.rpcUrl);

    // Use WebSocket for mempool monitoring (fastest detection)
    const wsUrl = this.config.quicknodeWss || this.config.alchemyWss;
    if (wsUrl) {
      console.log("🔌 Connecting to WebSocket for mempool monitoring...");
      this.wsProvider = new ethers.providers.WebSocketProvider(wsUrl);
      console.log("✅ WebSocket connected");
    } else {
      console.warn("⚠️ No WebSocket URL, using HTTP for monitoring (slower)");
      this.wsProvider = this.provider;
    }

    // Initialize ultra-fast sweeper (pre-signed pool + shotgun)
    console.log("\n⚡ Initializing Ultra-Fast Sweeper...");
    this.sweeper = new UltraFastSweeper(this.config);
    await this.sweeper.initialize();

    // Initialize dynamic gas bidder
    console.log("\n💰 Initializing Dynamic Gas Bidder...");
    this.gasBidder = new DynamicGasBidder(this.config);
    await this.gasBidder.initialize(this.provider, this.config.privateKey);

    console.log("\n✅ Ultimate Defense Monitor READY");
    return true;
  }

  /**
   * Detect if a transaction is a threat to our Safe
   */
  detectThreat(tx) {
    if (!tx) return null;

    const safeAddr = this.config.safeAddress.toLowerCase();
    const vaultAddr = this.config.vaultAddress.toLowerCase();

    // Threat Type 1: Transaction FROM our Safe (someone trying to steal)
    if (tx.from?.toLowerCase() === safeAddr) {
      // Check if it's going to vault (legitimate sweep)
      if (tx.to?.toLowerCase() === vaultAddr) {
        return null; // Not a threat, it's our own sweep
      }

      return {
        isThreat: true,
        type: "UNAUTHORIZED_OUTGOING",
        severity: "CRITICAL",
        asset: this.detectAssetFromData(tx.data, tx.to),
        attackerTx: tx,
      };
    }

    // Threat Type 2: Contract call TO our Safe (potential exploit)
    if (tx.to?.toLowerCase() === safeAddr && tx.data && tx.data !== "0x") {
      // Parse if it's an ERC20 transfer or other dangerous call
      const functionSig = tx.data.slice(0, 10);

      // Common dangerous function signatures
      const dangerousSigs = [
        "0xa9059cbb", // transfer
        "0x23b872dd", // transferFrom
        "0x095ea7b3", // approve
        "0x42842e0e", // safeTransferFrom (NFT)
      ];

      if (dangerousSigs.includes(functionSig)) {
        return {
          isThreat: true,
          type: "DANGEROUS_CONTRACT_CALL",
          severity: "HIGH",
          asset: "MULTIPLE",
          attackerTx: tx,
        };
      }
    }

    return null;
  }

  /**
   * Try to detect which asset is being targeted
   */
  detectAssetFromData(data, to) {
    if (!data || data === "0x") return "MATIC";

    const usdtAddr = this.config.usdtContract?.toLowerCase();
    if (to?.toLowerCase() === usdtAddr) {
      return "USDT";
    }

    // Check for ERC20 transfer function signature
    if (data.startsWith("0xa9059cbb") || data.startsWith("0x23b872dd")) {
      return to || "UNKNOWN_TOKEN";
    }

    return "UNKNOWN";
  }

  /**
   * CORE THREAT RESPONSE LOGIC
   *
   * When we detect a threat:
   * 1. Check if we've already responded (avoid duplicates)
   * 2. Determine asset type
   * 3. Check if we need to outbid attacker's gas
   * 4. Use pre-signed OR dynamically bid
   * 5. Shotgun broadcast
   */
  async respondToThreat(threat) {
    const startTime = Date.now();
    const txHash = threat.attackerTx.hash;

    // Avoid duplicate responses
    if (this.detectedThreats.has(txHash)) {
      console.log(`⚠️ Already responded to threat ${txHash.slice(0, 10)}...`);
      return;
    }

    this.detectedThreats.set(txHash, { timestamp: Date.now(), threat });
    this.stats.threatsDetected++;

    console.log("\n🚨🚨🚨 THREAT DETECTED 🚨🚨🚨");
    console.log(`Type: ${threat.type}`);
    console.log(`Severity: ${threat.severity}`);
    console.log(`Asset: ${threat.asset}`);
    console.log(`Attacker TX: ${txHash}`);
    console.log(
      `Attacker Gas: ${this.gasBidder.formatGasInfo(
        this.gasBidder.parseGasFromTx(threat.attackerTx)
      )}`
    );

    try {
      let response;

      // Determine sweep type based on asset
      if (threat.asset === "USDT" || threat.asset === this.config.usdtContract) {
        console.log("\n🎯 Initiating USDT defense...");

        // Check if we should use dynamic gas bidding
        const poolStats = this.sweeper.preSignedPool.getPoolStats();
        const nextPreSigned = this.sweeper.preSignedPool.pools.usdt.find(
          (tx) => !tx.used
        );

        if (nextPreSigned) {
          // We have a pre-signed tx, but should we use it?
          // Parse gas from pre-signed tx
          const preSigTx = await this.provider.getTransaction(nextPreSigned.txHash);
          const shouldOutbid = this.gasBidder.shouldOutbid(
            {
              maxFeePerGas: preSigTx?.maxFeePerGas,
              maxPriorityFeePerGas: preSigTx?.maxPriorityFeePerGas,
              gasPrice: preSigTx?.gasPrice,
            },
            threat.attackerTx
          );

          if (shouldOutbid) {
            console.log("💰 Attacker gas is HIGH - using dynamic bidding!");
            response = await this.dynamicBidAndSweepUSDT(threat.attackerTx);
            this.stats.usedDynamicGas++;
          } else {
            console.log("⚡ Using pre-signed tx (our gas already competitive)");
            response = await this.sweeper.emergencySweepUSDT();
            this.stats.usedPreSigned++;
          }
        } else {
          console.log("💰 No pre-signed tx available - using dynamic bidding!");
          response = await this.dynamicBidAndSweepUSDT(threat.attackerTx);
          this.stats.usedDynamicGas++;
        }
      } else if (threat.asset === "MATIC") {
        console.log("\n🎯 Initiating MATIC defense...");
        response = await this.sweeper.emergencySweepMATIC();
        this.stats.usedPreSigned++;
      } else if (threat.asset !== "UNKNOWN") {
        console.log(`\n🎯 Initiating defense for token ${threat.asset}...`);
        response = await this.sweeper.emergencySweepToken(threat.asset);
        this.stats.usedPreSigned++;
      } else {
        console.log("\n🎯 Unknown asset - sweeping ALL (USDT + MATIC)...");
        // Parallel sweep of both
        await Promise.all([
          this.sweeper.emergencySweepUSDT(),
          this.sweeper.emergencySweepMATIC(),
        ]);
      }

      const totalTime = Date.now() - startTime;
      this.stats.avgDetectionTime.push(totalTime);
      this.stats.responsesSent++;

      console.log("\n✅ THREAT RESPONSE COMPLETE");
      console.log(`⏱️ Total response time: ${totalTime}ms`);
      console.log(
        `📊 Response: ${response?.hash || response?.txHash || "Multi-sweep"}`
      );

      // Log race result
      console.log("\n🏁 RACE RESULT:");
      console.log(`   Your TX: ${response?.hash || "Multi"}`);
      console.log(`   Attacker TX: ${txHash}`);
      console.log(`   Response time: ${totalTime}ms`);
      console.log(
        `   Method: ${
          this.stats.usedDynamicGas > 0 ? "Dynamic Gas Bidding" : "Pre-Signed"
        }`
      );
    } catch (error) {
      console.error("\n❌ THREAT RESPONSE FAILED:", error.message);
      console.error(`⏱️ Failed after ${Date.now() - startTime}ms`);

      // Try emergency fallback - sweep everything
      console.log("🚨 EMERGENCY FALLBACK: Sweeping all assets...");
      try {
        await Promise.all([
          this.sweeper.emergencySweepUSDT(),
          this.sweeper.emergencySweepMATIC(),
        ]);
      } catch (fallbackError) {
        console.error("❌ Emergency fallback also failed:", fallbackError.message);
      }
    }
  }

  /**
   * Dynamic bid and sweep USDT
   * Builds a new tx with attacker's gas + premium
   */
  async dynamicBidAndSweepUSDT(attackerTx) {
    const startTime = Date.now();

    // Prepare sweep transaction data
    const sweeperContract = new ethers.Contract(
      this.config.sweeperAddress,
      ["function sweepToken(address tokenAddress) external"],
      this.sweeper.signer
    );

    const txData = await sweeperContract.populateTransaction.sweepToken(
      this.config.usdtContract
    );

    // Build outbid transaction
    const outbidTx = await this.gasBidder.buildOutbidTx(txData, attackerTx);

    console.log(`⚡ Dynamic outbid tx ready in ${Date.now() - startTime}ms`);

    // Shotgun broadcast
    const result = await this.sweeper.shotgunBroadcast(outbidTx.signedTx, "USDT");

    return result;
  }

  /**
   * Start monitoring the mempool for threats
   */
  async startMonitoring() {
    if (this.isMonitoring) {
      console.log("⚠️ Already monitoring");
      return;
    }

    this.isMonitoring = true;
    console.log("\n👁️ MONITORING STARTED - Watching for threats...");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Monitor pending transactions
    this.wsProvider.on("pending", async (txHash) => {
      try {
        // Fetch transaction details
        const tx = await this.provider.getTransaction(txHash);
        if (!tx) return;

        // Detect if it's a threat
        const threat = this.detectThreat(tx);
        if (threat) {
          // IMMEDIATE RESPONSE
          await this.respondToThreat(threat);
        }
      } catch (error) {
        // Expected for many pending txs, ignore
      }
    });

    // Monitor confirmed blocks as backup
    this.provider.on("block", async (blockNumber) => {
      if (this.config.debug) {
        console.log(`📦 Block ${blockNumber} | Threats: ${this.stats.threatsDetected} | Responses: ${this.stats.responsesSent}`);
      }

      // Cleanup old threats (older than 5 minutes)
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      for (const [txHash, data] of this.detectedThreats.entries()) {
        if (data.timestamp < fiveMinutesAgo) {
          this.detectedThreats.delete(txHash);
        }
      }
    });

    console.log("✅ Monitoring active - waiting for threats...");
    console.log("Press Ctrl+C to stop\n");
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    this.isMonitoring = false;

    if (this.provider) this.provider.removeAllListeners();
    if (this.wsProvider) this.wsProvider.removeAllListeners();

    console.log("\n🛑 Monitoring stopped");
  }

  /**
   * Get performance statistics
   */
  getStats() {
    const avgTime =
      this.stats.avgDetectionTime.length > 0
        ? this.stats.avgDetectionTime.reduce((a, b) => a + b, 0) /
          this.stats.avgDetectionTime.length
        : 0;

    return {
      threatsDetected: this.stats.threatsDetected,
      responsesSent: this.stats.responsesSent,
      avgResponseTime: Math.round(avgTime),
      usedPreSigned: this.stats.usedPreSigned,
      usedDynamicGas: this.stats.usedDynamicGas,
      successRate:
        this.stats.threatsDetected > 0
          ? (this.stats.responsesSent / this.stats.threatsDetected) * 100
          : 0,
    };
  }

  /**
   * Print status
   */
  printStatus() {
    console.log("\n📊 ULTIMATE DEFENSE STATUS:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const stats = this.getStats();
    console.log(`   Threats Detected: ${stats.threatsDetected}`);
    console.log(`   Responses Sent: ${stats.responsesSent}`);
    console.log(`   Success Rate: ${stats.successRate.toFixed(1)}%`);
    console.log(`   Avg Response Time: ${stats.avgResponseTime}ms`);
    console.log(`   Pre-Signed Used: ${stats.usedPreSigned}`);
    console.log(`   Dynamic Bidding Used: ${stats.usedDynamicGas}`);

    const poolStats = this.sweeper.preSignedPool.getPoolStats();
    console.log(`\n   Pre-Signed Pool:`);
    console.log(`     USDT: ${poolStats.usdt.available}/${poolStats.usdt.total} ready`);
    console.log(`     MATIC: ${poolStats.matic.available}/${poolStats.matic.total} ready`);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }

  /**
   * Run the monitor
   */
  async run() {
    try {
      console.log("🛡️ Ultimate Defense Monitor Starting...\n");

      await this.initialize();
      await this.startMonitoring();

      // Health check every 60 seconds
      setInterval(() => {
        this.printStatus();
        this.sweeper.healthCheck();
      }, 60000);

      // Keep process running
      process.on("SIGINT", async () => {
        console.log("\n🛑 Shutting down...");
        this.stopMonitoring();
        this.printStatus();
        process.exit(0);
      });
    } catch (error) {
      console.error("\n💥 Monitor failed:", error.message);
      process.exit(1);
    }
  }
}

module.exports = { UltimateDefenseMonitor };

// Run if executed directly
if (require.main === module) {
  const CONFIG = {
    sweeperAddress: process.env.SWEEPER_MODULE,
    rpcUrl: process.env.ALCHEMY_HTTP || process.env.RPC_URL,
    quicknodeHttp: process.env.QUICKNODE_HTTP,
    quicknodeWss: process.env.QUICKNODE_WSS,
    alchemyHttp: process.env.ALCHEMY_HTTP,
    alchemyWss: process.env.ALCHEMY_WSS,
    infuraHttp: process.env.INFURA_HTTP,
    ankrHttp: process.env.ANKR_HTTP,
    nodiesHttp: process.env.NODIES_HTTP,
    bloxrouteHeader: process.env.BLOXROUTE_HEADER,
    privateKey: process.env.PRIVATE_KEY,
    vaultAddress: process.env.VAULT_ADDRESS,
    safeAddress: process.env.SAFE_ADDRESS,
    usdtContract: process.env.USDT_CONTRACT,
    chainId: parseInt(process.env.CHAIN_ID) || 137,
    dryRun: process.env.DRY_RUN === "true",
    debug: process.env.DEBUG === "true",
    emergencyGasMult: parseFloat(process.env.EMERGENCY_GAS_MULTIPLIER) || 3.5,
    gasPremium: parseFloat(process.env.GAS_PREMIUM) || 0.5, // 50% above attacker
    poolSize: parseInt(process.env.POOL_SIZE) || 5,
    gasRefreshInterval: parseInt(process.env.GAS_REFRESH_INTERVAL) || 12000,
  };

  const monitor = new UltimateDefenseMonitor(CONFIG);
  monitor.run().catch(console.error);
}
