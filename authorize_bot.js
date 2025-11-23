/**
 * Authorize Bot Script
 *
 * Automatically calls authorizeBot on DefensiveSweeper
 * to authorize your bot wallet to call sweep functions.
 *
 * Usage: node authorize_bot.js
 */

const { ethers } = require("ethers");
require("dotenv").config();

const SWEEPER_ABI = [
  "function authorizeBot(address bot) external",
  "function isAuthorized(address user) external view returns (bool)",
  "function owner() external view returns (address)",
];

async function main() {
  console.log("🤖 Authorizing Bot on DefensiveSweeper...\n");

  // Check environment
  if (!process.env.SWEEPER_MODULE) {
    console.error("❌ SWEEPER_MODULE not set in .env");
    console.log("\nAdd this to your .env:");
    console.log("SWEEPER_MODULE=0xYourSweeperContractAddress");
    process.exit(1);
  }

  if (!process.env.PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const rpcUrl = process.env.ALCHEMY_HTTP || process.env.RPC_URL;
  if (!rpcUrl) {
    console.error("❌ No RPC URL found in .env");
    console.log("\nSet either ALCHEMY_HTTP or RPC_URL");
    process.exit(1);
  }

  try {
    // Connect to network
    console.log("📡 Connecting to Polygon...");
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    // Create wallets
    const botWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`✅ Bot wallet: ${botWallet.address}`);

    // Check balance
    const balance = await provider.getBalance(botWallet.address);
    console.log(`   Balance: ${ethers.utils.formatEther(balance)} MATIC`);

    if (balance.lt(ethers.utils.parseEther("0.01"))) {
      console.error("\n❌ Bot wallet has insufficient MATIC for gas");
      console.log("   Send at least 0.01 MATIC to this address");
      process.exit(1);
    }

    // Connect to DefensiveSweeper
    const sweeper = new ethers.Contract(
      process.env.SWEEPER_MODULE,
      SWEEPER_ABI,
      botWallet
    );

    // Check owner
    console.log("\n🔍 Checking DefensiveSweeper...");
    const owner = await sweeper.owner();
    console.log(`   Owner: ${owner}`);

    // Check if you're the owner
    if (owner.toLowerCase() !== botWallet.address.toLowerCase()) {
      console.log("\n⚠️  NOTE: You are NOT the owner of DefensiveSweeper");
      console.log(`   Owner is: ${owner}`);
      console.log(`   You are: ${botWallet.address}`);
      console.log("\n   The owner needs to call authorizeBot.");
      console.log("\n   Options:");
      console.log("   1. Connect with the owner's wallet to Remix");
      console.log("   2. Or update PRIVATE_KEY to the owner's key temporarily");
      process.exit(1);
    }

    console.log("   ✅ You are the owner");

    // Check if already authorized
    const isAuth = await sweeper.isAuthorized(botWallet.address);
    if (isAuth) {
      console.log("\n✅ Bot is ALREADY authorized!");
      console.log("   No action needed.");
      return;
    }

    console.log("\n⚠️  Bot is NOT authorized yet");
    console.log("\n🚀 Calling authorizeBot...");

    // Call authorizeBot
    const tx = await sweeper.authorizeBot(botWallet.address, {
      gasLimit: 100000,
    });

    console.log(`   Transaction sent: ${tx.hash}`);
    console.log("   Waiting for confirmation...");

    const receipt = await tx.wait();

    if (receipt.status === 1) {
      console.log(`\n✅ SUCCESS! Bot authorized in block ${receipt.blockNumber}`);
      console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

      // Verify
      const isAuthNow = await sweeper.isAuthorized(botWallet.address);
      console.log(`\n🔍 Verification: ${isAuthNow ? "✅ Authorized" : "❌ Failed"}`);

      if (isAuthNow) {
        console.log("\n🎉 Bot is now authorized to call sweep functions!");
        console.log("\n📋 Next steps:");
        console.log("   1. Run: node verify_deployment.js");
        console.log("   2. Then run: node ultimate_defense_monitor_v2.js");
      }
    } else {
      console.error("\n❌ Transaction failed");
    }

  } catch (error) {
    console.error("\n❌ Error:", error.message);

    if (error.message.includes("Not owner")) {
      console.log("\n💡 You need to use the owner's wallet to authorize the bot");
      console.log("   Owner address is shown above");
    }

    process.exit(1);
  }
}

main().catch(console.error);
