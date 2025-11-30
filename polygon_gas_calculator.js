const { ethers } = require("ethers");

/**
 * Polygon Gas Calculator
 * 
 * Polygon has different gas rules than Ethereum:
 * - Minimum ~25 gwei to be accepted
 * - High tip to prioritize (50-200 gwei during congestion)
 * - Doesn't follow EIP-1559 priority fee markets the same way
 * 
 * This module provides Polygon-specific gas calculation functions.
 */
class PolygonGasCalculator {
  constructor(config = {}) {
    this.config = config;
    
    // Polygon-specific constants
    this.MINIMUM_GAS_GWEI = config.minimumGasGwei || 25; // Minimum to be accepted
    this.BASE_TIP_GWEI = config.baseTipGwei || 50; // Base tip for normal conditions
    this.CONGESTED_TIP_GWEI = config.congestedTipGwei || 150; // Tip during congestion
    this.AGGRESSIVE_TIP_GWEI = config.aggressiveTipGwei || 200; // Aggressive tip for emergency
    
    // For emergency sweeps, use aggressive tip
    this.EMERGENCY_TIP_GWEI = config.emergencyTipGwei || 200;
  }

  /**
   * Get Polygon-appropriate gas prices
   * 
   * @param {Object} options
   * @param {boolean} options.emergency - Use aggressive/emergency gas
   * @param {boolean} options.congested - Network is congested
   * @param {BigNumber} options.networkBaseFee - Network base fee (if available)
   * @returns {Object} Gas price configuration
   */
  getPolygonGas(options = {}) {
    const { emergency = false, congested = false, networkBaseFee = null } = options;

    // Determine tip based on conditions
    let tipGwei;
    if (emergency) {
      tipGwei = this.EMERGENCY_TIP_GWEI;
    } else if (congested) {
      tipGwei = this.CONGESTED_TIP_GWEI;
    } else {
      tipGwei = this.BASE_TIP_GWEI;
    }

    const tipWei = ethers.utils.parseUnits(tipGwei.toString(), "gwei");
    
    // Polygon: maxFeePerGas = baseFee + tip
    // If we don't have baseFee, estimate conservatively
    let maxFeePerGas;
    if (networkBaseFee) {
      // Base fee + tip + small buffer
      maxFeePerGas = networkBaseFee.add(tipWei).add(ethers.utils.parseUnits("5", "gwei"));
    } else {
      // Conservative estimate: assume base fee is around 30 gwei, add tip
      const estimatedBaseFee = ethers.utils.parseUnits("30", "gwei");
      maxFeePerGas = estimatedBaseFee.add(tipWei).add(ethers.utils.parseUnits("10", "gwei"));
    }

    // Ensure minimum
    const minimumWei = ethers.utils.parseUnits(this.MINIMUM_GAS_GWEI.toString(), "gwei");
    if (maxFeePerGas.lt(minimumWei)) {
      maxFeePerGas = minimumWei;
    }

    return {
      type: 2, // EIP-1559
      maxFeePerGas: maxFeePerGas,
      maxPriorityFeePerGas: tipWei, // This is the tip
    };
  }

  /**
   * Get emergency gas for sweeps (aggressive)
   */
  getEmergencyGas() {
    return this.getPolygonGas({ emergency: true });
  }

  /**
   * Get competitive gas for normal conditions
   */
  getCompetitiveGas(congested = false) {
    return this.getPolygonGas({ congested });
  }

