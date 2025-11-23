const { ethers } = require("ethers");

/**
 * Dynamic Gas Bidder
 *
 * Detects attacker transactions and dynamically outbids them
 * by parsing their gas price and adding a premium.
 *
 * Strategy: When we detect a malicious tx, we:
 * 1. Parse their gas price from the mempool tx
 * 2. Add configured premium (default 50%)
 * 3. Instantly re-sign with the higher gas
 * 4. Broadcast via shotgun
 *
 * This ensures we ALWAYS outbid the attacker.
 */
class DynamicGasBidder {
  constructor(config) {
    this.config = config;
    this.provider = null;
    this.signer = null;

    // Bidding configuration
    this.gasPremium = config.gasPremium || 0.5; // 50% above attacker
    this.maxGasPrice = config.maxGasPrice || ethers.utils.parseUnits("1000", "gwei"); // Safety limit

    console.log("💰 Dynamic Gas Bidder initialized");
    console.log(`   - Premium: +${(this.gasPremium * 100).toFixed(0)}% above attacker`);
    console.log(
      `   - Max gas: ${ethers.utils.formatUnits(this.maxGasPrice, "gwei")} gwei`
    );
  }

  async initialize(provider, privateKey) {
    this.provider = provider;
    this.signer = new ethers.Wallet(privateKey, provider);
    console.log("✅ Dynamic Gas Bidder ready");
  }

  /**
   * Parse gas price from a pending transaction
   */
  parseGasFromTx(tx) {
    if (!tx) return null;

    // EIP-1559 transaction
    if (tx.maxFeePerGas && tx.maxPriorityFeePerGas) {
      return {
        type: 2,
        maxFeePerGas: ethers.BigNumber.from(tx.maxFeePerGas),
        maxPriorityFeePerGas: ethers.BigNumber.from(tx.maxPriorityFeePerGas),
      };
    }

    // Legacy transaction
    if (tx.gasPrice) {
      return {
        type: 0,
        gasPrice: ethers.BigNumber.from(tx.gasPrice),
      };
    }

    return null;
  }

  /**
   * Calculate outbid gas - adds premium to attacker's gas
   */
  calculateOutbidGas(attackerGas) {
    if (!attackerGas) return null;

    const premium = Math.floor((1 + this.gasPremium) * 100);

    if (attackerGas.type === 2) {
      // EIP-1559
      let maxFeePerGas = attackerGas.maxFeePerGas.mul(premium).div(100);
      let maxPriorityFeePerGas = attackerGas.maxPriorityFeePerGas.mul(premium).div(100);

      // Apply safety limit
      if (maxFeePerGas.gt(this.maxGasPrice)) {
        console.warn(
          `⚠️ Calculated gas ${ethers.utils.formatUnits(
            maxFeePerGas,
            "gwei"
          )} gwei exceeds max, capping at ${ethers.utils.formatUnits(
            this.maxGasPrice,
            "gwei"
          )} gwei`
        );
        maxFeePerGas = this.maxGasPrice;
        maxPriorityFeePerGas = this.maxGasPrice.div(2); // Half of max for priority
      }

      return {
        type: 2,
        maxFeePerGas: maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
      };
    } else {
      // Legacy
      let gasPrice = attackerGas.gasPrice.mul(premium).div(100);

      if (gasPrice.gt(this.maxGasPrice)) {
        console.warn(
          `⚠️ Calculated gas ${ethers.utils.formatUnits(
            gasPrice,
            "gwei"
          )} gwei exceeds max, capping`
        );
        gasPrice = this.maxGasPrice;
      }

      return {
        type: 0,
        gasPrice: gasPrice,
      };
    }
  }

