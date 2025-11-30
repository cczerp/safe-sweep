const { ethers } = require("ethers");

/**
 * Pre-Signed Transaction Pool
 *
 * Keeps a pool of pre-signed sweep transactions ready for instant broadcast.
 * This eliminates construction + signing time, reducing reaction from ~800ms to ~50ms.
 */
class PreSignedTxPool {
  constructor(config) {
    this.config = config;
    this.provider = null;
    this.signer = null;
    this.sweeperContract = null;

    // Pre-signed transaction pools for different assets
    this.pools = {
      usdt: [],
      matic: [],
      generic: new Map(), // tokenAddress => array of pre-signed txs
    };

    // Pool configuration
    this.poolSize = config.poolSize || 5; // Keep 5 pre-signed txs ready
    this.currentNonce = null;
    this.baseNonce = null;

    // Gas refresh settings
    this.gasRefreshInterval = config.gasRefreshInterval || 12000; // Refresh every 12s (1 block)
    this.lastGasRefresh = 0;

    // Sweeper ABI
    this.SWEEPER_ABI = [
      "function sweepToken(address tokenAddress) external",
      "function sweepMatic() external",
      "function sweepAllMaticNow() external",
    ];

    console.log("🎯 Pre-Signed Transaction Pool initialized");
    console.log(`   - Pool size: ${this.poolSize} transactions per asset`);
    console.log(`   - Gas refresh: every ${this.gasRefreshInterval}ms`);
  }

  async initialize(provider, privateKey, sweeperAddress) {
    this.provider = provider;
    this.signer = new ethers.Wallet(privateKey, provider);
    this.sweeperContract = new ethers.Contract(
      sweeperAddress,
      this.SWEEPER_ABI,
      this.signer
    );

    console.log("🔧 Initializing pre-signed pool...");
    console.log(`   - Signer: ${this.signer.address}`);
    console.log(`   - Sweeper: ${sweeperAddress}`);

    // Get current nonce
    this.currentNonce = await this.provider.getTransactionCount(
      this.signer.address,
      "pending"
    );
    this.baseNonce = this.currentNonce;

    console.log(`   - Base nonce: ${this.baseNonce}`);

    // Generate initial pools (skip if no tokens present)
    try {
      await this.generateUSDTPool();
    } catch (error) {
      if (error.message.includes("No tokens to sweep")) {
        console.log("   ℹ️ No USDT in Safe yet - pool will generate when tokens detected");
      } else {
        console.warn(`   ⚠️ Could not generate USDT pool: ${error.message}`);
      }
    }

    try {
      await this.generateMATICPool();
    } catch (error) {
      if (error.message.includes("No tokens to sweep") || error.message.includes("No MATIC")) {
        console.log("   ℹ️ No MATIC in Safe yet - pool will generate when tokens detected");
      } else {
        console.warn(`   ⚠️ Could not generate MATIC pool: ${error.message}`);
      }
    }

    console.log("✅ Pre-signed pool initialized (ready when tokens are present)");

    // Start gas refresh timer
    this.startGasRefreshTimer();
  }

  /**
   * Get current gas prices with emergency multiplier
   */
  async getEmergencyGas() {
    const feeData = await this.provider.getFeeData();
    const multiplier = this.config.emergencyGasMult || 3.5;

    if (feeData.maxFeePerGas) {
      // EIP-1559
      return {
        maxFeePerGas: feeData.maxFeePerGas.mul(Math.floor(multiplier * 100)).div(100),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas.mul(Math.floor(multiplier * 100)).div(100),
        type: 2,
      };
    } else {
      // Legacy
      return {
        gasPrice: feeData.gasPrice.mul(Math.floor(multiplier * 100)).div(100),
        type: 0,
      };
    }
  }

  /**
   * Generate pool of pre-signed USDT sweep transactions
   */
  async generateUSDTPool() {
    console.log("🔄 Generating USDT pre-signed pool...");

    const usdtAddress = this.config.usdtContract;
    if (!usdtAddress) {
      console.warn("⚠️ No USDT contract configured, skipping USDT pool");
      return;
    }

    this.pools.usdt = [];

    // Prepare transaction data (this never changes)
    const txData = await this.sweeperContract.populateTransaction.sweepToken(usdtAddress);

    // Get current gas prices
    const gas = await this.getEmergencyGas();

    // Estimate gas limit once
    const gasLimit = await this.provider.estimateGas({
      to: txData.to,
      data: txData.data,
      from: this.signer.address,
    });

    // Generate pool with sequential nonces
    for (let i = 0; i < this.poolSize; i++) {
      const nonce = this.baseNonce + i;

      const tx = {
        to: txData.to,
        data: txData.data,
        nonce: nonce,
        chainId: this.config.chainId,
        gasLimit: gasLimit.mul(120).div(100), // 20% buffer
        ...gas,
      };

      // Sign the transaction
      const signedTx = await this.signer.signTransaction(tx);

      this.pools.usdt.push({
        nonce: nonce,
        signedTx: signedTx,
        txHash: ethers.utils.keccak256(signedTx),
        used: false,
        timestamp: Date.now(),
      });

      console.log(`   ✅ USDT tx ${i + 1}/${this.poolSize} pre-signed (nonce: ${nonce})`);
    }

    this.lastGasRefresh = Date.now();
    console.log(`✅ USDT pool ready: ${this.pools.usdt.length} transactions`);
  }

