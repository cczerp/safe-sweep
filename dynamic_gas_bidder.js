const { ethers } = require("ethers");
const { PolygonGasCalculator } = require("./polygon_gas_calculator");

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

    // Polygon gas calculator
    this.polygonGas = new PolygonGasCalculator({
      minimumGasGwei: config.polygonMinimumGasGwei || 25,
      baseTipGwei: config.polygonBaseTipGwei || 50,
      congestedTipGwei: config.polygonCongestedTipGwei || 150,
      aggressiveTipGwei: config.polygonAggressiveTipGwei || 200,
      emergencyTipGwei: config.polygonEmergencyTipGwei || 200,
    });

    console.log("💰 Dynamic Gas Bidder initialized (Polygon-optimized)");
    console.log(`   - Premium: +${(this.gasPremium * 100).toFixed(0)}% above attacker`);
    console.log(`   - Polygon minimum: 25 gwei`);
    console.log(`   - Base tip: 50 gwei, Emergency tip: 200 gwei`);
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

    // Use Polygon-specific outbid logic
    const outbidGas = this.polygonGas.outbidGas(attackerGas, this.gasPremium * 100);

    // Apply safety limit
    if (outbidGas.maxFeePerGas.gt(this.maxGasPrice)) {
      console.warn(
        `⚠️ Calculated gas ${ethers.utils.formatUnits(
          outbidGas.maxFeePerGas,
          "gwei"
        )} gwei exceeds max, capping at ${ethers.utils.formatUnits(
          this.maxGasPrice,
          "gwei"
        )} gwei`
      );
      // Cap but maintain Polygon minimum
      const minGas = ethers.utils.parseUnits("25", "gwei");
      outbidGas.maxFeePerGas = this.maxGasPrice.gt(minGas) ? this.maxGasPrice : minGas;
      // Keep tip proportional but ensure minimum
      const minTip = ethers.utils.parseUnits("50", "gwei");
      outbidGas.maxPriorityFeePerGas = outbidGas.maxPriorityFeePerGas.gt(minTip) 
        ? outbidGas.maxPriorityFeePerGas 
        : minTip;
    }

    return outbidGas;
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
   * Uses Polygon-specific gas rules
   */
  async getBaselineCompetitiveGas() {
    const feeData = await this.provider.getFeeData();

    // Use Polygon competitive gas (not emergency, but competitive)
    return this.polygonGas.fromProviderFeeData(feeData, { 
      emergency: false, 
      congested: false 
    });
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
