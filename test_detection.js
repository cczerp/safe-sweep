const { ethers } = require("ethers");
require("dotenv").config();

/**
 * Test Detection Logic
 *
 * This script tests if the threat detection can properly identify
 * a transferFrom attack by parsing real transaction data.
 */

// Simulate a transferFrom transaction
function createMockTransferFromTx(fromAddress, toAddress, tokenContract) {
  // transferFrom(address from, address to, uint256 amount)
  // Function signature: 0x23b872dd

  const amount = ethers.utils.parseUnits("100", 6); // 100 USDT

  // Encode the parameters (padded to 32 bytes each)
  const fromParam = ethers.utils.hexZeroPad(fromAddress, 32);
  const toParam = ethers.utils.hexZeroPad(toAddress, 32);
  const amountParam = ethers.utils.hexZeroPad(amount.toHexString(), 32);

  const data = "0x23b872dd" + fromParam.slice(2) + toParam.slice(2) + amountParam.slice(2);

  return {
    hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    from: "0xAttackerWalletAddress123456789012345678901234",
    to: tokenContract,
    data: data,
    value: ethers.BigNumber.from(0),
  };
}

// Detection function (copied from ultimate_defense_monitor_v2.js)
function detectThreat(tx, safeAddress) {
  if (!tx) return null;

  const safeAddr = safeAddress.toLowerCase();

  // Threat Type 3: ERC20 transferFrom stealing from our Safe
  if (tx.data && tx.data.length >= 138) {
    const functionSig = tx.data.slice(0, 10);

    // transferFrom(address from, address to, uint256 amount)
    if (functionSig === "0x23b872dd") {
      // Extract 'from' address (first parameter, bytes 10-74)
      const fromParam = "0x" + tx.data.slice(34, 74);
      const fromAddress = ethers.utils.getAddress("0x" + fromParam.slice(26));

      if (fromAddress.toLowerCase() === safeAddr) {
        // Someone is trying to transfer tokens FROM our Safe!
        return {
          isThreat: true,
          type: "ERC20_TRANSFERFROM_ATTACK",
          severity: "CRITICAL",
          asset: "USDT",
          attackerTx: tx,
        };
      }
    }
  }

  return null;
}

async function main() {
  const safeAddress = process.env.SAFE_ADDRESS;
  const usdtContract = process.env.USDT_CONTRACT;

  if (!safeAddress || !usdtContract) {
    console.error("❌ Missing SAFE_ADDRESS or USDT_CONTRACT in .env");
    process.exit(1);
  }

  console.log("🧪 Testing Threat Detection Logic\n");
  console.log(`Safe Address: ${safeAddress}`);
  console.log(`USDT Contract: ${usdtContract}\n`);

  // Create a mock transferFrom transaction
  const attackerAddress = "0x1234567890123456789012345678901234567890";
  const mockTx = createMockTransferFromTx(safeAddress, attackerAddress, usdtContract);

  console.log("📝 Mock Transaction:");
  console.log(`   From: ${mockTx.from} (attacker wallet)`);
  console.log(`   To: ${mockTx.to} (USDT contract)`);
  console.log(`   Data: ${mockTx.data.slice(0, 66)}...`);
  console.log(`   Function: transferFrom()`);
  console.log(`   Stealing from: ${safeAddress}\n`);

  // Test detection
  const threat = detectThreat(mockTx, safeAddress);

  if (threat) {
    console.log("✅ DETECTION WORKS!");
    console.log(`   Type: ${threat.type}`);
    console.log(`   Severity: ${threat.severity}`);
    console.log(`   Asset: ${threat.asset}`);
  } else {
    console.log("❌ DETECTION FAILED!");
    console.log("   The threat was not detected.");
  }

  console.log("\n🔍 Now test with a REAL transaction:");
  console.log("   1. Get the transaction hash from PolygonScan");
  console.log("   2. Run: node test_detection.js <tx_hash>");
  console.log("   3. This will fetch and test the real transaction\n");

  // If tx hash provided, test it
  if (process.argv[2]) {
    console.log(`\n📡 Fetching real transaction: ${process.argv[2]}\n`);

    const provider = new ethers.providers.JsonRpcProvider(process.env.ALCHEMY_HTTP);
    const realTx = await provider.getTransaction(process.argv[2]);

    if (!realTx) {
      console.error("❌ Transaction not found");
      return;
    }

    console.log("📝 Real Transaction:");
    console.log(`   From: ${realTx.from}`);
    console.log(`   To: ${realTx.to}`);
    console.log(`   Data: ${realTx.data?.slice(0, 66)}...`);

    const realThreat = detectThreat(realTx, safeAddress);

    if (realThreat) {
      console.log("\n✅ REAL TRANSACTION WOULD BE DETECTED!");
      console.log(`   Type: ${realThreat.type}`);
      console.log(`   Severity: ${realThreat.severity}`);
    } else {
      console.log("\n❌ REAL TRANSACTION NOT DETECTED");
      console.log("   This explains why your test transfer wasn't caught");

      // Debug the transaction
      if (realTx.data) {
        const funcSig = realTx.data.slice(0, 10);
        console.log(`\n🔍 Debug Info:`);
        console.log(`   Function signature: ${funcSig}`);
        console.log(`   Expected: 0x23b872dd (transferFrom)`);
        console.log(`   Data length: ${realTx.data.length}`);

        if (funcSig === "0x23b872dd") {
          const fromParam = "0x" + realTx.data.slice(34, 74);
          const fromAddress = ethers.utils.getAddress("0x" + fromParam.slice(26));
          console.log(`   From address in data: ${fromAddress}`);
          console.log(`   Your Safe: ${safeAddress}`);
          console.log(`   Match: ${fromAddress.toLowerCase() === safeAddress.toLowerCase()}`);
        }
      }
    }
  }
}

main().catch(console.error);