  /**
   * Generate pool of pre-signed MATIC sweep transactions
   */
  async generateMATICPool() {
    console.log("🔄 Generating MATIC pre-signed pool...");

    this.pools.matic = [];

    // Prepare transaction data
    const txData = await this.sweeperContract.populateTransaction.sweepAllMaticNow();

    // Get current gas prices
    const gas = await this.getEmergencyGas();

    // Estimate gas limit
    const gasLimit = await this.provider.estimateGas({
      to: txData.to,
      data: txData.data,
      from: this.signer.address,
    });

    // Generate pool with sequential nonces
    for (let i = 0; i < this.poolSize; i++) {
      const nonce = this.baseNonce + i;

      const tx = {
        to: txData.to,
        data: txData.data,
        nonce: nonce,
        chainId: this.config.chainId,
        gasLimit: gasLimit.mul(120).div(100),
        ...gas,
      };

      const signedTx = await this.signer.signTransaction(tx);

      this.pools.matic.push({
        nonce: nonce,
        signedTx: signedTx,
        txHash: ethers.utils.keccak256(signedTx),
        used: false,
        timestamp: Date.now(),
      });

      console.log(`   ✅ MATIC tx ${i + 1}/${this.poolSize} pre-signed (nonce: ${nonce})`);
    }

    this.lastGasRefresh = Date.now();
    console.log(`✅ MATIC pool ready: ${this.pools.matic.length} transactions`);
  }

  /**
   * Generate pool for a specific token address
   */
  async generateTokenPool(tokenAddress) {
    console.log(`🔄 Generating pre-signed pool for token ${tokenAddress}...`);

    const pool = [];

    // Prepare transaction data
    const txData = await this.sweeperContract.populateTransaction.sweepToken(tokenAddress);

    // Get current gas prices
    const gas = await this.getEmergencyGas();

    // Estimate gas limit
    const gasLimit = await this.provider.estimateGas({
      to: txData.to,
      data: txData.data,
      from: this.signer.address,
    });

    // Generate pool
    for (let i = 0; i < this.poolSize; i++) {
      const nonce = this.baseNonce + i;

      const tx = {
        to: txData.to,
        data: txData.data,
        nonce: nonce,
        chainId: this.config.chainId,
        gasLimit: gasLimit.mul(120).div(100),
        ...gas,
      };

      const signedTx = await this.signer.signTransaction(tx);

      pool.push({
        nonce: nonce,
        signedTx: signedTx,
        txHash: ethers.utils.keccak256(signedTx),
        used: false,
        timestamp: Date.now(),
      });
    }

    this.pools.generic.set(tokenAddress.toLowerCase(), pool);
    console.log(`✅ Token ${tokenAddress} pool ready: ${pool.length} transactions`);
  }

  /**
   * Get the next available pre-signed transaction for USDT
   * Returns immediately - this is the speed advantage!
   *
   * IMPORTANT: If broadcast fails, call releaseTransaction() to mark it unused
   * so it can be retried with the same nonce.
   */
  getNextUSDTTx() {
    const available = this.pools.usdt.find(tx => !tx.used);

    if (!available) {
      console.warn("⚠️ USDT pool exhausted! Need to regenerate.");
      return null;
    }

    available.used = true;
    console.log(`⚡ Retrieved pre-signed USDT tx (nonce: ${available.nonce})`);

    return available;
  }

