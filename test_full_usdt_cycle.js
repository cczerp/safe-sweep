/**
 * Test Full USDT Cycle
 * 
 * Standalone script to test complete USDT sweeping logic:
 * 1. Sweep ALL USDT from Safe to User Wallet
 * 2. Return ALL USDT from User Wallet back to Safe
 * 
 * This script is completely independent and does not modify any other files.
 */

const { ethers } = require("ethers");
const { PolygonGasCalculator } = require("./polygon_gas_calculator");
require("dotenv").config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Addresses from .env
  safeAddress: process.env.SAFE_ADDRESS,
  userWalletAddress: process.env.USER_WALLET_ADDRESS || process.env.SENDER,
  vaultAddress: process.env.VAULT_ADDRESS,
  sweeperAddress: process.env.SWEEPER_MODULE,
  privateKey: process.env.PRIVATE_KEY,
  usdtAddress: process.env.USDT_CONTRACT || "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // Polygon USDT
  
  // RPC URLs (fallback structure)
  rpcUrls: [
    process.env.DRPC_HTTP,
    process.env.QUICKNODE_HTTP,
    process.env.INFURA_HTTP,
    process.env.NODIES_HTTP,
    process.env.ANKR_HTTP,
    process.env.RPC_URL,
  ].filter(Boolean), // Remove undefined/null
  
  // Polygon gas settings
  polygonMinimumGasGwei: parseInt(process.env.POLYGON_MINIMUM_GAS_GWEI) || 25,
  polygonBaseTipGwei: parseInt(process.env.POLYGON_BASE_TIP_GWEI) || 50,
  polygonEmergencyTipGwei: parseInt(process.env.POLYGON_EMERGENCY_TIP_GWEI) || 200,
  
  // Chain ID
  chainId: parseInt(process.env.CHAIN_ID) || 137, // Polygon
};

// ============================================================================
// ABIs
// ============================================================================

const USDT_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

const SWEEPER_ABI = [
  "function sweepToken(address tokenAddress) external",
];

// ============================================================================
// MAIN TEST FUNCTION
// ============================================================================

