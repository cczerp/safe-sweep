const { ethers } = require("ethers");
require("dotenv").config();

/**
 * Test script to simulate a transferFrom attack on the Safe
 *
 * This script:
 * 1. Uses a DIFFERENT wallet (TEST_ATTACKER_KEY) - NOT the Safe owner
 * 2. Calls transferFrom() on USDT contract
 * 3. Tries to transfer tokens FROM the Safe TO the attacker
 *
 * This simulates what a real attacker would do if they got approval from your Safe.
 *
 * Setup:
 * 1. Add TEST_ATTACKER_KEY to your .env file (a different private key)
 * 2. Make sure this attacker wallet has some MATIC for gas
 * 3. Run with: VERBOSE=true node test_transferfrom_attack.js
 *
 * The defense monitor should detect this in the mempool and front-run it!
 */

const USDT_ABI = [
  "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

async function testTransferFromAttack() {
  console.log("🧪 Testing transferFrom Attack Detection\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Validate config
  if (!process.env.TEST_ATTACKER_KEY) {
    console.error("❌ ERROR: TEST_ATTACKER_KEY not found in .env");
    console.error("   Add a test private key (different from Safe owner):");
    console.error("   TEST_ATTACKER_KEY=0x...");
    process.exit(1);
  }

  if (!process.env.SAFE_ADDRESS) {
    console.error("❌ ERROR: SAFE_ADDRESS not found in .env");
    process.exit(1);
  }

  if (!process.env.USDT_CONTRACT) {
    console.error("❌ ERROR: USDT_CONTRACT not found in .env");
    process.exit(1);
  }

  const rpcUrl = process.env.ALCHEMY_HTTP || process.env.RPC_URL;
  if (!rpcUrl) {
    console.error("❌ ERROR: No RPC URL found");
    process.exit(1);
  }

  // Setup provider and attacker wallet
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const attackerWallet = new ethers.Wallet(process.env.TEST_ATTACKER_KEY, provider);
  const usdtContract = new ethers.Contract(process.env.USDT_CONTRACT, USDT_ABI, attackerWallet);

  const safeAddress = process.env.SAFE_ADDRESS;
  const attackerAddress = attackerWallet.address;

  console.log("📋 Test Configuration:");
  console.log(`   Safe Address: ${safeAddress}`);
  console.log(`   Attacker Wallet: ${attackerAddress}`);
  console.log(`   USDT Contract: ${process.env.USDT_CONTRACT}`);
  console.log("");

  // Check if attacker is the Safe owner (this won't work for testing!)
  if (attackerAddress.toLowerCase() === safeAddress.toLowerCase()) {
    console.error("❌ ERROR: Attacker wallet is the same as Safe!");
    console.error("   TEST_ATTACKER_KEY must be a DIFFERENT wallet");
    process.exit(1);
  }

  // Check balances
  console.log("💰 Checking balances...");
  const safeBalance = await usdtContract.balanceOf(safeAddress);
  const attackerBalance = await provider.getBalance(attackerAddress);
  const allowance = await usdtContract.allowance(safeAddress, attackerAddress);

  console.log(`   Safe USDT balance: ${ethers.utils.formatUnits(safeBalance, 6)} USDT`);
  console.log(`   Attacker MATIC balance: ${ethers.utils.formatEther(attackerBalance)} MATIC`);
  console.log(`   Safe → Attacker allowance: ${ethers.utils.formatUnits(allowance, 6)} USDT`);
  console.log("");

  if (attackerBalance.lt(ethers.utils.parseEther("0.01"))) {
    console.error("❌ ERROR: Attacker wallet needs MATIC for gas");
    console.error("   Send some MATIC to:", attackerAddress);
    process.exit(1);
  }

  if (safeBalance.eq(0)) {
    console.warn("⚠️ WARNING: Safe has 0 USDT balance");
    console.warn("   The attack will fail on-chain, but should still be detected!");
    console.log("");
  }

  // Prepare the attack transaction
  const attackAmount = safeBalance.gt(0)
    ? safeBalance // Try to steal everything
    : ethers.utils.parseUnits("1", 6); // Or just attempt 1 USDT

  console.log("🎯 Preparing Attack Transaction:");
  console.log(`   Function: transferFrom()`);
  console.log(`   From (victim): ${safeAddress}`);
  console.log(`   To (attacker): ${attackerAddress}`);
  console.log(`   Amount: ${ethers.utils.formatUnits(attackAmount, 6)} USDT`);
  console.log("");

  console.log("⚠️ IMPORTANT: Make sure your defense monitor is running!");
  console.log("   Run: VERBOSE=true DEBUG=true node udmv2.js");
  console.log("");
  console.log("⏳ Waiting 5 seconds before sending attack...");
  console.log("   (Start your monitor now if not running!)");
  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    console.log("\n🚨 SENDING ATTACK TRANSACTION...\n");

    // Build the transaction
    const tx = await usdtContract.populateTransaction.transferFrom(
      safeAddress,
      attackerAddress,
      attackAmount
    );

    // Get gas estimate
    const feeData = await provider.getFeeData();
    const gasLimit = await provider.estimateGas({
      to: tx.to,
      data: tx.data,
      from: attackerAddress
    });

    // Send the attack
    const signedTx = await attackerWallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      gasLimit: gasLimit.mul(120).div(100),
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      type: 2
    });

    console.log("✅ Attack transaction sent!");
    console.log(`   TX Hash: ${signedTx.hash}`);
    console.log(`   Transaction data: ${tx.data.slice(0, 66)}...`);
    console.log("");
    console.log("🔍 Check your defense monitor output!");
    console.log("   You should see:");
    console.log("   - 'VERBOSE: Found transferFrom() call'");
    console.log("   - 'Match: ✅ YES'");
    console.log("   - 'THREAT DETECTED'");
    console.log("");
    console.log("⏳ Waiting for transaction to be mined...");

    const receipt = await signedTx.wait();

    console.log(`\n📦 Transaction mined in block ${receipt.blockNumber}`);
    console.log(`   Status: ${receipt.status === 1 ? "✅ Success" : "❌ Failed"}`);

    if (receipt.status === 0) {
      console.log("   (Expected to fail if Safe didn't approve attacker)");
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🎯 Test Complete!");
    console.log("   Did your defense monitor detect it?");
    console.log("   Check the logs above for threat detection");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  } catch (error) {
    console.error("\n❌ Transaction failed:", error.message);

    if (error.message.includes("insufficient funds")) {
      console.error("   → Attacker wallet needs more MATIC");
    } else if (error.message.includes("allowance")) {
      console.error("   → Safe hasn't approved attacker (expected)");
      console.error("   → But it should still be detected in mempool!");
    }

    console.log("\n💡 Even if the transaction fails, the monitor should detect it!");
  }
}

// Run the test
testTransferFromAttack().catch(console.error);