  /**
   * Release a transaction back to the pool (mark as unused)
   * Call this when a broadcast fails so the same nonce can be retried
   */
  releaseTransaction(txHash) {
    // Check USDT pool
    const usdtTx = this.pools.usdt.find(tx => tx.txHash === txHash);
    if (usdtTx && usdtTx.used) {
      usdtTx.used = false;
      console.log(`🔄 Released USDT tx back to pool (nonce: ${usdtTx.nonce})`);
      return true;
    }

    // Check MATIC pool
    const maticTx = this.pools.matic.find(tx => tx.txHash === txHash);
    if (maticTx && maticTx.used) {
      maticTx.used = false;
      console.log(`🔄 Released MATIC tx back to pool (nonce: ${maticTx.nonce})`);
      return true;
    }

    // Check generic pools
    for (const [token, pool] of this.pools.generic.entries()) {
      const genericTx = pool.find(tx => tx.txHash === txHash);
      if (genericTx && genericTx.used) {
        genericTx.used = false;
        console.log(`🔄 Released ${token} tx back to pool (nonce: ${genericTx.nonce})`);
        return true;
      }
    }

    return false;
  }

  /**
   * Get the next available pre-signed transaction for MATIC
   */
  getNextMATICTx() {
    const available = this.pools.matic.find(tx => !tx.used);

    if (!available) {
      console.warn("⚠️ MATIC pool exhausted! Need to regenerate.");
      return null;
    }

    available.used = true;
    console.log(`⚡ Retrieved pre-signed MATIC tx (nonce: ${available.nonce})`);

    return available;
  }

  /**
   * Get the next available pre-signed transaction for a specific token
   */
  async getNextTokenTx(tokenAddress) {
    const poolKey = tokenAddress.toLowerCase();

    if (!this.pools.generic.has(poolKey)) {
      console.log(`⚠️ No pool for token ${tokenAddress}, generating now...`);
      await this.generateTokenPool(tokenAddress);
    }

    const pool = this.pools.generic.get(poolKey);
    const available = pool.find(tx => !tx.used);

    if (!available) {
      console.warn(`⚠️ Token ${tokenAddress} pool exhausted! Need to regenerate.`);
      return null;
    }

    available.used = true;
    console.log(`⚡ Retrieved pre-signed token tx (nonce: ${available.nonce})`);

    return available;
  }

  /**
   * Check if pools need regeneration (when nonces are consumed or pool depleted)
   */
  async checkAndRegeneratePools() {
    const currentNonce = await this.provider.getTransactionCount(
      this.signer.address,
      "pending"
    );

    // Calculate pool availability
    const usdtAvailable = this.pools.usdt.filter(tx => !tx.used).length;
    const maticAvailable = this.pools.matic.filter(tx => !tx.used).length;

    // Trigger regeneration if:
    // 1. Nonce has advanced (transactions confirmed)
    // 2. Pool is more than 50% depleted
    const needsRegeneration =
      currentNonce > this.baseNonce ||
      usdtAvailable <= this.poolSize / 2 ||
      maticAvailable <= this.poolSize / 2;

    if (needsRegeneration) {
      if (currentNonce > this.baseNonce) {
        console.log(`🔄 Nonce advanced from ${this.baseNonce} to ${currentNonce}, regenerating pools...`);
      } else {
        console.log(`🔄 Pool depleted (USDT: ${usdtAvailable}/${this.poolSize}, MATIC: ${maticAvailable}/${this.poolSize}), regenerating...`);
      }

      this.baseNonce = currentNonce;

      // Regenerate USDT pool (skip if no tokens)
      try {
        await this.generateUSDTPool();
      } catch (error) {
        if (error.message.includes("No tokens to sweep") || error.message.includes("execution reverted")) {
          console.log("   ℹ️ Skipping USDT pool (no tokens in Safe)");
        } else {
          console.warn(`   ⚠️ Could not regenerate USDT pool: ${error.message.substring(0, 100)}`);
        }
      }

      // Regenerate MATIC pool (skip if no tokens)
      try {
        await this.generateMATICPool();
      } catch (error) {
        if (error.message.includes("No tokens to sweep") || error.message.includes("No MATIC") || error.message.includes("execution reverted")) {
          console.log("   ℹ️ Skipping MATIC pool (no tokens in Safe)");
        } else {
          console.warn(`   ⚠️ Could not regenerate MATIC pool: ${error.message.substring(0, 100)}`);
        }
      }

      // Regenerate all generic token pools
      for (const [tokenAddress, _] of this.pools.generic.entries()) {
        try {
          await this.generateTokenPool(tokenAddress);
        } catch (error) {
          console.warn(`   ⚠️ Could not regenerate pool for ${tokenAddress}: ${error.message.substring(0, 100)}`);
        }
      }
    }
  }