async function testFullUSDTCycle() {
  console.log("=".repeat(70));
  console.log("🧪 FULL USDT CYCLE TEST");
  console.log("=".repeat(70));
  console.log();

  // Validate configuration
  if (!validateConfig()) {
    process.exit(1);
  }

  // Initialize provider and wallet
  const { provider, wallet } = await initializeProviderAndWallet();
  
  // Initialize Polygon gas calculator
  const polygonGas = new PolygonGasCalculator({
    minimumGasGwei: CONFIG.polygonMinimumGasGwei,
    baseTipGwei: CONFIG.polygonBaseTipGwei,
    emergencyTipGwei: CONFIG.polygonEmergencyTipGwei,
  });

  // Initialize USDT contract
  const usdtContract = new ethers.Contract(CONFIG.usdtAddress, USDT_ABI, wallet);

  // Test results
  const results = {
    initialSafeBalance: null,
    sweptAmount: null,
    returnedAmount: null,
    finalSafeBalance: null,
    sweepSuccess: false,
    returnSuccess: false,
  };

  try {
    // ========================================================================
    // STEP 1: Check initial Safe balance
    // ========================================================================
    console.log("📊 STEP 1: Checking initial Safe USDT balance...");
    const initialSafeBalance = await usdtContract.balanceOf(CONFIG.safeAddress);
    results.initialSafeBalance = initialSafeBalance;
    
    const decimals = await usdtContract.decimals();
    const initialBalanceFormatted = ethers.utils.formatUnits(initialSafeBalance, decimals);
    
    console.log(`   Safe Address: ${CONFIG.safeAddress}`);
    console.log(`   Initial Balance: ${initialBalanceFormatted} USDT`);
    console.log(`   Raw Balance: ${initialSafeBalance.toString()}`);
    console.log();

    // If no USDT, skip test
    if (initialSafeBalance.isZero()) {
      console.log("⚠️  No USDT present in Safe. Test skipped.");
      console.log("=".repeat(70));
      process.exit(0);
    }

    // ========================================================================
    // STEP 2: Sweep ALL USDT from Safe to Vault (using sweeper contract)
    // ========================================================================
    console.log("🚀 STEP 2: Sweeping ALL USDT from Safe to Vault...");
    console.log(`   From: ${CONFIG.safeAddress} (via sweeper)`);
    console.log(`   To: ${CONFIG.vaultAddress}`);
    console.log(`   Amount: ${initialBalanceFormatted} USDT`);
    console.log();

    // Build sweeper transaction
    const sweepTx = await buildSweeperTransaction(
      CONFIG.sweeperAddress,
      CONFIG.usdtAddress,
      provider,
      polygonGas
    );

    // Broadcast with RPC fallback
    const sweepResult = await broadcastWithFallback(sweepTx, provider, "SWEEP");
    
    if (!sweepResult.success) {
      throw new Error(`Sweep failed: ${sweepResult.error}`);
    }

    results.sweptAmount = initialSafeBalance;
    results.sweepSuccess = true;

    console.log(`✅ Sweep transaction confirmed!`);
    console.log(`   TX Hash: ${sweepResult.txHash}`);
    console.log(`   Block: ${sweepResult.blockNumber}`);
    console.log();

    // Wait a moment for state to update
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify balances after sweep
    const safeBalanceAfterSweep = await usdtContract.balanceOf(CONFIG.safeAddress);
    const vaultBalanceAfterSweep = await usdtContract.balanceOf(CONFIG.vaultAddress);
    
    console.log("📊 Verification after sweep:");
    console.log(`   Safe Balance: ${ethers.utils.formatUnits(safeBalanceAfterSweep, decimals)} USDT`);
    console.log(`   Vault Balance: ${ethers.utils.formatUnits(vaultBalanceAfterSweep, decimals)} USDT`);
    console.log();

    if (!safeBalanceAfterSweep.isZero()) {
      throw new Error(`Sweep verification failed: Safe still has ${ethers.utils.formatUnits(safeBalanceAfterSweep, decimals)} USDT`);
    }

    // ========================================================================
    // STEP 2.5: Transfer from Vault to User Wallet
    // ========================================================================
    let walletBalanceAfterTransfer = ethers.BigNumber.from(0);

    if (CONFIG.vaultAddress.toLowerCase() === CONFIG.userWalletAddress.toLowerCase()) {
      // Vault == Wallet, so balance is already in wallet
      console.log("ℹ️  Vault address matches user wallet - skipping transfer step");
      walletBalanceAfterTransfer = vaultBalanceAfterSweep;
      console.log(`   Wallet Balance: ${ethers.utils.formatUnits(walletBalanceAfterTransfer, decimals)} USDT`);
      console.log();
    } else {
      // Vault is separate but controlled by same PRIVATE_KEY
      console.log("🔄 STEP 2.5: Transferring USDT from Vault to User Wallet...");
      console.log(`   From: ${CONFIG.vaultAddress}`);
      console.log(`   To: ${CONFIG.userWalletAddress}`);
      console.log(`   Amount: ${ethers.utils.formatUnits(vaultBalanceAfterSweep, decimals)} USDT`);
      console.log(`   Note: Vault is controlled by same wallet (PRIVATE_KEY)`);
      console.log();

      // Build transfer from vault to wallet
      // Since vault is controlled by PRIVATE_KEY, we can sign as vault
      const vaultToWalletTx = await buildTransferTransaction(
        usdtContract,
        CONFIG.vaultAddress,
        CONFIG.userWalletAddress,
        vaultBalanceAfterSweep,
        provider,
        polygonGas
      );

      // Broadcast with RPC fallback
      const vaultToWalletResult = await broadcastWithFallback(vaultToWalletTx, provider, "VAULT_TO_WALLET");
      
      if (!vaultToWalletResult.success) {
        throw new Error(`Vault to wallet transfer failed: ${vaultToWalletResult.error}`);
      }

      console.log(`   ✅ Vault to wallet transfer confirmed!`);
      console.log(`   TX Hash: ${vaultToWalletResult.txHash}`);
      console.log();

      // Wait for state update
      await new Promise(resolve => setTimeout(resolve, 3000));

      walletBalanceAfterTransfer = await usdtContract.balanceOf(CONFIG.userWalletAddress);
      console.log(`   Wallet Balance: ${ethers.utils.formatUnits(walletBalanceAfterTransfer, decimals)} USDT`);
      console.log();
    }

    // ========================================================================
    // STEP 3: Return ALL USDT from User Wallet back to Safe
    // ========================================================================
    console.log("🔄 STEP 3: Returning ALL USDT from User Wallet back to Safe...");
    console.log(`   From: ${CONFIG.userWalletAddress}`);
    console.log(`   To: ${CONFIG.safeAddress}`);
    console.log(`   Amount: ${ethers.utils.formatUnits(walletBalanceAfterTransfer, decimals)} USDT`);
    console.log();

    // Build return transaction
    const returnTx = await buildTransferTransaction(
      usdtContract,
      CONFIG.userWalletAddress,
      CONFIG.safeAddress,
      walletBalanceAfterTransfer,
      provider,
      polygonGas
    );

    // Broadcast with RPC fallback
    const returnResult = await broadcastWithFallback(returnTx, provider, "RETURN");
    
    if (!returnResult.success) {
      throw new Error(`Return failed: ${returnResult.error}`);
    }

    results.returnedAmount = walletBalanceAfterTransfer;
    results.returnSuccess = true;

    console.log(`✅ Return transaction confirmed!`);
    console.log(`   TX Hash: ${returnResult.txHash}`);
    console.log(`   Block: ${returnResult.blockNumber}`);
    console.log();

    // Wait a moment for state to update
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify final balances
    const finalSafeBalance = await usdtContract.balanceOf(CONFIG.safeAddress);
    const finalWalletBalance = await usdtContract.balanceOf(CONFIG.userWalletAddress);
    
    results.finalSafeBalance = finalSafeBalance;

    console.log("📊 Verification after return:");
    console.log(`   Safe Balance: ${ethers.utils.formatUnits(finalSafeBalance, decimals)} USDT`);
    console.log(`   Wallet Balance: ${ethers.utils.formatUnits(finalWalletBalance, decimals)} USDT`);
    console.log();

    // ========================================================================
    // STEP 4: Print Final Summary
    // ========================================================================
    printSummary(results, decimals);

  } catch (error) {
    console.error("\n❌ TEST FAILED:");
    console.error(`   Error: ${error.message}`);
    if (error.stack) {
      console.error(`   Stack: ${error.stack}`);
    }
    console.log();
    printSummary(results, await usdtContract.decimals());
    process.exit(1);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function validateConfig() {
  console.log("🔍 Validating configuration...");
  
  const errors = [];
  
  if (!CONFIG.safeAddress) {
    errors.push("SAFE_ADDRESS not found in .env");
  }
  
  if (!CONFIG.userWalletAddress) {
    errors.push("USER_WALLET_ADDRESS or SENDER not found in .env");
  }
  
  if (!CONFIG.vaultAddress) {
    errors.push("VAULT_ADDRESS not found in .env");
  }
  
  if (!CONFIG.sweeperAddress) {
    errors.push("SWEEPER_MODULE not found in .env");
  }
  
  if (!CONFIG.privateKey) {
    errors.push("PRIVATE_KEY not found in .env");
  }
  
  if (CONFIG.rpcUrls.length === 0) {
    errors.push("No RPC URLs configured (set DRPC_HTTP, QUICKNODE_HTTP, INFURA_HTTP, etc.)");
  }
  
  if (errors.length > 0) {
    console.error("❌ Configuration errors:");
    errors.forEach(err => console.error(`   - ${err}`));
    console.log();
    return false;
  }
  
  console.log("✅ Configuration valid");
  console.log(`   Safe: ${CONFIG.safeAddress}`);
  console.log(`   Wallet: ${CONFIG.userWalletAddress}`);
  console.log(`   USDT: ${CONFIG.usdtAddress}`);
  console.log(`   RPCs: ${CONFIG.rpcUrls.length} configured`);
  console.log();
  
  return true;
}

async function initializeProviderAndWallet() {
  console.log("🔌 Initializing provider and wallet...");
  
  // Try to connect to first available RPC
  let provider = null;
  let lastError = null;
  
  for (const rpcUrl of CONFIG.rpcUrls) {
    try {
      provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      await provider.getBlockNumber(); // Test connection
      console.log(`✅ Connected to RPC: ${rpcUrl.substring(0, 50)}...`);
      break;
    } catch (error) {
      lastError = error;
      console.log(`⚠️  Failed to connect to: ${rpcUrl.substring(0, 50)}...`);
      continue;
    }
  }
  
  if (!provider) {
    throw new Error(`Failed to connect to any RPC. Last error: ${lastError?.message}`);
  }
  
  // Create wallet
  const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
  console.log(`✅ Wallet initialized: ${wallet.address}`);
  console.log();
  
  return { provider, wallet };
}

async function buildSweeperTransaction(
  sweeperAddress,
  tokenAddress,
  provider,
  polygonGas
) {
  console.log("🔨 Building sweeper transaction...");
  console.log(`   Sweeper: ${sweeperAddress}`);
  console.log(`   Token: ${tokenAddress}`);
  
  // Get wallet
  const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  console.log(`   Nonce: ${nonce}`);

  // Get fee data
  const feeData = await provider.getFeeData();
  console.log(`   Network Fee Data:`);
  console.log(`     MaxFeePerGas: ${ethers.utils.formatUnits(feeData.maxFeePerGas || 0, "gwei")} gwei`);
  console.log(`     MaxPriorityFeePerGas: ${ethers.utils.formatUnits(feeData.maxPriorityFeePerGas || 0, "gwei")} gwei`);

  // Apply Polygon gas rules
  const polygonGasConfig = polygonGas.fromProviderFeeData(feeData, { emergency: true });
  console.log(`   Polygon Gas Applied:`);
  console.log(`     MaxFeePerGas: ${ethers.utils.formatUnits(polygonGasConfig.maxFeePerGas, "gwei")} gwei`);
  console.log(`     MaxPriorityFeePerGas: ${ethers.utils.formatUnits(polygonGasConfig.maxPriorityFeePerGas, "gwei")} gwei`);

  // Create sweeper contract interface
  const sweeperInterface = new ethers.utils.Interface(SWEEPER_ABI);
  const data = sweeperInterface.encodeFunctionData("sweepToken", [tokenAddress]);
  
  // Estimate gas limit
  const sweeperContract = new ethers.Contract(sweeperAddress, SWEEPER_ABI, provider);
  const gasLimit = await provider.estimateGas({
    to: sweeperAddress,
    from: wallet.address,
    data: data,
  });
  const gasLimitWithBuffer = gasLimit.mul(120).div(100); // 20% buffer
  console.log(`   Gas Limit: ${gasLimit.toString()} (with 20% buffer: ${gasLimitWithBuffer.toString()})`);
  console.log();
  
  // Build transaction
  const tx = {
    to: sweeperAddress,
    data: data,
    nonce: nonce,
    chainId: CONFIG.chainId,
    gasLimit: gasLimitWithBuffer,
    maxFeePerGas: polygonGasConfig.maxFeePerGas,
    maxPriorityFeePerGas: polygonGasConfig.maxPriorityFeePerGas,
    type: 2, // EIP-1559
  };
  
  return tx;
}

async function buildTransferTransaction(
  usdtContract,
  fromAddress,
  toAddress,
  amount,
  provider,
  polygonGas
) {
  console.log("🔨 Building transfer transaction...");
  console.log(`   From: ${fromAddress}`);
  console.log(`   To: ${toAddress}`);
  console.log(`   Amount: ${amount.toString()} (raw)`);
  
  // Get wallet (must be the fromAddress since same PRIVATE_KEY controls everything)
  const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
  
  // Verify wallet is the fromAddress (for direct transfers)
  // Since user confirmed same wallet controls Safe, sweeper, and vault,
  // we expect fromAddress to match wallet.address OR be the vault (also controlled by wallet)
  if (wallet.address.toLowerCase() !== fromAddress.toLowerCase() && 
      CONFIG.vaultAddress.toLowerCase() !== fromAddress.toLowerCase()) {
    console.log(`   ⚠️  Warning: Wallet address (${wallet.address}) does not match fromAddress (${fromAddress})`);
    console.log(`   Assuming fromAddress is controlled by same PRIVATE_KEY...`);
  }
  
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  console.log(`   Nonce: ${nonce}`);

  // Get fee data
  const feeData = await provider.getFeeData();
  console.log(`   Network Fee Data:`);
  console.log(`     MaxFeePerGas: ${ethers.utils.formatUnits(feeData.maxFeePerGas || 0, "gwei")} gwei`);
  console.log(`     MaxPriorityFeePerGas: ${ethers.utils.formatUnits(feeData.maxPriorityFeePerGas || 0, "gwei")} gwei`);

  // Apply Polygon gas rules
  const polygonGasConfig = polygonGas.fromProviderFeeData(feeData, { emergency: true });
  console.log(`   Polygon Gas Applied:`);
  console.log(`     MaxFeePerGas: ${ethers.utils.formatUnits(polygonGasConfig.maxFeePerGas, "gwei")} gwei`);
  console.log(`     MaxPriorityFeePerGas: ${ethers.utils.formatUnits(polygonGasConfig.maxPriorityFeePerGas, "gwei")} gwei`);

  // Estimate gas limit
  const usdtWithSigner = usdtContract.connect(wallet);
  const gasLimit = await usdtWithSigner.transfer.estimateGas(toAddress, amount);
  const gasLimitWithBuffer = gasLimit.mul(120).div(100); // 20% buffer
  console.log(`   Gas Limit: ${gasLimit.toString()} (with 20% buffer: ${gasLimitWithBuffer.toString()})`);
  console.log();
  
  // Build transaction
  const tx = {
    to: CONFIG.usdtAddress,
    data: usdtContract.interface.encodeFunctionData("transfer", [toAddress, amount]),
    nonce: nonce,
    chainId: CONFIG.chainId,
    gasLimit: gasLimitWithBuffer,
    maxFeePerGas: polygonGasConfig.maxFeePerGas,
    maxPriorityFeePerGas: polygonGasConfig.maxPriorityFeePerGas,
    type: 2, // EIP-1559
  };
  
  return tx;
}

async function broadcastWithFallback(tx, primaryProvider, txType) {
  console.log(`📡 Broadcasting ${txType} transaction...`);
  console.log(`   Primary RPC: ${primaryProvider.connection?.url || "unknown"}`);
  
  // Sign transaction
  const wallet = new ethers.Wallet(CONFIG.privateKey);
  const signedTx = await wallet.signTransaction(tx);
  
  // Try primary RPC first
  try {
    console.log(`   Attempting primary RPC...`);
    const response = await primaryProvider.broadcastTransaction(signedTx);
    const receipt = await response.wait();
    
    console.log(`   ✅ Success on primary RPC!`);
    return {
      success: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    };
  } catch (error) {
    console.log(`   ⚠️  Primary RPC failed: ${error.message}`);
    console.log(`   Trying fallback RPCs...`);
  }
  
  // Try fallback RPCs
  for (let i = 0; i < CONFIG.rpcUrls.length; i++) {
    const rpcUrl = CONFIG.rpcUrls[i];
    
    // Skip if this is the primary RPC we already tried
    if (primaryProvider.connection?.url === rpcUrl) {
      continue;
    }
    
    try {
      console.log(`   Attempting fallback RPC ${i + 1}/${CONFIG.rpcUrls.length}...`);
      const fallbackProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const response = await fallbackProvider.broadcastTransaction(signedTx);
      const receipt = await response.wait();
      
      console.log(`   ✅ Success on fallback RPC ${i + 1}!`);
      return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      console.log(`   ⚠️  Fallback RPC ${i + 1} failed: ${error.message}`);
      continue;
    }
  }
  
  // All RPCs failed
  return {
    success: false,
    error: "All RPC endpoints failed",
  };
}

function printSummary(results, decimals) {
  console.log("=".repeat(70));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(70));
  console.log();

  if (results.initialSafeBalance !== null) {
    console.log(`Initial Safe Balance: ${ethers.utils.formatUnits(results.initialSafeBalance, decimals)} USDT`);
  }

  if (results.sweptAmount !== null) {
    console.log(`Amount Swept: ${ethers.utils.formatUnits(results.sweptAmount, decimals)} USDT`);
    console.log(`Sweep Status: ${results.sweepSuccess ? "✅ PASS" : "❌ FAIL"}`);
  }

  if (results.returnedAmount !== null) {
    console.log(`Amount Returned: ${ethers.utils.formatUnits(results.returnedAmount, decimals)} USDT`);
    console.log(`Return Status: ${results.returnSuccess ? "✅ PASS" : "❌ FAIL"}`);
  }

  if (results.finalSafeBalance !== null) {
    console.log(`Final Safe Balance: ${ethers.utils.formatUnits(results.finalSafeBalance, decimals)} USDT`);
  }
  
  console.log();
  console.log("=".repeat(70));
  
  const overallSuccess = results.sweepSuccess && results.returnSuccess;
  console.log(`Overall Test: ${overallSuccess ? "✅ PASS" : "❌ FAIL"}`);
  console.log("=".repeat(70));
  console.log();
}

// ============================================================================
// RUN TEST
// ============================================================================

if (require.main === module) {
  testFullUSDTCycle()
    .then(() => {
      console.log("✅ Test completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Test failed:", error);
      process.exit(1);
    });
}

module.exports = { testFullUSDTCycle };