  /**
   * Build and sign a transaction with outbid gas
   * This is fast because we skip estimation and use provided gas
   */
  async buildOutbidTx(txData, attackerGas, nonce = null) {
    const startTime = Date.now();

    // Parse attacker's gas
    const parsedGas = this.parseGasFromTx(attackerGas);
    if (!parsedGas) {
      throw new Error("Could not parse attacker gas price");
    }

    console.log("\n💰 DYNAMIC GAS BIDDING:");
    if (parsedGas.type === 2) {
      console.log(
        `   Attacker: ${ethers.utils.formatUnits(
          parsedGas.maxFeePerGas,
          "gwei"
        )} gwei (EIP-1559)`
      );
    } else {
      console.log(
        `   Attacker: ${ethers.utils.formatUnits(parsedGas.gasPrice, "gwei")} gwei`
      );
    }

    // Calculate outbid gas
    const outbidGas = this.calculateOutbidGas(parsedGas);

    if (outbidGas.type === 2) {
      console.log(
        `   Our bid: ${ethers.utils.formatUnits(
          outbidGas.maxFeePerGas,
          "gwei"
        )} gwei (+${(this.gasPremium * 100).toFixed(0)}%)`
      );
    } else {
      console.log(
        `   Our bid: ${ethers.utils.formatUnits(outbidGas.gasPrice, "gwei")} gwei (+${(
          this.gasPremium * 100
        ).toFixed(0)}%)`
      );
    }

    // Get nonce if not provided
    if (nonce === null) {
      nonce = await this.provider.getTransactionCount(this.signer.address, "pending");
    }

    // Estimate gas limit quickly
    const gasLimit = await this.provider.estimateGas({
      to: txData.to,
      data: txData.data,
      from: this.signer.address,
      value: txData.value || 0,
    });

    // Build transaction
    const tx = {
      to: txData.to,
      data: txData.data,
      value: txData.value || 0,
      nonce: nonce,
      chainId: this.config.chainId,
      gasLimit: gasLimit.mul(120).div(100), // 20% buffer
      ...outbidGas,
    };

    // Sign transaction
    const signedTx = await this.signer.signTransaction(tx);
    const txHash = ethers.utils.keccak256(signedTx);

    const buildTime = Date.now() - startTime;
    console.log(`   ⚡ Outbid tx built & signed in ${buildTime}ms`);
    console.log(`   📊 Hash: ${txHash}`);

    return {
      signedTx: signedTx,
      txHash: txHash,
      nonce: nonce,
      outbidGas: outbidGas,
      buildTime: buildTime,
    };
  }

  /**
   * Quick check if we should outbid (compares our pre-signed gas vs attacker's)
   */
  shouldOutbid(ourGas, attackerGas) {
    const attackerParsed = this.parseGasFromTx(attackerGas);
    if (!attackerParsed) return false;

    // Compare gas prices
    if (attackerParsed.type === 2 && ourGas.maxFeePerGas) {
      // Both EIP-1559
      const ourMax = ethers.BigNumber.from(ourGas.maxFeePerGas);
      const attackerMax = attackerParsed.maxFeePerGas;

      // If attacker's gas is higher than ours, we need to outbid
      return attackerMax.gt(ourMax);
    } else if (attackerParsed.type === 0 && ourGas.gasPrice) {
      // Both legacy
      const ourPrice = ethers.BigNumber.from(ourGas.gasPrice);
      const attackerPrice = attackerParsed.gasPrice;

      return attackerPrice.gt(ourPrice);
    }

    // If types don't match or we can't compare, play it safe and outbid
    return true;
  }

  /**
   * Get recommended gas for pre-signing (baseline competitive gas)
   */
  async getBaselineCompetitiveGas() {
    const feeData = await this.provider.getFeeData();

    // Use a moderate multiplier for pre-signed txs (we'll outbid dynamically if needed)
    const baseMultiplier = this.config.baseGasMult || 2.5;

    if (feeData.maxFeePerGas) {
      return {
        type: 2,
        maxFeePerGas: feeData.maxFeePerGas
          .mul(Math.floor(baseMultiplier * 100))
          .div(100),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
          .mul(Math.floor(baseMultiplier * 100))
          .div(100),
      };
    } else {
      return {
        type: 0,
        gasPrice: feeData.gasPrice.mul(Math.floor(baseMultiplier * 100)).div(100),
      };
    }
  }

  /**
   * Analyze a pending transaction to determine threat level and gas
   */
  analyzeThreatTransaction(tx, safeAddress) {
    if (!tx) return null;

    const analysis = {
      isThreat: false,
      threatType: null,
      gas: this.parseGasFromTx(tx),
      from: tx.from,
      to: tx.to,
      value: tx.value,
      data: tx.data,
    };

    // Check if transaction targets our Safe
    if (tx.from?.toLowerCase() === safeAddress.toLowerCase()) {
      analysis.isThreat = true;
      analysis.threatType = "OUTGOING_FROM_SAFE";
    }

    if (tx.to?.toLowerCase() === safeAddress.toLowerCase()) {
      // Could be incoming - need to check data
      if (tx.data && tx.data !== "0x") {
        analysis.isThreat = true;
        analysis.threatType = "CONTRACT_CALL_TO_SAFE";
      }
    }

    return analysis;
  }

  /**
   * Format gas info for logging
   */
  formatGasInfo(gas) {
    if (!gas) return "N/A";

    if (gas.type === 2) {
      return `${ethers.utils.formatUnits(gas.maxFeePerGas, "gwei")} gwei (EIP-1559)`;
    } else {
      return `${ethers.utils.formatUnits(gas.gasPrice, "gwei")} gwei`;
    }
  }
}

module.exports = { DynamicGasBidder };