  /**
   * Aggressively check and regenerate pools (called more frequently)
   */
  async aggressivePoolCheck() {
    // Check pool availability without waiting for nonce
    const usdtAvailable = this.pools.usdt.filter(tx => !tx.used).length;
    const maticAvailable = this.pools.matic.filter(tx => !tx.used).length;

    // If pool is critically low (< 2 txs), regenerate immediately
    if (usdtAvailable < 2 || maticAvailable < 2) {
      console.log(`⚠️ CRITICAL: Pool critically low! USDT: ${usdtAvailable}, MATIC: ${maticAvailable}`);
      await this.checkAndRegeneratePools();
    }
  }

  /**
   * Refresh gas prices periodically (every block) and check pool health
   */
  startGasRefreshTimer() {
    // Main refresh timer (every ~12s = 1 block on Polygon)
    setInterval(async () => {
      const now = Date.now();

      if (now - this.lastGasRefresh >= this.gasRefreshInterval) {
        if (this.config.debug) {
          console.log("🔄 Gas prices may have changed, regenerating pools with fresh gas...");
        }

        await this.checkAndRegeneratePools();

        if (this.config.debug) {
          console.log("✅ Pools refreshed with current gas prices");
        }
      }
    }, this.gasRefreshInterval);

    // Aggressive pool health check (every 3 seconds)
    setInterval(async () => {
      await this.aggressivePoolCheck();
    }, 3000);
  }

  /**
   * Get pool statistics
   */
  getPoolStats() {
    const usdtAvailable = this.pools.usdt.filter(tx => !tx.used).length;
    const maticAvailable = this.pools.matic.filter(tx => !tx.used).length;

    const genericStats = {};
    for (const [token, pool] of this.pools.generic.entries()) {
      genericStats[token] = pool.filter(tx => !tx.used).length;
    }

    return {
      usdt: {
        total: this.pools.usdt.length,
        available: usdtAvailable,
      },
      matic: {
        total: this.pools.matic.length,
        available: maticAvailable,
      },
      generic: genericStats,
      baseNonce: this.baseNonce,
    };
  }

  /**
   * Force regeneration of all pools (useful after deployment)
   */
  async forceRegenerate() {
    console.log("🔄 Force regenerating all pools...");

    this.baseNonce = await this.provider.getTransactionCount(
      this.signer.address,
      "pending"
    );

    await this.generateUSDTPool();
    await this.generateMATICPool();

    for (const [tokenAddress, _] of this.pools.generic.entries()) {
      await this.generateTokenPool(tokenAddress);
    }

    console.log("✅ Force regeneration complete");
  }

  /**
   * Force regeneration with specific minimum gas price (from error message)
   * @param {string} requiredTipWei - Required priority fee in wei (as string) from error message
   */
  async forceRegenerateWithGas(requiredTipWei = null) {
    console.log("🔄 Force regenerating pools with required gas...");

    // Get fresh nonce
    this.baseNonce = await this.provider.getTransactionCount(
      this.signer.address,
      "pending"
    );

    // If we have a required tip from error message, override getEmergencyGas
    if (requiredTipWei) {
      const requiredTip = ethers.BigNumber.from(requiredTipWei);
      const safetyMargin = requiredTip.mul(2); // 2x safety margin

      // Temporarily override getEmergencyGas to use required gas
      const originalGetEmergencyGas = this.getEmergencyGas.bind(this);
      this.getEmergencyGas = async () => {
        const feeData = await this.provider.getFeeData();

        // Use whichever is higher: network gas or required gas with safety margin
        const networkTip = feeData.maxPriorityFeePerGas || ethers.BigNumber.from(0);
        const useGas = safetyMargin.gt(networkTip) ? safetyMargin : networkTip;

        if (feeData.maxFeePerGas) {
          // EIP-1559 - use required gas with safety margin
          return {
            maxFeePerGas: useGas.mul(3), // 3x for maxFee (base + tip headroom)
            maxPriorityFeePerGas: useGas,
            type: 2,
          };
        } else {
          // Legacy
          return {
            gasPrice: useGas.mul(2),
            type: 0,
          };
        }
      };

      // Regenerate pools with overridden gas function
      await this.generateUSDTPool();
      await this.generateMATICPool();

      for (const [tokenAddress, _] of this.pools.generic.entries()) {
        await this.generateTokenPool(tokenAddress);
      }

      // Restore original function
      this.getEmergencyGas = originalGetEmergencyGas;
    } else {
      // No required gas specified, use normal regeneration
      await this.generateUSDTPool();
      await this.generateMATICPool();

      for (const [tokenAddress, _] of this.pools.generic.entries()) {
        await this.generateTokenPool(tokenAddress);
      }
    }

    console.log("✅ Force regeneration with required gas complete");
  }
}

module.exports = { PreSignedTxPool };
