const { ethers } = require("ethers");
require("dotenv").config();

/**
 * Test Alchemy Bundle API
 *
 * This script tests if your Alchemy API key has bundle/private transaction access
 */

async function testAlchemyBundles() {
  console.log("🧪 ALCHEMY BUNDLE API TEST\n");
  console.log("=" .repeat(60));

  // Check environment variables
  const alchemyApiKey = process.env.ALCHEMY_API_KEY;
  const alchemyHttp = process.env.ALCHEMY_HTTP;
  const privateKey = process.env.PRIVATE_KEY;

  if (!alchemyApiKey) {
    console.log("❌ ALCHEMY_API_KEY not found in .env");
    console.log("\n💡 Add to your .env file:");
    console.log("   ALCHEMY_API_KEY=your_api_key_here");
    return;
  }

  if (!alchemyHttp) {
    console.log("⚠️ ALCHEMY_HTTP not found, using default Polygon endpoint");
  }

  if (!privateKey) {
    console.log("❌ PRIVATE_KEY not found in .env");
    return;
  }

  console.log("\n✅ Configuration found:");
  console.log(`   API Key: ${alchemyApiKey.substring(0, 10)}...`);

  const alchemyUrl = alchemyHttp || `https://polygon-mainnet.g.alchemy.com/v2/${alchemyApiKey}`;
  console.log(`   URL: ${alchemyUrl.substring(0, 50)}...`);

  // Test 1: Basic connectivity
  console.log("\n📡 TEST 1: Testing basic Alchemy connectivity...");
  try {
    const provider = new ethers.providers.JsonRpcProvider(alchemyUrl);
    const network = await provider.getNetwork();
    console.log(`✅ Connected to ${network.name} (Chain ID: ${network.chainId})`);

    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ Current block: ${blockNumber}`);
  } catch (error) {
    console.log(`❌ Connection failed: ${error.message}`);
    return;
  }

  // Test 2: Check if private transaction endpoint is available
  console.log("\n📡 TEST 2: Testing private transaction API availability...");

  try {
    const axios = require("axios");

    // Create a test provider and wallet
    const provider = new ethers.providers.JsonRpcProvider(alchemyUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`   Your wallet: ${wallet.address}`);

    // Get current balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`   Balance: ${ethers.utils.formatEther(balance)} MATIC`);

    if (balance.eq(0)) {
      console.log("\n⚠️ WARNING: Wallet has 0 MATIC balance");
      console.log("   Private transactions still require gas fees!");
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

    console.log("\n   Testing eth_sendPrivateTransaction endpoint...");

    // Try to send via private transaction API
    const response = await axios.post(alchemyUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendPrivateTransaction",
      params: [
        {
          tx: signedTx,
          maxBlockNumber: null,
          preferences: {
            fast: true
          }
        }
      ]
    }, {
      headers: {
        "Content-Type": "application/json"
      },
      timeout: 10000
    });

    if (response.data.error) {
      console.log(`\n❌ Private transaction API returned error:`);
      console.log(`   ${JSON.stringify(response.data.error, null, 2)}`);

      if (response.data.error.message.includes("not supported") ||
          response.data.error.message.includes("not available")) {
        console.log("\n⚠️ DIAGNOSIS: Your Alchemy plan may not include private transactions");
        console.log("\n💡 SOLUTIONS:");
        console.log("   1. Upgrade to Alchemy Growth plan (includes private transactions)");
        console.log("   2. Contact Alchemy support to enable private transactions");
        console.log("   3. Use without MEV bundles (pre-signed pool + shotgun still works)");
      }
    } else {
      console.log(`\n✅ PRIVATE TRANSACTION API WORKS!`);
      console.log(`   Response: ${JSON.stringify(response.data.result, null, 2)}`);
      console.log(`\n🎉 Your Alchemy API key supports MEV bundle protection!`);
    }

  } catch (error) {
    if (error.response) {
      console.log(`\n❌ API Error (${error.response.status}):`);
      console.log(`   ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.log(`\n❌ Request failed: ${error.message}`);
    }

    console.log("\n💡 Common issues:");
    console.log("   - Private transactions require Alchemy Growth plan or higher");
    console.log("   - Some Alchemy keys don't have this feature enabled");
    console.log("   - Check your Alchemy dashboard for plan details");
  }

  console.log("\n" + "=".repeat(60));
  console.log("\n💡 NEXT STEPS:");
  console.log("   - If test passed: MEV bundles will work! 🎉");
  console.log("   - If test failed: System will use pre-signed pool + shotgun (still very fast)");
  console.log("   - To run with bundles: node udmv2.js");
  console.log("\n");
}

testAlchemyBundles().catch(console.error);
