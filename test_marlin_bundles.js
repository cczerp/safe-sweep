const { ethers } = require("ethers");
const { MarlinRelay } = require("./marlin_relay");
require("dotenv").config();

/**
 * Test Marlin Relay Bundle API
 *
 * This script tests if your Marlin Relay configuration works correctly
 */

async function testMarlinBundles() {
  console.log("🧪 MARLIN RELAY BUNDLE API TEST\n");
  console.log("=".repeat(60));

  // Check environment variables
  const searcherKey = process.env.MEV_SEARCHER_KEY;
  const privateKey = process.env.PRIVATE_KEY;
  const rpcUrl = process.env.DRPC_HTTP || process.env.QUICKNODE_HTTP || process.env.INFURA_HTTP || process.env.RPC_URL;

  if (!searcherKey) {
    console.log("❌ MEV_SEARCHER_KEY not found in .env");
    console.log("\n💡 Add to your .env file:");
    console.log("   MEV_SEARCHER_KEY=your_searcher_private_key_here");
    console.log("\n   Note: This should be a separate key from PRIVATE_KEY");
    console.log("   It's used for signing Marlin Relay bundle requests");
    return;
  }

  if (!privateKey) {
    console.log("❌ PRIVATE_KEY not found in .env");
    return;
  }

  if (!rpcUrl) {
    console.log("❌ No RPC URL configured");
    console.log("   Set DRPC_HTTP, QUICKNODE_HTTP, INFURA_HTTP, or RPC_URL");
    return;
  }

  console.log("\n✅ Configuration found:");
  console.log(`   Searcher Key: ${searcherKey.substring(0, 10)}...`);
  console.log(`   RPC URL: ${rpcUrl.substring(0, 50)}...`);

  // Test 1: Basic connectivity
  console.log("\n📡 TEST 1: Testing RPC connectivity...");
  try {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    console.log(`✅ Connected to ${network.name} (Chain ID: ${network.chainId})`);

    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ Current block: ${blockNumber}`);
  } catch (error) {
    console.log(`❌ Connection failed: ${error.message}`);
    return;
  }

  // Test 2: Initialize Marlin Relay
  console.log("\n📡 TEST 2: Testing Marlin Relay initialization...");
  try {
    const marlinRelay = new MarlinRelay({});
    await marlinRelay.initialize(searcherKey);
    console.log("✅ Marlin Relay initialized successfully");
  } catch (error) {
    console.log(`❌ Initialization failed: ${error.message}`);
    return;
  }

  // Test 3: Create a test transaction
  console.log("\n📡 TEST 3: Creating test transaction...");
  try {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`   Your wallet: ${wallet.address}`);

    // Get current balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`   Balance: ${ethers.utils.formatEther(balance)} MATIC`);

    if (balance.eq(0)) {
      console.log("\n⚠️ WARNING: Wallet has 0 MATIC balance");
      console.log("   Transactions require gas fees!");
    }

    // Create a minimal test transaction (to yourself, 0 value)
    const nonce = await provider.getTransactionCount(wallet.address);
    const feeData = await provider.getFeeData();

    const testTx = {
      to: wallet.address, // Send to yourself
      value: 0, // 0 value
      nonce: nonce,
      chainId: 137, // Polygon
      gasLimit: 21000, // Minimum gas for transfer
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      type: 2,
    };

    const signedTx = await wallet.signTransaction(testTx);

    console.log("\n   Created test transaction:");
    console.log(`   - To: ${testTx.to} (yourself)`);
    console.log(`   - Value: 0 MATIC`);
    console.log(`   - Nonce: ${testTx.nonce}`);
    console.log(`   - Gas Limit: ${testTx.gasLimit}`);

    // Test 4: Submit bundle (DRY RUN - comment out for actual submission)
    console.log("\n📡 TEST 4: Testing bundle submission...");
    console.log("   Note: Bundle simulation is not yet supported by Marlin Relay");
    console.log("   ⚠️  DRY RUN MODE - Not actually submitting bundle");
    console.log("   To test actual submission, modify this script");

    // Uncomment below to actually submit (use with caution!)
    /*
    try {
      const result = await marlinRelay.sendBundle([signedTx], targetBlock);
      console.log("✅ Bundle submitted successfully");
      console.log(`   Bundle Hash: ${result.bundleHash || result.result}`);
    } catch (error) {
      console.log(`\n❌ Bundle submission failed: ${error.message}`);
      if (error.message.includes("NETWORK_ERROR")) {
        console.log("   This is a network error - Marlin Relay may be unreachable");
      } else {
        console.log("   This is a bundle validation error");
      }
    }
    */

    console.log("\n✅ All tests completed!");

  } catch (error) {
    console.log(`\n❌ Test failed: ${error.message}`);
    console.log(error.stack);
  }

  console.log("\n" + "=".repeat(60));
  console.log("\n💡 NEXT STEPS:");
  console.log("   - If tests passed: Marlin bundles will work! 🎉");
  console.log("   - If tests failed: Check your MEV_SEARCHER_KEY and RPC configuration");
  console.log("   - To run with bundles: node udmv2.js");
  console.log("\n");
}

testMarlinBundles().catch(console.error);

