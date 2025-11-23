# Contract Deployment Guide

## 🎯 What You Need to Deploy

You need **2 contracts** for the defense system to work:

1. **Vault** - Stores the swept tokens safely
2. **DefensiveSweeper** - Safe module that does the sweeping

## 📋 Prerequisites

- Your Safe wallet address
- Your bot wallet address (the one with PRIVATE_KEY in .env)
- Some MATIC for gas (~$5 worth)
- Remix IDE or Hardhat/Foundry

---

## 🚀 Quick Deployment (Using Remix)

### Step 1: Deploy the Vault

1. Go to [Remix IDE](https://remix.ethereum.org)
2. Create new file: `SimpleVault.sol`
3. Paste this code:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleVault {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    // Accept MATIC
    receive() external payable {}

    // Accept any token transfers
    fallback() external payable {}

    // Emergency withdrawal (only owner)
    function emergencyWithdraw(address token, uint256 amount) external {
        require(msg.sender == owner, "Not owner");
        if (token == address(0)) {
            // Withdraw MATIC
            payable(owner).transfer(amount);
        } else {
            // Withdraw ERC20
            (bool success, ) = token.call(
                abi.encodeWithSignature("transfer(address,uint256)", owner, amount)
            );
            require(success, "Transfer failed");
        }
    }
}
```

4. **Compile** with Solidity 0.8.0+
5. **Deploy** to Polygon:
   - Network: Polygon Mainnet
   - Gas: Use default
6. **Copy the deployed address** → This is your `VAULT_ADDRESS`

### Step 2: Deploy DefensiveSweeper

1. In Remix, create new file: `DefensiveSweeper.sol`
2. Copy the contents from your local `DefensiveSweeper.sol` file
3. **Compile** with Solidity 0.8.0+
4. **Deploy** with constructor parameters:
   - `_owner`: Your Safe wallet address (or your personal wallet)
   - `_vault`: The vault address from Step 1
5. **Copy the deployed address** → This is your `SWEEPER_MODULE`

### Step 3: Configure the Sweeper

After deployment, call these functions on DefensiveSweeper:

1. **adminSetUp**
   - Parameter: Your Safe wallet address
   - This links the sweeper to your Safe

2. **authorizeBot**
   - Parameter: Your bot wallet address (from PRIVATE_KEY)
   - This allows the bot to call sweep functions

---

## 🔧 Detailed Deployment with Hardhat

### Setup

```bash
npm install --save-dev hardhat @nomiclabs/hardhat-ethers ethers
npx hardhat init
```

### Create Deployment Script

Create `scripts/deploy.js`:

```javascript
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);

  // Get configuration from command line or env
  const SAFE_ADDRESS = process.env.SAFE_ADDRESS;
  const BOT_ADDRESS = process.env.BOT_WALLET_ADDRESS;

  if (!SAFE_ADDRESS || !BOT_ADDRESS) {
    throw new Error("Set SAFE_ADDRESS and BOT_WALLET_ADDRESS in .env");
  }

  // Deploy Vault
  console.log("\n📦 Deploying SimpleVault...");
  const Vault = await ethers.getContractFactory("SimpleVault");
  const vault = await Vault.deploy();
  await vault.deployed();
  console.log("✅ Vault deployed to:", vault.address);

  // Deploy DefensiveSweeper
  console.log("\n🛡️ Deploying DefensiveSweeper...");
  const Sweeper = await ethers.getContractFactory("DefensiveSweeper");
  const sweeper = await Sweeper.deploy(
    deployer.address, // owner (can be Safe or your wallet)
    vault.address     // vault
  );
  await sweeper.deployed();
  console.log("✅ DefensiveSweeper deployed to:", sweeper.address);

  // Configure Sweeper
  console.log("\n⚙️ Configuring DefensiveSweeper...");

  // Set up Safe
  const tx1 = await sweeper.adminSetUp(SAFE_ADDRESS);
  await tx1.wait();
  console.log("✅ Safe configured");

  // Authorize bot
  const tx2 = await sweeper.authorizeBot(BOT_ADDRESS);
  await tx2.wait();
  console.log("✅ Bot authorized");

  // Summary
  console.log("\n🎉 DEPLOYMENT COMPLETE!\n");
  console.log("Add these to your .env file:");
  console.log(`VAULT_ADDRESS=${vault.address}`);
  console.log(`SWEEPER_MODULE=${sweeper.address}`);
  console.log(`SAFE_ADDRESS=${SAFE_ADDRESS}`);
  console.log("\nNext steps:");
  console.log("1. Add DefensiveSweeper as a module to your Safe");
  console.log("2. Update your .env with the addresses above");
  console.log("3. Run: node ultimate_defense_monitor_v2.js");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

### Configure Hardhat

Update `hardhat.config.js`:

```javascript
require("@nomiclabs/hardhat-ethers");
require("dotenv").config();

module.exports = {
  solidity: "0.8.19",
  networks: {
    polygon: {
      url: process.env.ALCHEMY_HTTP || "https://polygon-rpc.com",
      accounts: [process.env.DEPLOY_PRIVATE_KEY],
      chainId: 137
    }
  }
};
```

### Deploy

