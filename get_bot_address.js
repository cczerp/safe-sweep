/**
 * Get Bot Wallet Address
 *
 * This script shows you the wallet address derived from your PRIVATE_KEY
 * This is the address you need to authorize on DefensiveSweeper
 *
 * Usage: node get_bot_address.js
 */

const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  console.log("🔑 Getting Bot Wallet Address...\n");

  if (!process.env.PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY not found in .env");
    console.log("\nAdd this to your .env file:");
    console.log("PRIVATE_KEY=your_private_key_here");
    process.exit(1);
  }

  try {
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);

    console.log("✅ Bot Wallet Address:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(wallet.address);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    console.log("\n📋 Next Steps:");
    console.log("\n1. Copy the address above");
    console.log("\n2. Go to Remix IDE (https://remix.ethereum.org)");
    console.log("\n3. Connect to Polygon network");
    console.log("\n4. Load your DefensiveSweeper contract at:");
    console.log(`   ${process.env.SWEEPER_MODULE || "[Set SWEEPER_MODULE in .env]"}`);
    console.log("\n5. Call the 'authorizeBot' function with:");
    console.log(`   bot: ${wallet.address}`);
    console.log("\n6. Confirm the transaction");
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Also check if wallet has balance
    if (process.env.ALCHEMY_HTTP || process.env.RPC_URL) {
      const provider = new ethers.providers.JsonRpcProvider(
        process.env.ALCHEMY_HTTP || process.env.RPC_URL
      );

      const balance = await provider.getBalance(wallet.address);
      const maticBalance = parseFloat(ethers.utils.formatEther(balance));

      console.log("\n💰 Bot Wallet Balance:");
      console.log(`   ${maticBalance.toFixed(4)} MATIC`);

      if (maticBalance < 0.1) {
        console.log("\n⚠️  WARNING: Low balance!");
        console.log("   Send at least 0.1 MATIC to this address for gas fees");
      } else {
        console.log("   ✅ Sufficient balance for gas");
      }
    }

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

main().catch(console.error);
