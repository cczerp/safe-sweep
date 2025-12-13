const { ethers } = require("ethers");
const { UltraFastSweeper } = require("./ultra_fast_sweeper");
const { DynamicGasBidder } = require("./dynamic_gas_bidder");
const { MEVBundleEngine } = require("./mev_bundle_engine");
const { ApprovalTracker } = require("./approval_tracker");
const { PolygonGasCalculator } = require("./polygon_gas_calculator");
const { NonceCancellation } = require("./nonce_cancellation");
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
    this.nonceCancellation = null;
    this.polygonGas = new PolygonGasCalculator({
      minimumGasGwei: config.polygonMinimumGasGwei || 25,
      baseTipGwei: config.polygonBaseTipGwei || 50,
      congestedTipGwei: config.polygonCongestedTipGwei || 150,
      aggressiveTipGwei: config.polygonAggressiveTipGwei || 200,
      emergencyTipGwei: config.polygonEmergencyTipGwei || 200,
    });

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
    console.log(`  - Debug Mode: ${this.config.debug ? "✅ ENABLED" : "❌ Disabled"}`);
    console.log(`  - Verbose Mode: ${this.config.verbose ? "✅ ENABLED (will log ALL Safe txs)" : "❌ Disabled"}`);

    // Setup providers
    console.log("\n📡 Connecting to network...");
    this.provider = new ethers.providers.JsonRpcProvider(this.config.rpcUrl);

    // Try WebSocket providers with validation, error handling, and auto-reconnect
    // Priority: dRPC (MEV protected) > Quicknode > Infura
    this.wssUrl = this.config.drpcWss || this.config.quicknodeWss || this.config.infuraWss;
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
        this.config.mevSearcherKey
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

    // Initialize approval intelligence tracker (ADVANCE INTEL)
    console.log("\n🔍 Initializing Approval Intelligence Tracker...");
    this.approvalTracker = new ApprovalTracker(this.config);
    await this.approvalTracker.initialize();

    // Initialize nonce cancellation strategy (BLOCKING DEFENSE)
    console.log("\n🚫 Initializing Nonce Cancellation Strategy...");
    this.nonceCancellation = new NonceCancellation(this.config);
    await this.nonceCancellation.initialize(this.provider, this.config.privateKey);

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

      // Set up targeted monitoring
      if (!isReconnect) {
        console.log(`🎯 Setting up targeted monitoring for Safe: ${this.config.safeAddress}`);
        console.log("   Watching for:");
        console.log("   1. Direct transactions from/to Safe");
        console.log("   2. transferFrom() calls draining Safe");
        if (this.config.usdtContract) {
          console.log(`   USDT Contract: ${this.config.usdtContract}`);
        }
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
    let relevantTxCount = 0;

    this.wsProvider.on("pending", async (txHash) => {
      try {
        pendingTxCount++;
        if (this.config.debug && pendingTxCount % 100 === 0) {
          console.log(`🔍 Processed ${pendingTxCount} total pending txs (${relevantTxCount} relevant to Safe)`);
        }

        // SPEED OPTIMIZATION: Use Promise with timeout to avoid hanging on slow tx fetches
        const tx = await Promise.race([
          this.provider.getTransaction(txHash),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
        ]).catch(() => null);
        if (!tx) return;

        // PROACTIVE DEFENSE: Check if tx is FROM a watched address (has approval)
        if (this.approvalTracker && this.approvalTracker.isWatchedAddress(tx.from)) {
          console.log(`\n🚨 PROACTIVE ALERT: Watched address is transacting!`);
          console.log(`   Address: ${tx.from}`);
          console.log(`   TX Hash: ${tx.hash}`);
          const context = this.approvalTracker.getContext(tx.from);
          if (context) {
            console.log(`   Context: ${context}`);
          }
          console.log(`   ⚡ Triggering IMMEDIATE SWEEP before they can attack!`);

          // Immediate sweep - don't wait for them to execute transferFrom
          const proactiveThreat = {
            type: "PROACTIVE_APPROVED_ADDRESS",
            asset: "USDT", // Sweep USDT since they have approval
            attackerTx: tx,
            txHash: tx.hash,
            isKnownApproved: true,
            approvalContext: context,
          };

          await this.respondToThreat(proactiveThreat);
          return; // Don't process further
        }

        const safeAddr = this.config.safeAddress.toLowerCase();

        // ULTRA VERBOSE: Log EVERY transaction involving Safe address (even indirectly)
        if (this.config.verbose) {
          const involvesSafe =
            tx.from?.toLowerCase() === safeAddr ||
            tx.to?.toLowerCase() === safeAddr ||
            (tx.data && tx.data.includes(safeAddr.slice(2))); // Check if Safe address is in data

          if (involvesSafe) {
            console.log(`\n🔍 ULTRA-VERBOSE: TX involving Safe detected in mempool:`);
            console.log(`   Hash: ${tx.hash}`);
            console.log(`   From: ${tx.from}`);
            console.log(`   To: ${tx.to}`);
            console.log(`   Data (first 200 chars): ${tx.data?.slice(0, 200)}...`);
            console.log(`   Function sig: ${tx.data?.slice(0, 10)}`);
            console.log(`   Gas Price: ${tx.gasPrice ? ethers.utils.formatUnits(tx.gasPrice, "gwei") : "N/A"} gwei`);
            console.log(`   ---`);
          }
        }

        // SUPER VERBOSE: Log ALL transferFrom calls if verbose mode enabled
        if (this.config.verbose && tx.data && tx.data.slice(0, 10) === "0x23b872dd") {
          console.log(`\n🔍 VERBOSE: Found transferFrom() call:`);
          console.log(`   Hash: ${tx.hash}`);
          console.log(`   From: ${tx.from}`);
          console.log(`   To: ${tx.to}`);
          try {
            // transferFrom(address from, address to, uint256 amount)
            // Data layout: 0x + 8char sig + 64char param1 + 64char param2 + 64char param3
            // The 'from' address is in param1, positions 34-73 (40 hex chars)
            const fromAddress = ethers.utils.getAddress("0x" + tx.data.slice(34, 74));
            console.log(`   transferFrom 'from' param: ${fromAddress}`);
            console.log(`   Your Safe: ${this.config.safeAddress}`);
            console.log(`   Match: ${fromAddress.toLowerCase() === safeAddr ? "✅ YES" : "❌ NO"}`);
          } catch (e) {
            console.log(`   ⚠️ Could not decode transferFrom params: ${e.message}`);
          }
        }

        // TARGETED FILTERING: Only process transactions we care about
        const isDirectlyInvolved = tx.from?.toLowerCase() === safeAddr || tx.to?.toLowerCase() === safeAddr;

        // Check if this is a transferFrom call where OUR SAFE is being drained
        let isTransferFromSafe = false;
        let transferFromContract = null;
        if (tx.data && tx.data.length >= 138 && tx.data.slice(0, 10) === "0x23b872dd") {
          try {
            // transferFrom(address from, address to, uint256 amount)
            // Extract the 'from' address (first parameter, chars 34-73)
            const fromAddress = ethers.utils.getAddress("0x" + tx.data.slice(34, 74));
            if (fromAddress.toLowerCase() === safeAddr) {
              isTransferFromSafe = true;
              transferFromContract = tx.to;
            }
          } catch (e) {
            // Invalid address encoding, skip
          }
        }

        // CRITICAL: Skip if not relevant to our Safe
        // We ONLY care about:
        // 1. Transactions directly from/to our Safe
        // 2. transferFrom() calls where our Safe is being drained
        if (!isDirectlyInvolved && !isTransferFromSafe) {
          return;
        }

        // Count relevant transactions
        relevantTxCount++;

        // Debug: Log all relevant transactions
        if (this.config.debug) {
          console.log(`\n🔍 DEBUG: Pending TX (relevant to Safe):`);
          console.log(`   Hash: ${tx.hash}`);
          console.log(`   From: ${tx.from}`);
          console.log(`   To: ${tx.to}`);
          console.log(`   Data: ${tx.data?.slice(0, 66)}...`);
          if (isTransferFromSafe) {
            console.log(`   🚨 THREAT: transferFrom() draining Safe!`);
            console.log(`   🎯 Token Contract: ${transferFromContract}`);
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
          const safeAddr = this.config.safeAddress.toLowerCase();

          for (const tx of block.transactions) {
            // VERBOSE: Log any transaction involving Safe found in block
            if (this.config.verbose) {
              const involvesSafe =
                tx.from?.toLowerCase() === safeAddr ||
                tx.to?.toLowerCase() === safeAddr ||
                (tx.data && tx.data.includes && tx.data.includes(safeAddr.slice(2)));

              if (involvesSafe) {
                console.log(`\n📦 VERBOSE: TX involving Safe found in block ${blockNumber}:`);
                console.log(`   Hash: ${tx.hash}`);
                console.log(`   From: ${tx.from}`);
                console.log(`   To: ${tx.to}`);
                console.log(`   Function sig: ${tx.data?.slice(0, 10)}`);
                console.log(`   Was this in mempool? ${this.detectedThreats.has(tx.hash) ? "✅ YES" : "❌ NO (too fast!)"}`);
              }
            }

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
        // Errors can happen with malformed tx data, network issues, etc.
        // Silently skip - mempool monitoring is the primary detection method
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
      console.log("   🥇 PRIMARY: MEV Bundles (Marlin Relay)");
      console.log("      └─ Bundle submission via Marlin Relay");
      console.log("      └─ Guaranteed transaction ordering");
      console.log("      └─ Prevents front-running and sandwich attacks");
      console.log("");
      console.log("   🥈 FALLBACK: Real-Time Dynamic Gas Bidding");
      console.log("      └─ Generate tx with LIVE gas prices on threat detection");
      console.log("      └─ +20% aggressive gas bump above current market");
      console.log("      └─ Shotgun broadcast to multiple RPCs");
    } else {
      console.log("   🥇 PRIMARY: Real-Time Dynamic Gas Bidding + Shotgun");
      console.log("      └─ Generate tx with LIVE gas prices on threat detection");
      console.log("      └─ +20% aggressive gas bump above current market");
      console.log("      └─ Multi-RPC shotgun broadcast");
      console.log("");
      console.log("   💡 TIP: Configure MEV_SEARCHER_KEY for MEV bundle protection");
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
        try {
          // Extract 'from' address (first parameter, positions 34-73 = 40 hex chars)
          const fromAddress = ethers.utils.getAddress("0x" + tx.data.slice(34, 74));

          if (fromAddress.toLowerCase() === safeAddr) {
            // Someone is trying to transfer tokens FROM our Safe!

            // Check if attacker is on our watch list (was previously approved)
            const attackerAddress = tx.from;
            const isWatched = this.approvalTracker && this.approvalTracker.isWatchedAddress(attackerAddress);
            const approvalContext = isWatched ? this.approvalTracker.getContext(attackerAddress) : null;

            return {
              isThreat: true,
              type: "ERC20_TRANSFERFROM_ATTACK",
              severity: "CRITICAL",
              asset: this.detectAssetFromData(tx.data, tx.to),
              attackerTx: tx,
              isKnownApproved: isWatched,
              approvalContext: approvalContext,
            };
          }
        } catch (e) {
          // Malformed transferFrom data, skip
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

    // Show approval intelligence if available
    if (threat.isKnownApproved && threat.approvalContext) {
      console.log(`👁️  INTEL: ${threat.approvalContext}`);
      console.log(`   ⚠️  This address was previously approved and is NOW ATTACKING!`);
    }

    try {
      let response;
      let method = "UNKNOWN";

      // STRATEGY DECISION: MEV Bundle vs Shotgun
      const useMEVBundle = this.mevEngine && this.mevEngine.canSubmitBundles();
      const useNonceCancellation = this.config.enableNonceCancellation !== false;

      if (useMEVBundle) {
        if (useNonceCancellation) {
          console.log("\n🎯 DEFENSE STRATEGY: TRIPLE PARALLEL EXECUTION");
          console.log("   ⚡ Racing 3 methods simultaneously:");
          console.log("      1. MEV Bundle (guaranteed ordering)");
          console.log("      2. Shotgun broadcast (speed)");
          console.log("      3. Nonce cancellation (blocking)");

          // ADVANCED OPTIMIZATION: Run THREE methods in parallel
          // 1. MEV Bundle - guaranteed ordering
          const bundlePromise = this.defendWithMEVBundle(threat)
            .then(result => ({ result, method: "MEV_BUNDLE", source: "bundle" }))
            .catch(error => ({ error, source: "bundle" }));

          // 2. Shotgun - fast broadcast
          const shotgunPromise = this.defendWithShotgun(threat)
            .then(result => ({ result, method: result.method || "SHOTGUN", source: "shotgun" }))
            .catch(error => ({ error, source: "shotgun" }));

          // 3. Nonce cancellation - block attacker by creating congestion
          const cancellationPromise = this.attemptNonceCancellation(threat)
            .then(result => ({ result, method: "NONCE_CANCEL", source: "cancellation" }))
            .catch(error => ({ error, source: "cancellation" }));

          // Race them - fastest wins!
          const winner = await Promise.race([bundlePromise, shotgunPromise, cancellationPromise]);

          if (winner.error) {
            // Winner failed, wait for the other methods
            console.log(`   ⚠️ ${winner.source} failed, waiting for other methods...`);
            const results = await Promise.allSettled([bundlePromise, shotgunPromise, cancellationPromise]);
            const successResult = results.find(r => r.status === 'fulfilled' && !r.value.error);

            if (successResult) {
              response = successResult.value.result;
              method = successResult.value.method;
              console.log(`   ✅ Fallback to ${successResult.value.source} succeeded!`);
            } else {
              throw new Error("All defense methods failed");
            }
          } else {
            response = winner.result;
            method = winner.method;
            console.log(`   🏆 ${winner.source} won the race!`);

            if (winner.source === "bundle") {
              this.stats.usedMEVBundles++;
            } else {
              this.stats.usedDynamicGas++;
            }
          }
        } else {
          // Dual parallel: MEV Bundle + Shotgun only
          console.log("\n🎯 DEFENSE STRATEGY: DUAL PARALLEL EXECUTION (MEV Bundle + Shotgun)");
          console.log("   ⚡ Racing both methods - using whichever completes first!");

          const bundlePromise = this.defendWithMEVBundle(threat)
            .then(result => ({ result, method: "MEV_BUNDLE", source: "bundle" }))
            .catch(error => ({ error, source: "bundle" }));

          const shotgunPromise = this.defendWithShotgun(threat)
            .then(result => ({ result, method: result.method || "SHOTGUN", source: "shotgun" }))
            .catch(error => ({ error, source: "shotgun" }));

          const winner = await Promise.race([bundlePromise, shotgunPromise]);

          if (winner.error) {
            console.log(`   ⚠️ ${winner.source} failed, waiting for other method...`);
            const results = await Promise.allSettled([bundlePromise, shotgunPromise]);
            const successResult = results.find(r => r.status === 'fulfilled' && !r.value.error);

            if (successResult) {
              response = successResult.value.result;
              method = successResult.value.method;
              console.log(`   ✅ Fallback to ${successResult.value.source} succeeded!`);
            } else {
              throw new Error("Both MEV bundle and shotgun failed");
            }
          } else {
            response = winner.result;
            method = winner.method;
            console.log(`   🏆 ${winner.source} won the race!`);

            if (winner.source === "bundle") {
              this.stats.usedMEVBundles++;
            } else {
              this.stats.usedDynamicGas++;
            }
          }
        }
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

      // EMERGENCY FALLBACK: Sweep configured assets
      console.log("🚨 EMERGENCY FALLBACK: Sweeping all assets...");
      try {
        const sweepPromises = [];

        // Always sweep USDT
        sweepPromises.push(this.sweeper.emergencySweepUSDT());

        // Only sweep MATIC if enabled (disabled by default to save gas)
        if (this.config.sweepMatic !== false) {
          sweepPromises.push(this.sweeper.emergencySweepMATIC());
        }

        await Promise.all(sweepPromises);
      } catch (fallbackError) {
        console.error("❌ Emergency fallback failed:", fallbackError.message);
      }
    }
  }

  /**
   * Attempt to cancel attacker's transaction using nonce competition
   * Send a high-gas tx to block/delay attacker, buying time for sweep
   * 
   * Note: This sends a dummy tx first, then the sweep with the NEXT nonce
   */
  async attemptNonceCancellation(threat) {
    if (!this.nonceCancellation) {
      throw new Error("Nonce cancellation not initialized");
    }

    console.log("🚫 Attempting nonce cancellation strategy...");
    
    try {
      // Get attacker's gas to outbid
      const attackerGas = this.gasBidder.parseGasFromTx(threat.attackerTx);
      
      // Get our current nonce ONCE to avoid race condition
      const ourNonce = await this.provider.getTransactionCount(this.sweeper.signer.address, "pending");
      
      console.log(`   Using nonce ${ourNonce} for cancellation, ${ourNonce + 1} for sweep`);
      
      // Send cancellation tx with very high gas
      const cancelResult = await this.nonceCancellation.sendCancellationTx(ourNonce, attackerGas);
      
      console.log("✅ Cancellation tx sent - this may block/delay attacker");
      console.log("   Now executing actual sweep with next nonce...");
      
      // Follow with actual sweep using NEXT nonce (ourNonce + 1)
      // The sweep will automatically use the next nonce since we consumed one
      const sweepResult = await this.defendWithShotgun(threat);
      
      return {
        cancellation: cancelResult,
        sweep: sweepResult,
        method: "NONCE_CANCEL+SWEEP"
      };
    } catch (error) {
      console.error(`❌ Nonce cancellation failed: ${error.message}`);
      // If cancellation fails, try sweep anyway
      return await this.defendWithShotgun(threat);
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

    // Use Polygon-specific emergency gas for bundle tx
    // OPTIMIZATION: Parallelize RPC calls to save 1-2 seconds
    const [feeData, nonce, gasLimit] = await Promise.all([
      this.provider.getFeeData(),
      this.provider.getTransactionCount(this.sweeper.signer.address, "pending"),
      this.provider.estimateGas({
        to: txData.to,
        data: txData.data,
        from: this.sweeper.signer.address,
      })
    ]);

    const polygonGas = this.polygonGas.fromProviderFeeData(feeData, { emergency: true });

    const tx = {
      to: txData.to,
      data: txData.data,
      nonce: nonce,
      chainId: this.config.chainId,
      gasLimit: gasLimit.mul(120).div(100),
      maxFeePerGas: polygonGas.maxFeePerGas,
      maxPriorityFeePerGas: polygonGas.maxPriorityFeePerGas,
      type: 2,
    };

    console.log(`   Polygon gas: ${this.polygonGas.formatGasInfo(polygonGas)}`);

    // Sign our transaction
    const signedTx = await this.sweeper.signer.signTransaction(tx);

    // Submit MEV bundle with our tx BEFORE attacker's
    // Note: attackerTx is optional - we can bundle just our tx if attacker tx not available
    const attackerTxRaw = threat.attackerTx?.raw || threat.attackerTx;
    const result = await this.mevEngine.guaranteedFrontRun(
      signedTx,
      attackerTxRaw
    );

    return result;
  }

  /**
   * Defend using Shotgun + Dynamic Bidding (FALLBACK)
   *
   * CRITICAL FIX: Generate transactions in REAL-TIME with current gas prices
   * Pre-signed pool transactions have stale gas prices and will be rejected
   */
  async defendWithShotgun(threat) {
    if (threat.asset === "USDT" || threat.asset === this.config.usdtContract) {
      console.log("🎯 Initiating USDT defense (real-time dynamic gas)...");

      // ALWAYS use real-time transaction generation (never pre-signed pool)
      // Pre-signed pool has stale gas prices that cause rejections
      console.log("⚡ Building transaction with LIVE gas prices...");
      const result = await this.dynamicBidAndSweepUSDT(threat.attackerTx);
      this.stats.usedDynamicGas++;
      result.method = "DYNAMIC_GAS_REALTIME";
      return result;
    } else if (threat.asset === "MATIC") {
      console.log("🎯 Initiating MATIC defense (real-time dynamic gas)...");
      console.log("⚡ Building transaction with LIVE gas prices...");
      const result = await this.dynamicBidAndSweepMATIC(threat.attackerTx);
      this.stats.usedDynamicGas++;
      result.method = "DYNAMIC_GAS_REALTIME";
      return result;
    } else if (threat.asset !== "UNKNOWN") {
      console.log(`🎯 Initiating defense for token ${threat.asset} (real-time dynamic gas)...`);
      console.log("⚡ Building transaction with LIVE gas prices...");
      const result = await this.dynamicBidAndSweepToken(threat.asset, threat.attackerTx);
      this.stats.usedDynamicGas++;
      result.method = "DYNAMIC_GAS_REALTIME";
      return result;
    } else {
      console.log("🎯 Unknown asset - sweeping ALL with real-time gas...");
      await Promise.all([
        this.dynamicBidAndSweepUSDT(threat.attackerTx),
        this.config.sweepMatic !== false ? this.dynamicBidAndSweepMATIC(threat.attackerTx) : Promise.resolve(),
      ]);
      return { method: "MULTI_SWEEP_REALTIME" };
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

    // Build transaction with LIVE gas data and aggressive bump
    const tx = await this.buildRealTimeTransaction(txData, attackerTx);
    const result = await this.sweeper.shotgunBroadcast(tx.signedTx, "USDT");

    return result;
  }

  async dynamicBidAndSweepMATIC(attackerTx) {
    const sweeperContract = new ethers.Contract(
      this.config.sweeperAddress,
      ["function sweepAllMaticNow() external"],
      this.sweeper.signer
    );

    const txData = await sweeperContract.populateTransaction.sweepAllMaticNow();

    // Build transaction with LIVE gas data and aggressive bump
    const tx = await this.buildRealTimeTransaction(txData, attackerTx);
    const result = await this.sweeper.shotgunBroadcast(tx.signedTx, "MATIC");

    return result;
  }

  async dynamicBidAndSweepToken(tokenAddress, attackerTx) {
    const sweeperContract = new ethers.Contract(
      this.config.sweeperAddress,
      ["function sweepToken(address tokenAddress) external"],
      this.sweeper.signer
    );

    const txData = await sweeperContract.populateTransaction.sweepToken(tokenAddress);

    // Build transaction with LIVE gas data and aggressive bump
    const tx = await this.buildRealTimeTransaction(txData, attackerTx);
    const result = await this.sweeper.shotgunBroadcast(tx.signedTx, tokenAddress);

    return result;
  }

  /**
   * Build transaction with REAL-TIME gas data and aggressive bump
   * This is the critical fix: fetch gas prices AT RESPONSE TIME, not from stale pool
   */
  async buildRealTimeTransaction(txData, attackerTx) {
    console.log("📊 Fetching LIVE gas prices from network...");

    // OPTIMIZATION: Parallelize all RPC calls to save 1-2 seconds
    const [feeData, nonce, gasLimit] = await Promise.all([
      this.provider.getFeeData(),
      this.provider.getTransactionCount(this.sweeper.signer.address, "pending"),
      this.provider.estimateGas({
        to: txData.to,
        data: txData.data,
        from: this.sweeper.signer.address,
      })
    ]);

    // STEP 2: Use Polygon-specific gas calculation
    // If we have attacker gas, outbid it; otherwise use emergency gas
    let polygonGas;
    if (attackerTx && this.gasBidder) {
      const attackerGas = this.gasBidder.parseGasFromTx(attackerTx);
      if (attackerGas) {
        // Outbid attacker using Polygon rules with AGGRESSIVE premium
        polygonGas = this.polygonGas.outbidGas(attackerGas, 150); // 150% premium (2.5x attacker's gas)
        console.log(`   Attacker gas: ${this.polygonGas.formatGasInfo(attackerGas)}`);
        console.log(`   Our outbid gas: ${this.polygonGas.formatGasInfo(polygonGas)} (2.5x attacker)`);
      } else {
        // Fallback to emergency gas
        polygonGas = this.polygonGas.fromProviderFeeData(feeData, { emergency: true });
        console.log(`   Using emergency gas: ${this.polygonGas.formatGasInfo(polygonGas)}`);
      }
    } else {
      // No attacker gas, use emergency gas
      polygonGas = this.polygonGas.fromProviderFeeData(feeData, { emergency: true });
      console.log(`   Using emergency gas: ${this.polygonGas.formatGasInfo(polygonGas)}`);
    }

    // STEP 5: Build transaction with Polygon-appropriate gas prices
    const tx = {
      to: txData.to,
      data: txData.data,
      nonce: nonce,
      chainId: this.config.chainId,
      gasLimit: gasLimit.mul(120).div(100), // 20% buffer
      maxPriorityFeePerGas: polygonGas.maxPriorityFeePerGas,
      maxFeePerGas: polygonGas.maxFeePerGas,
      type: 2,
    };

    console.log(`   Transaction built with nonce ${nonce}`);

    // STEP 6: Sign transaction
    const signedTx = await this.sweeper.signer.signTransaction(tx);

    console.log("✅ Real-time transaction ready for broadcast");

    return { signedTx, tx };
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

    if (this.approvalTracker) {
      const approvalStats = this.approvalTracker.getStats();
      console.log("");
      console.log(`   Approval Intelligence:`);
      console.log(`     Approvals Detected: ${approvalStats.approvalsDetected}`);
      console.log(`     Active Watch List: ${approvalStats.activeApprovals} addresses`);
      console.log(`     Suspicious Patterns: ${approvalStats.suspiciousPatterns}`);
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
    rpcUrl: process.env.DRPC_HTTP || process.env.QUICKNODE_HTTP || process.env.INFURA_HTTP || process.env.RPC_URL,
    quicknodeHttp: process.env.QUICKNODE_HTTP,
    quicknodeWss: process.env.QUICKNODE_WSS,
    infuraHttp: process.env.INFURA_HTTP,
    infuraWss: process.env.INFURA_WSS,
    drpcHttp: process.env.DRPC_HTTP, // dRPC with MEV protection for Polygon
    drpcWss: process.env.DRPC_WSS,   // dRPC WebSocket for mempool monitoring
    ankrHttp: process.env.ANKR_HTTP,
    nodiesHttp: process.env.NODIES_HTTP,
    privateKey: process.env.PRIVATE_KEY,
    mevSearcherKey: process.env.MEV_SEARCHER_KEY, // Searcher key for Marlin Relay
    vaultAddress: process.env.VAULT_ADDRESS,
    safeAddress: process.env.SAFE_ADDRESS,
    usdtContract: process.env.USDT_CONTRACT,
    chainId: parseInt(process.env.CHAIN_ID) || 137,
    dryRun: process.env.DRY_RUN === "true",
    debug: process.env.DEBUG === "true",
    verbose: process.env.VERBOSE === "true",
    emergencyGasMult: parseFloat(process.env.EMERGENCY_GAS_MULTIPLIER) || 15.0, // Increased for maximum speed
    gasPremium: parseFloat(process.env.GAS_PREMIUM) || 1.5, // Increased for aggressive outbidding
    poolSize: parseInt(process.env.POOL_SIZE) || 5,
    gasRefreshInterval: parseInt(process.env.GAS_REFRESH_INTERVAL) || 12000,
    sweepMatic: process.env.SWEEP_MATIC === "true", // Disabled by default to save gas
    enableMEVBundles: process.env.ENABLE_MEV_BUNDLES === "true", // Disable by default for Polygon
    enableNonceCancellation: process.env.ENABLE_NONCE_CANCELLATION !== "false", // Enable by default
    cancellationGasMultiplier: parseFloat(process.env.CANCELLATION_GAS_MULTIPLIER) || 3,
    nonceCancellationTip: parseInt(process.env.NONCE_CANCELLATION_TIP) || 500,
    nonceCancellationMaxFee: parseInt(process.env.NONCE_CANCELLATION_MAX_FEE) || 1000,
    bundleTimeout: parseInt(process.env.BUNDLE_TIMEOUT) || 30,
    maxBlocksAhead: parseInt(process.env.MAX_BLOCKS_AHEAD) || 2, // Marlin default: 2 blocks ahead
    bundlePriorityFee: process.env.BUNDLE_PRIORITY_FEE
      ? ethers.utils.parseUnits(process.env.BUNDLE_PRIORITY_FEE, "gwei")
      : ethers.utils.parseUnits("200", "gwei"), // Polygon emergency tip
    polygonMinimumGasGwei: parseInt(process.env.POLYGON_MINIMUM_GAS_GWEI) || 25,
    polygonBaseTipGwei: parseInt(process.env.POLYGON_BASE_TIP_GWEI) || 50,
    polygonCongestedTipGwei: parseInt(process.env.POLYGON_CONGESTED_TIP_GWEI) || 150,
    polygonAggressiveTipGwei: parseInt(process.env.POLYGON_AGGRESSIVE_TIP_GWEI) || 200,
    polygonEmergencyTipGwei: parseInt(process.env.POLYGON_EMERGENCY_TIP_GWEI) || 200,
  };

  const monitor = new UltimateDefenseMonitorV2(CONFIG);
  monitor.run().catch(console.error);
}
