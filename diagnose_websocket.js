/**
 * WebSocket Connection Diagnostic Tool
 *
 * This will test each WebSocket URL and tell you EXACTLY what's wrong
 */

const { ethers } = require("ethers");
const WebSocket = require("ws");
require("dotenv").config();

console.log("🔍 WebSocket Connection Diagnostics\n");
console.log("=" .repeat(60));

// Collect all potential WebSocket URLs
const wsEndpoints = [
  { name: "ALCHEMY_WSS", url: process.env.ALCHEMY_WSS },
  { name: "QUICKNODE_WSS", url: process.env.QUICKNODE_WSS },
  { name: "INFURA_WSS", url: process.env.INFURA_WSS },
];

// Also check for backup endpoints
for (let i = 1; i <= 5; i++) {
  const backupUrl = process.env[`BACKUP_WSS_${i}`];
  if (backupUrl) {
    wsEndpoints.push({ name: `BACKUP_WSS_${i}`, url: backupUrl });
  }
}

async function testWebSocketEndpoint(name, url) {
  console.log(`\n📡 Testing: ${name}`);
  console.log(`   URL: ${url ? url.substring(0, 60) + "..." : "NOT SET"}`);

  if (!url) {
    console.log("   ❌ RESULT: Not configured in .env");
    return false;
  }

  // Check 1: URL format
  if (!url.startsWith("wss://") && !url.startsWith("ws://")) {
    console.log(`   ❌ RESULT: Invalid format - must start with wss:// or ws://`);
    console.log(`   💡 FIX: Change https:// to wss:// in your .env file`);
    return false;
  }

  // Check 2: Test with ethers.js WebSocketProvider
  console.log("   🔄 Testing with ethers.js WebSocketProvider...");
  try {
    const provider = new ethers.providers.WebSocketProvider(url);

    // Set up timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Connection timeout (10s)")), 10000);
    });

    // Try to get network info
    const networkPromise = provider.getNetwork();
    const network = await Promise.race([networkPromise, timeoutPromise]);

    console.log(`   ✅ RESULT: Connected successfully!`);
    console.log(`   ℹ️  Network: ${network.name} (Chain ID: ${network.chainId})`);

    provider.destroy();
    return true;
  } catch (error) {
    console.log(`   ❌ RESULT: Connection failed`);
    console.log(`   ℹ️  Error: ${error.message}`);

    // Diagnose the specific error
    if (error.message.includes("404")) {
      console.log(`   💡 FIX: Your API key is invalid or the endpoint doesn't exist`);
      console.log(`      - Check that your API key is correct`);
      console.log(`      - Verify the endpoint URL in your provider's dashboard`);
      console.log(`      - Make sure WebSocket access is enabled for your API key`);
    } else if (error.message.includes("401") || error.message.includes("403")) {
      console.log(`   💡 FIX: Authentication failed`);
      console.log(`      - Your API key is invalid or expired`);
      console.log(`      - Generate a new API key from your provider`);
    } else if (error.message.includes("timeout")) {
      console.log(`   💡 FIX: Connection is too slow or blocked`);
      console.log(`      - Check your firewall settings`);
      console.log(`      - Try a different network`);
    } else if (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED")) {
      console.log(`   💡 FIX: Cannot reach the server`);
      console.log(`      - Check your internet connection`);
      console.log(`      - Verify the URL is correct`);
    }

    return false;
  }
}

// Check 3: Test raw WebSocket connection (for BloxRoute)
async function testRawWebSocket() {
  console.log(`\n📡 Testing: BloxRoute (Raw WebSocket)`);

  const bloxrouteHeader = process.env.BLOXROUTE_HEADER;
  if (!bloxrouteHeader) {
    console.log("   ⚠️  BLOXROUTE_HEADER not set (optional for Polygon)");
    return false;
  }

  return new Promise((resolve) => {
    try {
      console.log(`   🔄 Connecting to wss://api.blxrbdn.com/ws...`);

      const ws = new WebSocket("wss://api.blxrbdn.com/ws", {
        headers: { Authorization: bloxrouteHeader },
      });

      const timeout = setTimeout(() => {
        ws.terminate();
        console.log("   ❌ RESULT: Connection timeout");
        resolve(false);
      }, 10000);

      ws.on("open", () => {
        clearTimeout(timeout);
        console.log("   ✅ RESULT: BloxRoute connected!");
        ws.close();
        resolve(true);
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        console.log(`   ❌ RESULT: ${error.message}`);
        console.log(`   💡 FIX: Check your BLOXROUTE_HEADER in .env`);
        resolve(false);
      });
    } catch (error) {
      console.log(`   ❌ RESULT: ${error.message}`);
      resolve(false);
    }
  });
}

async function main() {
  let successCount = 0;
  let totalTested = 0;

  // Test all ethers.js WebSocket endpoints
  for (const endpoint of wsEndpoints) {
    if (endpoint.url) {
      totalTested++;
      const success = await testWebSocketEndpoint(endpoint.name, endpoint.url);
      if (success) successCount++;
    }
  }

  // Test BloxRoute
  await testRawWebSocket();

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 SUMMARY");
  console.log("=".repeat(60));
  console.log(`   Working WebSocket endpoints: ${successCount}/${totalTested}`);

  if (successCount === 0) {
    console.log("\n❌ NO WORKING WEBSOCKET CONNECTIONS FOUND!");
    console.log("\n🔧 IMMEDIATE ACTIONS NEEDED:");
    console.log("   1. Get a FREE API key from Alchemy: https://www.alchemy.com/");
    console.log("   2. Create a Polygon Mainnet app in the dashboard");
    console.log("   3. Copy the WebSocket URL (should start with wss://)");
    console.log("   4. Update your .env file:");
    console.log("      ALCHEMY_WSS=wss://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY");
    console.log("\n⚠️  WITHOUT WebSocket, you CANNOT monitor mempool in real-time!");
  } else if (successCount < totalTested) {
    console.log(`\n⚠️  Some endpoints failed. Fix the issues above for 100% coverage.`);
  } else {
    console.log("\n✅ ALL WEBSOCKET CONNECTIONS WORKING!");
    console.log("   Your setup is ready for real-time mempool monitoring.");
  }

  console.log("\n" + "=".repeat(60));
}

main().catch(console.error);
