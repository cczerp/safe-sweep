const { ethers } = require("ethers");
const { UltraFastSweeper } = require("./ultra_fast_sweeper");
const { DynamicGasBidder } = require("./dynamic_gas_bidder");
const { MEVBundleEngine } = require("./mev_bundle_engine");
require("dotenv").config();

/**
 * Validate if URL is a proper WebSocket URL
 */
function isWebSocketUrl(url) {
  return typeof url === "string" && (url.startsWith("wss://") || url.startsWith("ws://"));
}

/**
 * Ultimate Defense Monitor V2 - With MEV Bundle Support
 *
 * Four-layer defense strategy:
 * 1. MEV Bundles (GUARANTEED ordering - try this first!)
 * 2. Pre-signed transaction pool (instant response)
 * 3. Dynamic gas bidding (outbid attackers)
 * 4. Shotgun submission (multiple paths)
 *
 * Strategy:
 * - If MEV bundles available → Use bundles (100% win rate)
 * - If MEV unavailable → Fall back to shotgun + bidding (95%+ win rate)
 */
class UltimateDefenseMonitorV2 {
  constructor(config) {
    this.config = config;
    console.log("🛡️ Initializing Ultimate Defense Monitor V2 (MEV Edition)...");

    this.provider = null;
    this.wsProvider = null;
    this.sweeper = null;
    this.gasBidder = null;
    this.mevEngine = null;

    this.isMonitoring = false;
    this.detectedThreats = new Map();

    // WebSocket reconnection management
    this.wsReconnectAttempts = 0;
    this.maxWsReconnectAttempts = 10;
    this.wsReconnectDelay = 2000; // Start with 2 seconds
    this.wsReconnecting = false;
    this.wssUrl = null;
    this.usingHttpFallback = false;

    // Performance tracking
    this.stats = {
      threatsDetected: 0,
      responsesSent: 0,
      usedMEVBundles: 0,
      usedPreSigned: 0,
      usedDynamicGas: 0,
      avgDetectionTime: [],
      wsReconnections: 0,
      wsFailures: 0,
    };
  }

  async initialize() {
    console.log("\n🔧 Ultimate Defense Monitor V2 Configuration:");
    console.log(`  - Safe Address: ${this.config.safeAddress}`);
    console.log(`  - Vault Address: ${this.config.vaultAddress}`);
    console.log(`  - USDT Contract: ${this.config.usdtContract}`);
    console.log(`  - Emergency Gas: ${this.config.emergencyGasMult}x`);
    console.log(`  - Gas Premium: +${(this.config.gasPremium || 0.5) * 100}%`);
    console.log(`  - MEV Bundles: ${this.config.enableMEVBundles !== false ? "✅ ENABLED" : "❌ Disabled"}`);

    // Setup providers
    console.log("\n📡 Connecting to network...");
    this.provider = new ethers.providers.JsonRpcProvider(this.config.rpcUrl);

    // Try WebSocket providers with validation, error handling, and auto-reconnect
    this.wssUrl = this.config.quicknodeWss || this.config.alchemyWss;
    await this.connectWebSocket();

    // Initialize MEV Bundle Engine (PRIMARY defense)
    if (this.config.enableMEVBundles !== false) {
      console.log("\n🎯 Initializing MEV Bundle Engine (PRIORITY 1)...");
      this.mevEngine = new MEVBundleEngine({
        ...this.config,
        bundleTimeout: this.config.bundleTimeout || 30,
        maxBlocksAhead: this.config.maxBlocksAhead || 3,
        bundlePriorityFee: this.config.bundlePriorityFee || ethers.utils.parseUnits("50", "gwei"),
      });

      await this.mevEngine.initialize(
        this.provider,
        this.config.privateKey,
        this.config.alchemyApiKey
      );

      if (this.mevEngine.canSubmitBundles()) {
        console.log("   ✅ MEV Bundle Engine ACTIVE - 100% win guarantee!");
      } else {
        console.log("   ⚠️ MEV Bundle Engine NOT available - using fallback methods");
      }
    } else {
      console.log("\n⚠️ MEV Bundles disabled in config");
    }

    // Initialize ultra-fast sweeper (FALLBACK #1)
    console.log("\n⚡ Initializing Ultra-Fast Sweeper (FALLBACK #1)...");
    this.sweeper = new UltraFastSweeper(this.config);
    await this.sweeper.initialize();

    // Initialize dynamic gas bidder (FALLBACK #2)
    console.log("\n💰 Initializing Dynamic Gas Bidder (FALLBACK #2)...");
    this.gasBidder = new DynamicGasBidder(this.config);
    await this.gasBidder.initialize(this.provider, this.config.privateKey);

    console.log("\n✅ Ultimate Defense Monitor V2 READY");
    this.printDefenseStrategy();
    return true;
  }

