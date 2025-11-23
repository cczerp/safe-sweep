# How to Authorize Your Bot - Step by Step

## 🎯 What is This?

After deploying DefensiveSweeper, you need to authorize your bot wallet so it can call the sweep functions. This is a one-time setup.

---

## 🚀 Option 1: Automatic (Easiest)

### Step 1: Get your bot address

```bash
node get_bot_address.js
```

This will show you:
- Your bot wallet address (from PRIVATE_KEY)
- Your bot's MATIC balance
- Next steps

### Step 2: Run the authorization script

```bash
node authorize_bot.js
```

This will:
- Check if you're the owner
- Call `authorizeBot` for you
- Verify it worked

**That's it!** ✅

---

## 🔧 Option 2: Manual (Using Remix)

### Step 1: Get your bot address

```bash
node get_bot_address.js
```

**Copy the address shown** - you'll need it in Step 4.

### Step 2: Open Remix

1. Go to https://remix.ethereum.org
2. Click **"Deploy & Run Transactions"** (left sidebar)
3. In **Environment**, select **"Injected Provider - MetaMask"**
4. Connect your wallet (must be the DefensiveSweeper owner)
5. Make sure you're on **Polygon network** in MetaMask

### Step 3: Load DefensiveSweeper

1. In **"At Address"** field, paste your DefensiveSweeper contract address
   - Get this from `.env` → `SWEEPER_MODULE`
2. Click **"At Address"** button
3. The contract should appear below

### Step 4: Call authorizeBot

1. Find the **`authorizeBot`** function (orange button)
2. Click to expand it
3. In the `bot` field, paste your bot address from Step 1
4. Click **"transact"**
5. Confirm in MetaMask

### Step 5: Verify

1. Find the **`isAuthorized`** function (blue button)
2. Paste your bot address
3. Click **"call"**
4. Should return: `true` ✅

---

## 🚨 Common Issues

### Issue: "Not owner" error

**Problem:** You're trying to authorize but you're not the contract owner.

**Solution:**
```bash
# Check who the owner is
node -e "
const { ethers } = require('ethers');
const p = new ethers.providers.JsonRpcProvider(process.env.ALCHEMY_HTTP);
const c = new ethers.Contract(
  process.env.SWEEPER_MODULE,
  ['function owner() view returns (address)'],
  p
);
c.owner().then(console.log);
"
```

Then connect to Remix with that owner's wallet.

### Issue: "Insufficient funds for gas"

**Problem:** Your wallet has no MATIC.

**Solution:** Send ~0.1 MATIC to your wallet address.

### Issue: Wrong network

**Problem:** MetaMask is on wrong network.

**Solution:** Switch MetaMask to **Polygon Mainnet**
- Network name: Polygon Mainnet
- RPC URL: https://polygon-rpc.com
- Chain ID: 137
- Symbol: MATIC

### Issue: Can't find contract in Remix

**Problem:** Contract address not loading.

**Solution:**
1. Make sure address is correct (from `SWEEPER_MODULE` in .env)
2. Make sure you're on Polygon network
3. Try refreshing Remix

---

## ✅ How to Verify It Worked

### Method 1: Using the script

```bash
node verify_deployment.js
```

Look for:
```
✅ Bot is authorized to call sweeper
```

### Method 2: Using Remix

Call `isAuthorized(yourBotAddress)` - should return `true`

### Method 3: Manual check

```bash
node -e "
const { ethers } = require('ethers');
const p = new ethers.providers.JsonRpcProvider(process.env.ALCHEMY_HTTP);
const w = new ethers.Wallet(process.env.PRIVATE_KEY);
const c = new ethers.Contract(
  process.env.SWEEPER_MODULE,
  ['function isAuthorized(address) view returns (bool)'],
  p
);
c.isAuthorized(w.address).then(r => console.log('Authorized:', r));
"
```

Should show: `Authorized: true`

---

## 📋 Complete Checklist

Before running the defense system, make sure:

- [ ] DefensiveSweeper deployed
- [ ] SimpleVault deployed
- [ ] DefensiveSweeper configured (adminSetUp called)
- [ ] **Bot authorized** ← You are here!
- [ ] DefensiveSweeper added as Safe module
- [ ] Bot wallet has MATIC for gas
- [ ] All addresses in .env

Once all checked, run:
```bash
node ultimate_defense_monitor_v2.js
```

---

## 🆘 Still Stuck?

Run this diagnostic:

```bash
node -p "
const { ethers } = require('ethers');
const w = new ethers.Wallet(process.env.PRIVATE_KEY);
console.log('Bot Address:', w.address);
console.log('Sweeper Module:', process.env.SWEEPER_MODULE);
console.log('Have both? Ready to authorize!');
"
```

Or just show me the error message and I'll help! 😊
