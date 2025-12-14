const { ethers } = require("ethers");
const TxPoolMonitor = require("./txpool_monitor");
const { DynamicGasBidder } = require("./dynamic_gas_bidder");
const { MarlinRelay } = require("./marlin_relay");

/**
 * EOA Wallet Bot - High-Speed Approval Revocation System
 *
 * Monitors mempool for transferFrom() calls targeting the EOA wallet
 * and immediately sends approval revocation transactions with premium gas.
 *
 * Architecture:
 * - Async mempool monitoring (WebSocket + TxPool scanning)
 * - Instant transferFrom detection
 * - Automatic approval revocation
 * - Dynamic gas bidding (150% premium by default)
 * - Multi-RPC shotgun broadcasting
 */
class EOAWalletBot {
  constructor(config) {
    this.config = {
      walletAddress: config.walletAddress,
      privateKey: config.privateKey,
      rpcUrl: config.rpcUrl,
      backupRpcUrls: config.backupRpcUrls || [],
      chainId: config.chainId || 137, // Polygon by default
      gasPremium: config.gasPremium || 0.5, // 50% premium
      maxGasPrice: config.maxGasPrice || ethers.utils.parseUnits("1000", "gwei"),
      monitoringInterval: config.monitoringInterval || 500, // 500ms for txpool scan
      enableTxPoolMonitoring: config.enableTxPoolMonitoring !== false, // Default true
      enableWebSocketMonitoring: config.enableWebSocketMonitoring !== false, // Default true
      // MEV Bundle settings
      enableMEVBundles: config.enableMEVBundles !== false, // Default true
      searcherPrivateKey: config.searcherPrivateKey,
      bundleTimeout: config.bundleTimeout || 30,
      maxBlocksAhead: config.maxBlocksAhead || 3,
      bundlePriorityFee: config.bundlePriorityFee || ethers.utils.parseUnits("50", "gwei"),
      ...config,
    };

    // Initialize providers
    this.provider = new ethers.providers.JsonRpcProvider(this.config.rpcUrl);
    this.wsProvider = null;

    // Initialize wallet (EOA)
    this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);

    // Backup providers for shotgun broadcasting
    this.backupProviders = this.config.backupRpcUrls.map(
      (url) => new ethers.providers.JsonRpcProvider(url)
    );

    // Initialize gas bidder
    this.gasBidder = new DynamicGasBidder({
      provider: this.provider,
      gasPremium: this.config.gasPremium,
      maxGasPrice: this.config.maxGasPrice,
      chainId: this.config.chainId,
    });

    // Initialize txpool monitor (if enabled)
    this.txPoolMonitor = null;
    if (this.config.enableTxPoolMonitoring) {
      this.txPoolMonitor = new TxPoolMonitor({
        provider: this.provider,
        scanInterval: this.config.monitoringInterval,
      });
    }

    // Initialize Marlin Relay for MEV bundles (if enabled)
    this.marlinRelay = null;
    this.mevBundlesAvailable = false;
    if (this.config.enableMEVBundles && this.config.searcherPrivateKey) {
      this.marlinRelay = new MarlinRelay(this.config);
      // Will initialize in start() method
    }

    // ERC20 approve function signature: approve(address spender, uint256 amount)
    this.ERC20_ABI = [
      "function approve(address spender, uint256 amount) returns (bool)",
      "event Approval(address indexed owner, address indexed spender, uint256 value)",
    ];

    // Statistics
    this.stats = {
      threatsDetected: 0,
      revocationsSent: 0,
      revocationsConfirmed: 0,
      revocationsFailed: 0,
      mevBundlesSent: 0,
      mevBundlesSucceeded: 0,
      shotgunSent: 0,
      shotgunSucceeded: 0,
      avgResponseTime: 0,
      startTime: Date.now(),
    };

    // Active monitoring flag
    this.isMonitoring = false;