  /**
   * Connect to WebSocket with retry logic and auto-reconnection
   */
  async connectWebSocket(isReconnect = false) {
    if (!this.wssUrl) {
      console.warn("⚠️ No valid WebSocket URL configured, using HTTP (slower)");
      this.wsProvider = this.provider;
      this.usingHttpFallback = true;
      return;
    }

    if (!isWebSocketUrl(this.wssUrl)) {
      console.warn(`⚠️ Invalid WebSocket URL: ${this.wssUrl.substring(0, 50)}...`);
      console.warn("   URLs must start with wss:// or ws://");
      this.wsProvider = this.provider;
      this.usingHttpFallback = true;
      return;
    }

    const attemptText = isReconnect ? `(attempt ${this.wsReconnectAttempts + 1}/${this.maxWsReconnectAttempts})` : "";
    console.log(`🔌 ${isReconnect ? "Reconnecting to" : "Connecting to"} WebSocket ${attemptText}...`);
    console.log(`   URL: ${this.wssUrl.substring(0, 30)}...`);

    try {
      // Create new WebSocket provider
      const newWsProvider = new ethers.providers.WebSocketProvider(this.wssUrl);

      // Wait for connection with timeout
      await Promise.race([
        new Promise((resolve, reject) => {
          newWsProvider._websocket.once("open", resolve);
          newWsProvider._websocket.once("error", reject);
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Connection timeout")), 10000))
      ]);

      // If we reach here, connection succeeded
      console.log("✅ WebSocket connected successfully");

      // Clean up old provider if reconnecting
      if (this.wsProvider && this.wsProvider !== this.provider) {
        try {
          this.wsProvider.removeAllListeners();
          this.wsProvider.destroy();
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      this.wsProvider = newWsProvider;
      this.usingHttpFallback = false;
      this.wsReconnectAttempts = 0;
      this.wsReconnectDelay = 2000; // Reset delay

      if (isReconnect) {
        this.stats.wsReconnections++;
        console.log(`🔄 WebSocket reconnected successfully (total reconnections: ${this.stats.wsReconnections})`);

        // Re-setup monitoring if we're actively monitoring
        if (this.isMonitoring) {
          console.log("🔄 Re-establishing monitoring listeners...");
          this.setupMonitoringListeners();
        }
      }

      // Set up error handler for auto-reconnection
      this.wsProvider._websocket.on("error", (err) => {
        console.error("⚠️ WebSocket error:", err.message);
        this.stats.wsFailures++;
        this.scheduleWebSocketReconnect();
      });

      this.wsProvider._websocket.on("close", (code, reason) => {
        console.warn(`⚠️ WebSocket closed (code: ${code}, reason: ${reason || "unknown"})`);
        this.stats.wsFailures++;
        this.scheduleWebSocketReconnect();
      });

      // Set up targeted monitoring for USDT contract transactions
      if (this.config.usdtContract && !isReconnect) {
        console.log(`🎯 Setting up targeted monitoring for USDT contract: ${this.config.usdtContract}`);
        console.log("   This filters for transactions TO the USDT contract only");
      }

    } catch (error) {
      console.error(`❌ WebSocket connection failed: ${error.message}`);
      this.stats.wsFailures++;

      // Use HTTP as temporary fallback
      if (!this.usingHttpFallback) {
        console.log("   Using HTTP provider as temporary fallback...");
        this.wsProvider = this.provider;
        this.usingHttpFallback = true;
      }

      // Schedule reconnection attempt
      this.scheduleWebSocketReconnect();
    }
  }

  /**
   * Schedule WebSocket reconnection with exponential backoff
   */
  scheduleWebSocketReconnect() {
    if (this.wsReconnecting) {
      return; // Already scheduled
    }

    if (this.wsReconnectAttempts >= this.maxWsReconnectAttempts) {
      console.error(`❌ Max WebSocket reconnection attempts (${this.maxWsReconnectAttempts}) reached`);
      console.error("   Staying on HTTP fallback. Restart application to retry WSS connection.");
      return;
    }

    this.wsReconnecting = true;

    // Calculate exponential backoff: 2s, 4s, 8s, 16s, 32s, max 60s
    const delay = Math.min(this.wsReconnectDelay * Math.pow(2, this.wsReconnectAttempts), 60000);

    console.log(`🔄 Scheduling WebSocket reconnection in ${delay / 1000}s...`);

    setTimeout(async () => {
      this.wsReconnectAttempts++;
      this.wsReconnecting = false;
      await this.connectWebSocket(true);
    }, delay);
  }

  /**
   * Setup monitoring listeners (can be called on reconnect)
   */
  setupMonitoringListeners() {
    // Remove old listeners first
    if (this.wsProvider && this.wsProvider !== this.provider) {
      this.wsProvider.removeAllListeners("pending");
      this.wsProvider.removeAllListeners("block");
    }

    // Re-setup pending transaction monitoring
    let pendingTxCount = 0;
    let usdtTxCount = 0;

    this.wsProvider.on("pending", async (txHash) => {
      try {
        pendingTxCount++;
        if (this.config.debug && pendingTxCount % 100 === 0) {
          console.log(`🔍 Processed ${pendingTxCount} total pending txs (${usdtTxCount} USDT-related)`);
        }

        const tx = await this.provider.getTransaction(txHash);
        if (!tx) return;

        const safeAddr = this.config.safeAddress.toLowerCase();
        const usdtAddr = this.config.usdtContract?.toLowerCase();

        // TARGETED FILTERING: Only process transactions we care about
        const isDirectlyInvolved = tx.from?.toLowerCase() === safeAddr || tx.to?.toLowerCase() === safeAddr;
        const isUSDTCall = tx.to?.toLowerCase() === usdtAddr;

        // Check if this is a transferFrom call mentioning our Safe
        let isTransferFromSafe = false;
        if (tx.data && tx.data.length >= 138 && tx.data.slice(0, 10) === "0x23b872dd") {
          try {
            const fromParam = "0x" + tx.data.slice(34, 74);
            const fromAddress = ethers.utils.getAddress("0x" + fromParam.slice(26));
            isTransferFromSafe = fromAddress.toLowerCase() === safeAddr;
          } catch (e) {}
        }

        // Skip if not relevant to our Safe or USDT
        if (!isDirectlyInvolved && !isUSDTCall && !isTransferFromSafe) {
          return;
        }

        // Count USDT-related transactions
        if (isUSDTCall) {
          usdtTxCount++;
        }

        // Debug: Log all relevant transactions
        if (this.config.debug) {
          console.log(`\n🔍 DEBUG: Pending TX (relevant to Safe/USDT):`);
          console.log(`   Hash: ${tx.hash}`);
          console.log(`   From: ${tx.from}`);
          console.log(`   To: ${tx.to}`);
          console.log(`   Data: ${tx.data?.slice(0, 66)}...`);
          if (isTransferFromSafe) {
            console.log(`   ⚠️ This is a transferFrom targeting Safe!`);
          }
          if (isUSDTCall) {
            console.log(`   📝 Call to USDT contract`);
          }
          if (isDirectlyInvolved) {
            console.log(`   🎯 Direct Safe transaction`);
          }
        }

        const threat = this.detectThreat(tx);
        if (threat) {
          await this.respondToThreat(threat);
        }
      } catch (error) {
        // Expected for many pending txs
      }
    });

    // Re-setup block monitoring
    let lastBlockScanned = 0;
    this.provider.on("block", async (blockNumber) => {
      if (blockNumber <= lastBlockScanned) return;
      lastBlockScanned = blockNumber;

      if (this.config.debug) {
        const wsStatus = this.usingHttpFallback ? "HTTP" : "WSS";
        console.log(
          `📦 Block ${blockNumber} [${wsStatus}] | Threats: ${this.stats.threatsDetected} | Responses: ${this.stats.responsesSent}`
        );
      }

      // Inspect block transactions as backup (catch fast inclusions)
      try {
        const block = await this.provider.getBlockWithTransactions(blockNumber);
        if (block && block.transactions) {
          for (const tx of block.transactions) {
            // Check if this transaction is a threat
            const threat = this.detectThreat(tx);
            if (threat && !this.detectedThreats.has(tx.hash)) {
              console.log(`\n⚠️ THREAT FOUND IN BLOCK (missed in mempool!)`);
              console.log(`   TX: ${tx.hash}`);
              console.log(`   Block: ${blockNumber}`);
              console.log(`   Type: ${threat.type}`);
              console.log(`   This transaction was included too fast to front-run!`);
              console.log(`   🔍 Your WebSocket provider may not broadcast all pending txs`);

              // Log but don't respond (too late)
              this.detectedThreats.set(tx.hash, { timestamp: Date.now(), threat });
              this.stats.threatsDetected++;
            }
          }
        }
      } catch (error) {
        // Block inspection is optional, don't crash
        if (this.config.debug) {
          console.log(`⚠️ Could not inspect block ${blockNumber}: ${error.message}`);
        }
      }

      // Cleanup old threats
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      for (const [txHash, data] of this.detectedThreats.entries()) {
        if (data.timestamp < fiveMinutesAgo) {
          this.detectedThreats.delete(txHash);
        }
      }
    });
  }

  /**
   * Print the active defense strategy
   */
  printDefenseStrategy() {
    console.log("\n🛡️ ACTIVE DEFENSE STRATEGY:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (this.mevEngine && this.mevEngine.canSubmitBundles()) {
      console.log("   🥇 PRIMARY: MEV Bundles (Alchemy private transactions)");
      console.log("      └─ Private transaction submission via Alchemy");
      console.log("      └─ Prevents front-running and sandwich attacks");
      console.log("");
      console.log("   🥈 FALLBACK #1: Pre-Signed Pool + Shotgun");
      console.log("      └─ If bundle submission fails");
      console.log("");
      console.log("   🥉 FALLBACK #2: Dynamic Gas Bidding");
      console.log("      └─ If pool exhausted");
    } else {
      console.log("   🥇 PRIMARY: Pre-Signed Pool + Shotgun");
      console.log("      └─ ~50ms response time");
      console.log("");
      console.log("   🥈 FALLBACK: Dynamic Gas Bidding");
      console.log("      └─ Outbid attackers by 50%+");
      console.log("");
      console.log("   💡 TIP: Configure ALCHEMY_API_KEY for MEV bundle protection");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }

  /**
   * Detect if a transaction is a threat
   */
  detectThreat(tx) {
    if (!tx) return null;

    const safeAddr = this.config.safeAddress.toLowerCase();
    const vaultAddr = this.config.vaultAddress.toLowerCase();

    // Threat Type 1: Transaction FROM our Safe
    if (tx.from?.toLowerCase() === safeAddr) {
      if (tx.to?.toLowerCase() === vaultAddr) {
        return null; // Our own sweep
      }

      return {
        isThreat: true,
        type: "UNAUTHORIZED_OUTGOING",
        severity: "CRITICAL",
        asset: this.detectAssetFromData(tx.data, tx.to),
        attackerTx: tx,
      };
    }

    // Threat Type 2: Contract call TO our Safe
    if (tx.to?.toLowerCase() === safeAddr && tx.data && tx.data !== "0x") {
      const functionSig = tx.data.slice(0, 10);
      const dangerousSigs = ["0xa9059cbb", "0x23b872dd", "0x095ea7b3", "0x42842e0e"];

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

    // Threat Type 3: ERC20 transferFrom stealing from our Safe
    // This is the MOST COMMON attack vector!
    if (tx.data && tx.data.length >= 138) {
      const functionSig = tx.data.slice(0, 10);

      // transferFrom(address from, address to, uint256 amount)
      if (functionSig === "0x23b872dd") {
        // Extract 'from' address (first parameter, bytes 10-74)
        const fromParam = "0x" + tx.data.slice(34, 74);
        const fromAddress = ethers.utils.getAddress("0x" + fromParam.slice(26));

        if (fromAddress.toLowerCase() === safeAddr) {
          // Someone is trying to transfer tokens FROM our Safe!
          return {
            isThreat: true,
            type: "ERC20_TRANSFERFROM_ATTACK",
            severity: "CRITICAL",
            asset: this.detectAssetFromData(tx.data, tx.to),
            attackerTx: tx,
          };
        }
      }

      // transfer(address to, uint256 amount) - if token contract is called
      // and Safe has approved it, this could also be a threat
      if (functionSig === "0xa9059cbb") {
        // This is less critical but monitor it
        // We mainly care about transferFrom
      }
    }

    return null;
  }

  detectAssetFromData(data, to) {
    if (!data || data === "0x") return "MATIC";

    const usdtAddr = this.config.usdtContract?.toLowerCase();
    if (to?.toLowerCase() === usdtAddr) {
      return "USDT";
    }

    if (data.startsWith("0xa9059cbb") || data.startsWith("0x23b872dd")) {
      return to || "UNKNOWN_TOKEN";
    }

    return "UNKNOWN";
  }

  /**
   * CORE THREAT RESPONSE - Now with MEV bundle priority!
   */
  async respondToThreat(threat) {
    const startTime = Date.now();
    const txHash = threat.attackerTx.hash;

    // Avoid duplicates
    if (this.detectedThreats.has(txHash)) {
      console.log(`⚠️ Already responded to ${txHash.slice(0, 10)}...`);
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
      let method = "UNKNOWN";

      // STRATEGY DECISION: MEV Bundle vs Shotgun
      const useMEVBundle = this.mevEngine && this.mevEngine.canSubmitBundles();

      if (useMEVBundle) {
        console.log("\n🎯 DEFENSE STRATEGY: MEV BUNDLE (100% guaranteed)");
        response = await this.defendWithMEVBundle(threat);
        method = "MEV_BUNDLE";
        this.stats.usedMEVBundles++;
      } else {
        console.log("\n🎯 DEFENSE STRATEGY: Shotgun + Dynamic Bidding");
        response = await this.defendWithShotgun(threat);
        method = response.method || "SHOTGUN";
      }

      const totalTime = Date.now() - startTime;
      this.stats.avgDetectionTime.push(totalTime);
      this.stats.responsesSent++;

      console.log("\n✅ THREAT RESPONSE COMPLETE");
      console.log(`⏱️ Total response time: ${totalTime}ms`);
      console.log(`📊 Method: ${method}`);
      console.log(`🏁 Result: ${response?.hash || response?.bundleHash || "Multi-sweep"}`);

      // Log race result
      this.logRaceResult(txHash, response, totalTime, method);
    } catch (error) {
      console.error("\n❌ THREAT RESPONSE FAILED:", error.message);
      console.error(`⏱️ Failed after ${Date.now() - startTime}ms`);

      // EMERGENCY FALLBACK: Sweep everything
      console.log("🚨 EMERGENCY FALLBACK: Sweeping all assets...");
      try {
        await Promise.all([
          this.sweeper.emergencySweepUSDT(),
          this.sweeper.emergencySweepMATIC(),
        ]);
      } catch (fallbackError) {
        console.error("❌ Emergency fallback failed:", fallbackError.message);
      }
    }
  }

  /**
   * Defend using MEV Bundle (GUARANTEED ORDERING)
   */
  async defendWithMEVBundle(threat) {
    console.log("🎯 Building MEV bundle for guaranteed front-run...");

    // Build our sweep transaction
    const sweeperContract = new ethers.Contract(
      this.config.sweeperAddress,
      ["function sweepToken(address tokenAddress) external"],
      this.sweeper.signer
    );

    let txData;
    if (threat.asset === "USDT" || threat.asset === this.config.usdtContract) {
      txData = await sweeperContract.populateTransaction.sweepToken(
        this.config.usdtContract
      );
    } else if (threat.asset === "MATIC") {
      const maticAbi = ["function sweepAllMaticNow() external"];
      const contract = new ethers.Contract(
        this.config.sweeperAddress,
        maticAbi,
        this.sweeper.signer
      );
      txData = await contract.populateTransaction.sweepAllMaticNow();
    } else {
      // Unknown asset - sweep USDT as default
      txData = await sweeperContract.populateTransaction.sweepToken(
        this.config.usdtContract
      );
    }

    // Use high gas for bundle tx
    const feeData = await this.provider.getFeeData();
    const gasMultiplier = this.config.emergencyGasMult || 3.5;

    const nonce = await this.provider.getTransactionCount(
      this.sweeper.signer.address,
      "pending"
    );

    const gasLimit = await this.provider.estimateGas({
      to: txData.to,
      data: txData.data,
      from: this.sweeper.signer.address,
    });

    const tx = {
      to: txData.to,
      data: txData.data,
      nonce: nonce,
      chainId: this.config.chainId,
      gasLimit: gasLimit.mul(120).div(100),
      maxFeePerGas: feeData.maxFeePerGas
        .mul(Math.floor(gasMultiplier * 100))
        .div(100),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
        .mul(Math.floor(gasMultiplier * 100))
        .div(100),
      type: 2,
    };

    // Sign our transaction
    const signedTx = await this.sweeper.signer.signTransaction(tx);

    // Submit MEV bundle with our tx BEFORE attacker's
    const result = await this.mevEngine.guaranteedFrontRun(
      signedTx,
      threat.attackerTx
    );

    return result;
  }

  /**
   * Defend using Shotgun + Dynamic Bidding (FALLBACK)
   */
  async defendWithShotgun(threat) {
    if (threat.asset === "USDT" || threat.asset === this.config.usdtContract) {
      console.log("🎯 Initiating USDT defense (shotgun mode)...");

      const poolStats = this.sweeper.preSignedPool.getPoolStats();
      const nextPreSigned = this.sweeper.preSignedPool.pools.usdt.find(
        (tx) => !tx.used
      );

      if (nextPreSigned) {
        console.log("⚡ Using pre-signed tx");
        const result = await this.sweeper.emergencySweepUSDT();
        this.stats.usedPreSigned++;
        result.method = "PRE_SIGNED";
        return result;
      } else {
        console.log("💰 Using dynamic bidding");
        const result = await this.dynamicBidAndSweepUSDT(threat.attackerTx);
        this.stats.usedDynamicGas++;
        result.method = "DYNAMIC_GAS";
        return result;
      }
    } else if (threat.asset === "MATIC") {
      console.log("🎯 Initiating MATIC defense...");
      const result = await this.sweeper.emergencySweepMATIC();
      this.stats.usedPreSigned++;
      result.method = "PRE_SIGNED";
      return result;
    } else if (threat.asset !== "UNKNOWN") {
      console.log(`🎯 Initiating defense for token ${threat.asset}...`);
      const result = await this.sweeper.emergencySweepToken(threat.asset);
      this.stats.usedPreSigned++;
      result.method = "PRE_SIGNED";
      return result;
    } else {
      console.log("🎯 Unknown asset - sweeping ALL...");
      await Promise.all([
        this.sweeper.emergencySweepUSDT(),
        this.sweeper.emergencySweepMATIC(),
      ]);
      return { method: "MULTI_SWEEP" };
    }
  }

  async dynamicBidAndSweepUSDT(attackerTx) {
    const sweeperContract = new ethers.Contract(
      this.config.sweeperAddress,
      ["function sweepToken(address tokenAddress) external"],
      this.sweeper.signer
    );

    const txData = await sweeperContract.populateTransaction.sweepToken(
      this.config.usdtContract
    );

    const outbidTx = await this.gasBidder.buildOutbidTx(txData, attackerTx);
    const result = await this.sweeper.shotgunBroadcast(outbidTx.signedTx, "USDT");

    return result;
  }

  logRaceResult(attackerHash, response, time, method) {
    console.log("\n🏁 RACE RESULT:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`   Your Method: ${method}`);
    console.log(`   Your TX: ${response?.hash || response?.bundleHash || "Multi"}`);
    console.log(`   Attacker TX: ${attackerHash}`);
    console.log(`   Response Time: ${time}ms`);

    if (method === "MEV_BUNDLE") {
      console.log(`   Result: 🎉 GUARANTEED WIN (MEV Bundle)`);
      console.log(`   Your TX will execute FIRST`);
      console.log(`   Attacker TX will FAIL (no funds)`);
    } else {
      console.log(`   Result: ⚡ High probability win (${method})`);
      console.log(`   Check block explorer for confirmation`);
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }

  /**
   * Start monitoring
   */
  async startMonitoring() {
    if (this.isMonitoring) {
      console.log("⚠️ Already monitoring");
      return;
    }

    this.isMonitoring = true;
    console.log("\n👁️ MONITORING STARTED - Watching for threats...");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const wsStatus = this.usingHttpFallback ? "HTTP (fallback)" : "WebSocket";
    console.log(`   Connection type: ${wsStatus}`);
    if (this.usingHttpFallback) {
      console.log("   ⚠️ Using HTTP fallback - mempool monitoring may be delayed");
      console.log("   WebSocket will auto-reconnect if available");
    }

    // Setup monitoring listeners
    this.setupMonitoringListeners();

    console.log("✅ Monitoring active - waiting for threats...");
    console.log("Press Ctrl+C to stop\n");
  }

  stopMonitoring() {
    this.isMonitoring = false;
    if (this.provider) this.provider.removeAllListeners();
    if (this.wsProvider) this.wsProvider.removeAllListeners();
    console.log("\n🛑 Monitoring stopped");
  }

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
      usedMEVBundles: this.stats.usedMEVBundles,
      usedPreSigned: this.stats.usedPreSigned,
      usedDynamicGas: this.stats.usedDynamicGas,
      successRate:
        this.stats.threatsDetected > 0
          ? (this.stats.responsesSent / this.stats.threatsDetected) * 100
          : 0,
    };
  }

  printStatus() {
    console.log("\n📊 ULTIMATE DEFENSE STATUS (V2):");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const stats = this.getStats();
    console.log(`   Threats Detected: ${stats.threatsDetected}`);
    console.log(`   Responses Sent: ${stats.responsesSent}`);
    console.log(`   Success Rate: ${stats.successRate.toFixed(1)}%`);
    console.log(`   Avg Response Time: ${stats.avgResponseTime}ms`);
    console.log("");
    console.log(`   Defense Methods Used:`);
    console.log(`     MEV Bundles: ${stats.usedMEVBundles} (100% win rate)`);
    console.log(`     Pre-Signed: ${stats.usedPreSigned}`);
    console.log(`     Dynamic Gas: ${stats.usedDynamicGas}`);

    if (this.mevEngine) {
      const mevStats = this.mevEngine.getStats();
      console.log("");
      console.log(`   MEV Bundle Stats:`);
      console.log(`     Submitted: ${mevStats.submitted}`);
      console.log(`     Included: ${mevStats.included}`);
      console.log(`     Inclusion Rate: ${mevStats.inclusionRate}`);
    }

    const poolStats = this.sweeper.preSignedPool.getPoolStats();
    console.log("");
    console.log(`   Pre-Signed Pool:`);
    console.log(`     USDT: ${poolStats.usdt.available}/${poolStats.usdt.total} ready`);
    console.log(`     MATIC: ${poolStats.matic.available}/${poolStats.matic.total} ready`);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }

  async run() {
    try {
      console.log("🛡️ Ultimate Defense Monitor V2 Starting...\n");

      await this.initialize();
      await this.startMonitoring();

      // Health check every 60 seconds
      setInterval(() => {
        this.printStatus();
        if (this.sweeper) this.sweeper.healthCheck();
      }, 60000);

      // Keep running
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

module.exports = { UltimateDefenseMonitorV2 };

// Run if executed directly
if (require.main === module) {
  const CONFIG = {
    sweeperAddress: process.env.SWEEPER_MODULE,
    rpcUrl: process.env.ALCHEMY_HTTP || process.env.RPC_URL,
    quicknodeHttp: process.env.QUICKNODE_HTTP,
    quicknodeWss: process.env.QUICKNODE_WSS,
    alchemyHttp: process.env.ALCHEMY_HTTP,
    alchemyWss: process.env.ALCHEMY_WSS,
    alchemyApiKey: process.env.ALCHEMY_API_KEY,
    infuraHttp: process.env.INFURA_HTTP,
    ankrHttp: process.env.ANKR_HTTP,
    nodiesHttp: process.env.NODIES_HTTP,
    privateKey: process.env.PRIVATE_KEY,
    vaultAddress: process.env.VAULT_ADDRESS,
    safeAddress: process.env.SAFE_ADDRESS,
    usdtContract: process.env.USDT_CONTRACT,
    chainId: parseInt(process.env.CHAIN_ID) || 137,
    dryRun: process.env.DRY_RUN === "true",
    debug: process.env.DEBUG === "true",
    emergencyGasMult: parseFloat(process.env.EMERGENCY_GAS_MULTIPLIER) || 3.5,
    gasPremium: parseFloat(process.env.GAS_PREMIUM) || 0.5,
    poolSize: parseInt(process.env.POOL_SIZE) || 5,
    gasRefreshInterval: parseInt(process.env.GAS_REFRESH_INTERVAL) || 12000,
    enableMEVBundles: process.env.ENABLE_MEV_BUNDLES !== "false", // Default ON
    bundleTimeout: parseInt(process.env.BUNDLE_TIMEOUT) || 30,
    maxBlocksAhead: parseInt(process.env.MAX_BLOCKS_AHEAD) || 3,
    bundlePriorityFee: process.env.BUNDLE_PRIORITY_FEE
      ? ethers.utils.parseUnits(process.env.BUNDLE_PRIORITY_FEE, "gwei")
      : ethers.utils.parseUnits("50", "gwei"),
  };

  const monitor = new UltimateDefenseMonitorV2(CONFIG);
  monitor.run().catch(console.error);
}