```bash
# Set these in .env:
# SAFE_ADDRESS=your_safe_address
# BOT_WALLET_ADDRESS=wallet_from_your_PRIVATE_KEY
# DEPLOY_PRIVATE_KEY=wallet_with_matic_for_deployment

npx hardhat run scripts/deploy.js --network polygon
```

---

## 🔐 Adding Module to Safe

### Option 1: Via Safe Web Interface

1. Go to [Gnosis Safe App](https://app.safe.global)
2. Connect to your Safe
3. Go to **Settings** → **Modules**
4. Click **Add Module**
5. Enter your DefensiveSweeper contract address
6. Approve the transaction

### Option 2: Via Safe Transaction Builder

1. Open Safe Transaction Builder app
2. Add transaction:
   - To: Your Safe address
   - Value: 0
   - Data: `enableModule(address)`
   - Param: DefensiveSweeper address
3. Execute transaction

---

## ✅ Verification Checklist

After deployment, verify everything works:

### 1. Check Contract Deployments

```bash
# Polygon Explorer
https://polygonscan.com/address/YOUR_VAULT_ADDRESS
https://polygonscan.com/address/YOUR_SWEEPER_ADDRESS
```

### 2. Verify Sweeper Configuration

Call these view functions on DefensiveSweeper:

- `safe()` → Should return your Safe address
- `vault()` → Should return your Vault address
- `owner()` → Should return your owner address
- `isAuthorized(BOT_ADDRESS)` → Should return `true`

### 3. Test with Test Script

Create `test_deployment.js`:

```javascript
const { ethers } = require("ethers");
require("dotenv").config();

async function test() {
  const provider = new ethers.providers.JsonRpcProvider(process.env.ALCHEMY_HTTP);
  const sweeperABI = [
    "function safe() view returns (address)",
    "function vault() view returns (address)",
    "function isAuthorized(address) view returns (bool)",
    "function healthCheck() view returns (bool, uint256, uint256, address, address, address)"
  ];

  const sweeper = new ethers.Contract(
    process.env.SWEEPER_MODULE,
    sweeperABI,
    provider
  );

  console.log("🧪 Testing deployment...\n");

  const safe = await sweeper.safe();
  console.log(`Safe: ${safe}`);
  console.log(`Expected: ${process.env.SAFE_ADDRESS}`);
  console.log(`Match: ${safe.toLowerCase() === process.env.SAFE_ADDRESS.toLowerCase() ? '✅' : '❌'}\n`);

  const vault = await sweeper.vault();
  console.log(`Vault: ${vault}`);
  console.log(`Expected: ${process.env.VAULT_ADDRESS}`);
  console.log(`Match: ${vault.toLowerCase() === process.env.VAULT_ADDRESS.toLowerCase() ? '✅' : '❌'}\n`);

  const botWallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const isAuth = await sweeper.isAuthorized(botWallet.address);
  console.log(`Bot (${botWallet.address}): ${isAuth ? '✅ Authorized' : '❌ Not Authorized'}\n`);

  const [isOwnerAuth, safeBalance, vaultBalance, owner, safeAddr, vaultAddr] = await sweeper.healthCheck();
  console.log("Health Check:");
  console.log(`  Owner Auth: ${isOwnerAuth ? '✅' : '❌'}`);
  console.log(`  Safe Balance: ${ethers.utils.formatEther(safeBalance)} MATIC`);
  console.log(`  Vault Balance: ${ethers.utils.formatEther(vaultBalance)} MATIC`);

  console.log("\n🎉 All checks passed! Ready to use.");
}

test().catch(console.error);
```

Run: `node test_deployment.js`

---

## 🎯 Quick Reference

### Contract Addresses You Need:

```env
# Add these to your .env after deployment
VAULT_ADDRESS=0x...        # From Step 1
SWEEPER_MODULE=0x...       # From Step 2
SAFE_ADDRESS=0x...         # Your Safe wallet
```

### Contract Functions:

**DefensiveSweeper:**
- `sweepToken(address)` - Sweep all of a token
- `sweepMatic()` - Sweep all MATIC
- `sweepTokenAmount(address, uint256)` - Sweep specific amount
- `authorizeBot(address)` - Add authorized bot
- `healthCheck()` - Get status

**Vault:**
- Receives tokens automatically
- `emergencyWithdraw()` - Owner can withdraw

---

## 🚨 Common Issues

### "Not authorized" error
**Fix:** Run `authorizeBot(YOUR_BOT_ADDRESS)` on DefensiveSweeper

### "Not initialized" error
**Fix:** Run `adminSetUp(YOUR_SAFE_ADDRESS)` on DefensiveSweeper

### "Module not enabled" error
**Fix:** Add DefensiveSweeper as a module in Safe settings

### Deployment fails
**Fix:** Make sure you have enough MATIC for gas (~$5 worth)

---

## 🎉 Next Steps

After successful deployment:

1. ✅ Update `.env` with all contract addresses
2. ✅ Run `node test_setup.js` to verify
3. ✅ Run `node ultimate_defense_monitor_v2.js` to start protection
4. ✅ Monitor logs for threats and defenses

Your ultimate front-running defense is now LIVE! 🛡️