  /**
   * Outbid attacker's gas by a percentage
   * 
   * @param {Object} attackerGas - Attacker's gas configuration
   * @param {number} premiumPercent - Premium percentage (e.g., 50 for 50%)
   * @returns {Object} Our gas configuration
   */
  outbidGas(attackerGas, premiumPercent = 50) {
    let attackerTip;
    let attackerMaxFee;

    if (attackerGas.maxPriorityFeePerGas) {
      attackerTip = ethers.BigNumber.from(attackerGas.maxPriorityFeePerGas);
      attackerMaxFee = ethers.BigNumber.from(attackerGas.maxFeePerGas || attackerGas.maxFeePerGas);
    } else if (attackerGas.gasPrice) {
      // Legacy gas price - treat as maxFee
      attackerMaxFee = ethers.BigNumber.from(attackerGas.gasPrice);
      // Estimate tip as 30% of total (Polygon typical)
      attackerTip = attackerMaxFee.mul(30).div(100);
    } else {
      // Unknown format, use minimum
      return this.getEmergencyGas();
    }

    // Calculate our bid: attacker's tip + premium
    const premiumMultiplier = 100 + premiumPercent;
    const ourTip = attackerTip.mul(premiumMultiplier).div(100);
    
    // Ensure minimum tip
    const minTip = ethers.utils.parseUnits(this.BASE_TIP_GWEI.toString(), "gwei");
    const finalTip = ourTip.gt(minTip) ? ourTip : minTip;

    // Max fee = base fee estimate + our tip + buffer
    // Estimate base fee from attacker's max fee (subtract their tip)
    const estimatedBaseFee = attackerMaxFee.sub(attackerTip);
    const buffer = ethers.utils.parseUnits("10", "gwei");
    const ourMaxFee = estimatedBaseFee.add(finalTip).add(buffer);

    // Ensure minimum
    const minimumWei = ethers.utils.parseUnits(this.MINIMUM_GAS_GWEI.toString(), "gwei");
    const finalMaxFee = ourMaxFee.gt(minimumWei) ? ourMaxFee : minimumWei;

    return {
      type: 2,
      maxFeePerGas: finalMaxFee,
      maxPriorityFeePerGas: finalTip,
    };
  }

  /**
   * Get gas from provider fee data, but apply Polygon rules
   * 
   * @param {Object} feeData - Provider fee data
   * @param {Object} options - Options (emergency, congested)
   * @returns {Object} Polygon-appropriate gas
   */
  fromProviderFeeData(feeData, options = {}) {
    const { emergency = false, congested = false } = options;

    // Get Polygon gas
    const polygonGas = this.getPolygonGas({
      emergency,
      congested,
      networkBaseFee: feeData.maxFeePerGas ? 
        feeData.maxFeePerGas.sub(feeData.maxPriorityFeePerGas || ethers.BigNumber.from(0)) : 
        null
    });

    // If provider gives us fee data, we can use it as a reference
    // But we still enforce Polygon minimums and use our tip strategy
    if (feeData.maxFeePerGas) {
      const providerBaseFee = feeData.maxFeePerGas.sub(feeData.maxPriorityFeePerGas || ethers.BigNumber.from(0));
      
      // Use provider's base fee if available, but use our tip strategy
      const ourTip = polygonGas.maxPriorityFeePerGas;
      const ourMaxFee = providerBaseFee.add(ourTip).add(ethers.utils.parseUnits("5", "gwei"));
      
      const minimumWei = ethers.utils.parseUnits(this.MINIMUM_GAS_GWEI.toString(), "gwei");
      return {
        type: 2,
        maxFeePerGas: ourMaxFee.gt(minimumWei) ? ourMaxFee : minimumWei,
        maxPriorityFeePerGas: ourTip,
      };
    }

    return polygonGas;
  }

  /**
   * Format gas info for logging
   */
  formatGasInfo(gas) {
    if (!gas) return "N/A";
    
    if (gas.maxFeePerGas && gas.maxPriorityFeePerGas) {
      return `MaxFee: ${ethers.utils.formatUnits(gas.maxFeePerGas, "gwei")} gwei, Tip: ${ethers.utils.formatUnits(gas.maxPriorityFeePerGas, "gwei")} gwei`;
    } else if (gas.gasPrice) {
      return `${ethers.utils.formatUnits(gas.gasPrice, "gwei")} gwei (legacy)`;
    }
    
    return "Unknown format";
  }
}

module.exports = { PolygonGasCalculator };