    console.log(`\n🤖 EOA Wallet Bot initialized`);
    console.log(`   Wallet: ${this.wallet.address}`);
    console.log(`   Chain ID: ${this.config.chainId}`);
    console.log(`   Gas Premium: ${this.config.gasPremium * 100}%`);
  }

  /**
   * Start monitoring the mempool
   */
  async start() {
    if (this.isMonitoring) {
      console.log("⚠️  Bot is already monitoring");
      return;
    }

    console.log("\n🚀 Starting EOA Wallet Bot...");

    // Verify wallet address matches
    if (this.wallet.address.toLowerCase() !== this.config.walletAddress.toLowerCase()) {
      throw new Error(
        `Wallet address mismatch! Expected ${this.config.walletAddress}, got ${this.wallet.address}`
      );
    }

    this.isMonitoring = true;

    // Initialize Marlin Relay for MEV bundles
    if (this.marlinRelay) {
      try {
        await this.marlinRelay.initialize(this.config.searcherPrivateKey);
        this.mevBundlesAvailable = true;
        console.log("🎯 MEV Bundles (Marlin Relay): ENABLED");
        console.log(`   Priority Fee: ${ethers.utils.formatUnits(this.config.bundlePriorityFee, "gwei")} gwei`);
      } catch (error) {
        console.error("⚠️  Failed to initialize Marlin Relay:", error.message);
        console.log("   Continuing with shotgun mode only");
      }
    } else {
      console.log("⚠️  MEV Bundles: DISABLED (using shotgun mode)");
    }

    // Start WebSocket monitoring
    if (this.config.enableWebSocketMonitoring) {
      await this.startWebSocketMonitoring();
    }

    // Start TxPool monitoring
    if (this.txPoolMonitor) {
      await this.startTxPoolMonitoring();
    }

    console.log("\n✅ EOA Wallet Bot is now monitoring mempool");
    console.log(`   Watching for transferFrom() calls to: ${this.config.walletAddress}`);
    console.log(`   Ready to revoke approvals instantly\n`);

    // Print stats every 30 seconds
    this.statsInterval = setInterval(() => this.printStats(), 30000);
  }

  /**
   * Start WebSocket monitoring for pending transactions
   */
  async startWebSocketMonitoring() {
    try {
      // Try to create WebSocket provider
      const wsUrl = this.config.wsRpcUrl || this.config.rpcUrl.replace("https://", "wss://");
      this.wsProvider = new ethers.providers.WebSocketProvider(wsUrl);

      console.log("📡 WebSocket monitoring started");

      // Monitor pending transactions
      this.wsProvider.on("pending", async (txHash) => {
        try {
          // Fetch transaction with 2-second timeout
          const tx = await Promise.race([
            this.wsProvider.getTransaction(txHash),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Timeout")), 2000)
            ),
          ]).catch(() => null);

          if (!tx) return;

          // Check for threat
          await this.checkAndRespondToThreat(tx);
        } catch (error) {
          // Silent fail for individual transactions
        }
      });

      // Handle WebSocket errors and reconnection
      this.wsProvider._websocket.on("error", (error) => {
        console.error("❌ WebSocket error:", error.message);
      });

      this.wsProvider._websocket.on("close", () => {
        console.log("🔌 WebSocket disconnected, attempting to reconnect...");
        setTimeout(() => {
          if (this.isMonitoring) {
            this.startWebSocketMonitoring();
          }
        }, 5000);
      });
    } catch (error) {
      console.error("❌ Failed to start WebSocket monitoring:", error.message);
      console.log("   Continuing with TxPool monitoring only");
    }
  }

  /**
   * Start TxPool monitoring (premium tier scanning)
   */
  async startTxPoolMonitoring() {
    console.log("🔍 TxPool monitoring started");

    await this.txPoolMonitor.startMonitoring(async (tx) => {
      await this.checkAndRespondToThreat(tx);
    });
  }

  /**
   * Check if transaction is a transferFrom threat and respond
   */
  async checkAndRespondToThreat(tx) {
    const threat = this.detectTransferFromThreat(tx);

    if (threat) {
      this.stats.threatsDetected++;
      console.log(`\n🚨 THREAT DETECTED! transferFrom() targeting wallet`);
      console.log(`   Token: ${threat.tokenAddress}`);
      console.log(`   Attacker Tx: ${tx.hash}`);
      console.log(`   Attacker: ${tx.from}`);

      // Respond immediately
      await this.revokeApproval(threat);
    }
  }

  /**
   * Detect transferFrom() calls targeting our wallet
   *
   * @param {Object} tx - Transaction object from mempool
   * @returns {Object|null} - Threat object or null
   */
  detectTransferFromThreat(tx) {
    if (!tx.data || tx.data.length < 138) {
      return null;
    }

    // Check for transferFrom function signature: 0x23b872dd
    const functionSig = tx.data.slice(0, 10);
    if (functionSig !== "0x23b872dd") {
      return null;
    }

    try {
      // Parse transferFrom parameters
      // transferFrom(address from, address to, uint256 amount)
      // Data layout: 0x[8 char sig][64 char from][64 char to][64 char amount]
      const fromAddress = ethers.utils.getAddress("0x" + tx.data.slice(34, 74));
      const toAddress = ethers.utils.getAddress("0x" + tx.data.slice(98, 138));

      // Check if 'from' is our wallet (someone trying to steal from us)
      if (fromAddress.toLowerCase() === this.config.walletAddress.toLowerCase()) {
        return {
          isThreat: true,
          type: "TRANSFERFROM_ATTACK",
          tokenAddress: tx.to, // The contract being called is the token
          fromAddress: fromAddress,
          toAddress: toAddress,
          attackerTx: tx,
          attackerAddress: tx.from,
          detectedAt: Date.now(),
        };
      }
    } catch (error) {
      // Malformed data, skip
      return null;
    }

    return null;
  }

  /**
   * Revoke approval using MEV bundle (guaranteed ordering)
   * Bundle contains: [our revocation tx, attacker's tx]
   * Our tx executes FIRST, then attacker's fails
   */
  async revokeWithMEVBundle(threat, signedRevocationTx) {
    console.log(`\n🎯 USING MEV BUNDLE (Marlin Relay)`);

    try {
      // Get current block
      const currentBlock = await this.provider.getBlockNumber();
      const targetBlock = currentBlock + 1;

      console.log(`   Current block: ${currentBlock}`);
      console.log(`   Target block: ${targetBlock}`);

      // Build bundle: our revocation first, attacker's tx second
      const bundleTxs = [signedRevocationTx];

      // Add attacker's tx if we have it
      if (threat.attackerTx && threat.attackerTx.raw) {
        bundleTxs.push(threat.attackerTx.raw);
      }

      console.log(`   Bundle size: ${bundleTxs.length} transactions`);

      // Submit bundle to Marlin Relay
      const result = await this.marlinRelay.sendBundle(bundleTxs, targetBlock);

      this.stats.mevBundlesSent++;

      if (result.success) {
        console.log(`   ✅ Bundle submitted successfully`);
        console.log(`   Bundle hash: ${result.bundleHash}`);
        this.stats.mevBundlesSucceeded++;
        return {
          success: true,
          method: "MEV_BUNDLE",
          bundleHash: result.bundleHash,
          hash: ethers.utils.keccak256(signedRevocationTx),
        };
      } else {
        throw new Error("Bundle submission failed");
      }
    } catch (error) {
      console.error(`   ❌ MEV bundle failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Revoke approval for the token contract
   * Sends approve(spender, 0) to revoke the approval
   */
  async revokeApproval(threat) {
    const startTime = Date.now();

    try {
      console.log(`\n⚡ REVOKING APPROVAL...`);

      const tokenAddress = threat.tokenAddress;
      const spenderAddress = threat.attackerAddress;

      // Create token contract interface
      const tokenContract = new ethers.Contract(
        tokenAddress,
        this.ERC20_ABI,
        this.wallet
      );

      // Build revoke approval transaction: approve(spender, 0)
      const txData = await tokenContract.populateTransaction.approve(
        spenderAddress,
        0 // Set allowance to 0 to revoke
      );

      // Get current nonce
      const nonce = await this.provider.getTransactionCount(
        this.wallet.address,
        "pending"
      );

      // Calculate gas with premium to outbid attacker
      const attackerGas = this.gasBidder.parseGasFromTx(threat.attackerTx);
      const outbidGas = this.gasBidder.calculateOutbidGas(attackerGas);

      // Estimate gas limit
      let gasLimit;
      try {
        gasLimit = await this.provider.estimateGas({
          from: this.wallet.address,
          to: tokenAddress,
          data: txData.data,
        });
        // Add 50% buffer for safety
        gasLimit = gasLimit.mul(150).div(100);
      } catch (error) {
        // If estimation fails, use safe default (100k gas for approve)
        gasLimit = ethers.BigNumber.from(100000);
        console.log(`   ⚠️  Gas estimation failed, using default: ${gasLimit.toString()}`);
      }

      // Build transaction
      const tx = {
        to: tokenAddress,
        data: txData.data,
        nonce: nonce,
        chainId: this.config.chainId,
        gasLimit: gasLimit,
        type: 2, // EIP-1559
        maxFeePerGas: outbidGas.maxFeePerGas,
        maxPriorityFeePerGas: outbidGas.maxPriorityFeePerGas,
      };

      console.log(`   Gas Config:`);
      console.log(`     maxFeePerGas: ${ethers.utils.formatUnits(tx.maxFeePerGas, "gwei")} gwei`);
      console.log(`     maxPriorityFeePerGas: ${ethers.utils.formatUnits(tx.maxPriorityFeePerGas, "gwei")} gwei`);
      console.log(`     gasLimit: ${gasLimit.toString()}`);

      // Sign transaction
      const signedTx = await this.wallet.signTransaction(tx);
      const txHash = ethers.utils.keccak256(signedTx);

      console.log(`   Signed Tx Hash: ${txHash}`);

      let result;
      let method;

      // Try MEV bundle first (guaranteed ordering)
      if (this.mevBundlesAvailable) {
        try {
          result = await this.revokeWithMEVBundle(threat, signedTx);
          method = "MEV_BUNDLE";
        } catch (error) {
          console.log(`   ⚠️  MEV bundle failed, falling back to shotgun...`);
          // Fall through to shotgun
        }
      }

      // Fallback to shotgun if MEV bundles disabled or failed
      if (!result) {
        console.log(`   Broadcasting via shotgun...`);
        result = await this.shotgunBroadcast(signedTx);
        method = "SHOTGUN";
        this.stats.shotgunSent++;
        this.stats.shotgunSucceeded++;
      }

      const responseTime = Date.now() - startTime;
      this.stats.revocationsSent++;

      // Update average response time
      this.stats.avgResponseTime =
        (this.stats.avgResponseTime * (this.stats.revocationsSent - 1) + responseTime) /
        this.stats.revocationsSent;

      console.log(`\n✅ APPROVAL REVOCATION SENT!`);
      console.log(`   Method: ${method}`);
      console.log(`   Response Time: ${responseTime}ms`);
      console.log(`   Tx Hash: ${result.hash}`);
      if (method === "SHOTGUN") {
        console.log(`   Fastest RPC: ${result.source || 'Primary'}`);
      } else if (method === "MEV_BUNDLE") {
        console.log(`   Bundle Hash: ${result.bundleHash}`);
      }

      // Wait for confirmation (async, don't block)
      this.waitForConfirmation(result.hash).then((confirmed) => {
        if (confirmed) {
          this.stats.revocationsConfirmed++;
          console.log(`\n🎉 APPROVAL REVOKED! Transaction confirmed.`);
        } else {
          this.stats.revocationsFailed++;
          console.log(`\n❌ Transaction failed or timed out`);
        }
      });

      return result;
    } catch (error) {
      this.stats.revocationsFailed++;
      console.error(`\n❌ Failed to revoke approval:`, error.message);
      throw error;
    }
  }

  /**
   * Shotgun broadcast - send transaction through all RPCs simultaneously
   */
  async shotgunBroadcast(signedTx) {
    const startTime = Date.now();
    const broadcastPromises = [];

    // Primary RPC
    const primaryPromise = this.provider
      .sendTransaction(signedTx)
      .then((result) => {
        console.log(`     ✅ Primary RPC SUCCESS (${Date.now() - startTime}ms)`);
        return { source: "Primary RPC", result, time: Date.now() - startTime };
      })
      .catch((err) => {
        console.log(`     ❌ Primary RPC failed: ${err.message}`);
        return null;
      });

    broadcastPromises.push(primaryPromise);

    // Backup RPCs
    const backupPromises = this.backupProviders.map((provider, i) =>
      provider
        .sendTransaction(signedTx)
        .then((result) => {
          console.log(`     ✅ Backup RPC ${i + 1} SUCCESS (${Date.now() - startTime}ms)`);
          return { source: `Backup RPC ${i + 1}`, result, time: Date.now() - startTime };
        })
        .catch((err) => {
          console.log(`     ❌ Backup RPC ${i + 1} failed: ${err.message}`);
          return null;
        })
    );

    broadcastPromises.push(...backupPromises);

    // Wait for all to complete
    const results = await Promise.all(broadcastPromises);
    const successResults = results.filter((r) => r !== null);

    if (successResults.length === 0) {
      throw new Error("All shotgun paths failed!");
    }

    // Return the fastest successful submission
    const fastest = successResults.sort((a, b) => a.time - b.time)[0];
    return fastest.result;
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForConfirmation(txHash, timeout = 30000) {
    try {
      const receipt = await Promise.race([
        this.provider.waitForTransaction(txHash, 1),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Confirmation timeout")), timeout)
        ),
      ]);

      return receipt && receipt.status === 1;
    } catch (error) {
      console.error(`   ⚠️  Confirmation error: ${error.message}`);
      return false;
    }
  }

  /**
   * Print statistics
   */
  printStats() {
    const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
    console.log(`\n📊 Bot Statistics (Uptime: ${uptime}s)`);
    console.log(`   Threats Detected: ${this.stats.threatsDetected}`);
    console.log(`   Revocations Sent: ${this.stats.revocationsSent}`);
    console.log(`   Revocations Confirmed: ${this.stats.revocationsConfirmed}`);
    console.log(`   Revocations Failed: ${this.stats.revocationsFailed}`);
    if (this.mevBundlesAvailable) {
      console.log(`   MEV Bundles: ${this.stats.mevBundlesSent} sent, ${this.stats.mevBundlesSucceeded} succeeded`);
      console.log(`   Shotgun: ${this.stats.shotgunSent} sent, ${this.stats.shotgunSucceeded} succeeded`);
    }
    console.log(`   Avg Response Time: ${Math.round(this.stats.avgResponseTime)}ms`);
  }

  /**
   * Stop monitoring
   */
  async stop() {
    console.log("\n🛑 Stopping EOA Wallet Bot...");
    this.isMonitoring = false;

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    if (this.txPoolMonitor) {
      await this.txPoolMonitor.stopMonitoring();
    }

    if (this.wsProvider) {
      await this.wsProvider.removeAllListeners();
      await this.wsProvider.destroy();
    }

    console.log("✅ Bot stopped");
    this.printStats();
  }
}

module.exports = EOAWalletBot;
