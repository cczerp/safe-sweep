# SafetyTimerModule - Deployment & Integration Guide

## 🎯 Overview

The **SafetyTimerModule** is your "holy grail" security layer that acts as both a Safe Module and Transaction Guard. It intercepts EVERY transaction from your Safe and applies intelligent security rules.

### Key Features

1. **Immediate Execution** - Safe owners and designated controllers bypass all checks
2. **Timelock Queue** - Unauthorized transactions are delayed 24 hours for review
3. **Malicious Attempt Detection** - Auto-detects attackers with token approvals
4. **Auto-Sweep** - Automatically sweeps tokens to vault when threats detected
5. **Blacklisting** - Auto-blacklists addresses after 3 malicious attempts
6. **Emergency Mode** - Can lock down ALL transactions except owners

## 🔒 Security Model

### Transaction Flow

```
Transaction Initiated
        ↓
Is initiator Safe Owner/Controller?
        ↓ NO
Is address blacklisted?
        ↓ NO
Is this a token transfer?
        ↓ YES
Does initiator have token approval?
        ↓ YES (MALICIOUS!)
        ↓
BLOCK + SWEEP TOKENS TO VAULT
```

### Three Types of Callers

1. **Authorized** (Safe owners + controllers)
   - ✅ Execute immediately
   - ✅ Bypass all checks

2. **Unauthorized** (Unknown addresses)
   - ⏰ Queued for timelock approval
   - 📋 Must wait 24 hours OR get owner approval

3. **Malicious** (Has approval but not permission)
   - ❌ Transaction DROPPED
   - 🚨 Tokens AUTO-SWEPT to vault
   - 🚫 Address blacklisted after 3 attempts

## 📦 Deployment

### Step 1: Deploy SafetyTimerModule

```javascript
const { ethers } = require('ethers');
require('dotenv').config();

async function deploySafetyTimer() {
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    // Contract ABI
    const abi = [...]; // See below

    // Bytecode
    const bytecode = "..."; // Compile SafetyTimerModule.sol

    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    console.log("Deploying SafetyTimerModule...");
    const safetyTimer = await factory.deploy(
        process.env.OWNER_ADDRESS,  // Your address
        process.env.VAULT_ADDRESS   // Your vault address
    );

    await safetyTimer.deployed();
    console.log("SafetyTimerModule deployed at:", safetyTimer.address);

    return safetyTimer.address;
}

deploySafetyTimer();
```

### Step 2: Enable as Safe Module

```javascript
const Safe = require('@safe-global/safe-core-sdk').default;
const { EthersAdapter } = require('@safe-global/safe-ethers-lib');

async function enableSafetyTimer() {
    const ethAdapter = new EthersAdapter({
        ethers,
        signerOrProvider: wallet
    });

    const safeSdk = await Safe.create({
        ethAdapter,
        safeAddress: process.env.SAFE_ADDRESS
    });

    // Enable module
    const tx = await safeSdk.createEnableModuleTx(
        process.env.SAFETY_TIMER_ADDRESS
    );

    const executeTx = await safeSdk.executeTransaction(tx);
    await executeTx.transactionResponse.wait();

    console.log("SafetyTimer module enabled!");
}
```

### Step 3: Set as Transaction Guard

This is **CRITICAL** - the module must be set as a guard to intercept transactions!

```javascript
async function setAsGuard() {
    const safeSdk = await Safe.create({
        ethAdapter,
        safeAddress: process.env.SAFE_ADDRESS
    });

    // Set guard using Safe contract directly
    const safeContract = new ethers.Contract(
        process.env.SAFE_ADDRESS,
        [
            'function setGuard(address guard) external'
        ],
        wallet
    );

    // Create Safe transaction to set guard
    const safeTransaction = await safeSdk.createTransaction({
        to: process.env.SAFE_ADDRESS,
        value: '0',
        data: safeContract.interface.encodeFunctionData('setGuard', [
            process.env.SAFETY_TIMER_ADDRESS
        ])
    });

    const executeTx = await safeSdk.executeTransaction(safeTransaction);
    await executeTx.transactionResponse.wait();

    console.log("SafetyTimer set as guard! All transactions now protected!");
}
```

## 🎮 Usage

### Add Controllers

Controllers are trusted addresses that bypass all checks (like bot addresses).

```javascript
const safetyTimer = new ethers.Contract(
    process.env.SAFETY_TIMER_ADDRESS,
    abi,
    wallet
);

// Add your bot as controller
await safetyTimer.addController(process.env.BOT_ADDRESS);
console.log("Bot added as controller");
```

### Add Protected Tokens

Mark which tokens should be monitored:

```javascript
// Add USDT as protected
await safetyTimer.addProtectedToken('0xc2132D05D31c914a87C6611C10748AEb04B58e8F');

// Add USDC as protected
await safetyTimer.addProtectedToken('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174');

console.log("Tokens now protected!");
```

### Configure Timelock

```javascript
// Set timelock to 48 hours (default is 24)
await safetyTimer.setTimelockDelay(48 * 60 * 60);

console.log("Timelock delay updated to 48 hours");
```

### Monitor Pending Transactions

```javascript
async function checkPendingTxs() {
    const count = await safetyTimer.getPendingTransactionCount();
    console.log(`Pending transactions: ${count}`);

    if (count > 0) {
        const hashes = await safetyTimer.getPendingTransactions();

        for (const hash of hashes) {
            const tx = await safetyTimer.pendingTxs(hash);
            console.log(`
Transaction: ${hash}
Initiator: ${tx.initiator}
To: ${tx.to}
Value: ${ethers.utils.formatEther(tx.value)} MATIC
Queued: ${new Date(tx.queuedAt * 1000)}
Executable: ${new Date(tx.executableAt * 1000)}
Reason: ${tx.reason}
            `);
        }
    }
}
```

### Approve Pending Transaction

```javascript
async function approveTransaction(txHash) {
    // Approve immediately (bypasses timelock)
    await safetyTimer.approvePendingTransaction(txHash);
    console.log("Transaction approved - can execute now");

    // Execute it
    await safetyTimer.executePendingTransaction(txHash);
    console.log("Transaction executed!");
}
```

### Reject Malicious Transaction

```javascript
async function rejectTransaction(txHash) {
    await safetyTimer.rejectPendingTransaction(
        txHash,
        "Suspicious transaction from unknown source"
    );
    console.log("Transaction rejected");
}
```

### Emergency Sweep

```javascript
async function emergencySweep() {
    // Sweep all protected tokens to vault
    await safetyTimer.emergencySweepAllProtectedTokens();
    console.log("All tokens swept to vault!");

    // Or sweep specific token
    await safetyTimer.emergencySweepToken('0xc2132D05D31c914a87C6611C10748AEb04B58e8F');
}
```

### Enable Emergency Mode

```javascript
// Block ALL transactions except from owners
await safetyTimer.setEmergencyMode(true);
console.log("Emergency mode enabled - all transactions blocked!");

// Disable when safe
await safetyTimer.setEmergencyMode(false);
```

### Check Blacklisted Addresses

```javascript
async function checkAddress(addr) {
    const [isBlacklisted, attempts] = await safetyTimer.getBlacklistedStatus(addr);

    console.log(`
Address: ${addr}
Blacklisted: ${isBlacklisted}
Malicious Attempts: ${attempts}
    `);
}
```

## 🚨 Auto-Sweep Scenarios

The module will **automatically sweep tokens** in these cases:

1. **Malicious Approval Attempt**
   - Someone has token approval (via previous `approve()` call)
   - They try to transfer tokens but aren't Safe owner/controller
   - Transaction BLOCKED + tokens swept

2. **Blacklisted Address**
   - Address was previously blacklisted
   - They attempt any transaction
   - Transaction BLOCKED + tokens swept

3. **Multiple Attempts**
   - After 3 malicious attempts, auto-blacklisted
   - All future transactions blocked

## 📊 Monitoring Script

Create `monitor_safety_timer.js`:

```javascript
const { ethers } = require('ethers');
require('dotenv').config();

const ABI = [...]; // SafetyTimerModule ABI

async function monitorSafetyTimer() {
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
    const safetyTimer = new ethers.Contract(
        process.env.SAFETY_TIMER_ADDRESS,
        ABI,
        provider
    );

    console.log("🔒 Monitoring SafetyTimer...\n");

    // Listen for malicious attempts
    safetyTimer.on('MaliciousAttemptDetected', async (attacker, token, amount, event) => {
        console.log(`
🚨 MALICIOUS ATTEMPT DETECTED!
Attacker: ${attacker}
Token: ${token}
Block: ${event.blockNumber}
        `);

        // Alert via Telegram/Discord/Email
        await sendAlert(`Malicious attempt from ${attacker}`);
    });

    // Listen for token sweeps
    safetyTimer.on('TokensSwept', async (token, amount, vault, reason, event) => {
        console.log(`
✅ TOKENS SWEPT TO SAFETY
Token: ${token}
Amount: ${ethers.utils.formatUnits(amount, 6)}
Reason: ${reason}
Block: ${event.blockNumber}
        `);
    });

    // Listen for queued transactions
    safetyTimer.on('TransactionQueued', async (txHash, initiator, to, value, reason) => {
        console.log(`
⏰ TRANSACTION QUEUED
Hash: ${txHash}
Initiator: ${initiator}
Reason: ${reason}
        `);

        // Check if we should auto-approve
        await reviewTransaction(txHash);
    });

    // Listen for blacklisting
    safetyTimer.on('AddressBlacklisted', (addr, reason) => {
        console.log(`
🚫 ADDRESS BLACKLISTED
Address: ${addr}
Reason: ${reason}
        `);
    });

    // Health check every 5 minutes
    setInterval(async () => {
        const health = await safetyTimer.healthCheck();
        console.log(`
📊 Health Check
Initialized: ${health.isInitialized}
Emergency Mode: ${health.isEmergencyMode}
Pending Txs: ${health.pendingCount}
Timelock Delay: ${health.timelockDelaySeconds / 3600} hours
Protected Tokens: ${health.protectedTokenCount}
        `);
    }, 5 * 60 * 1000);
}

monitorSafetyTimer();
```

## 🧪 Testing

### Test Script

```javascript
async function testSafetyTimer() {
    console.log("Testing SafetyTimer...\n");

    // 1. Test authorized transaction (should pass)
    console.log("1. Testing authorized transaction...");
    // Make transaction as Safe owner - should execute immediately

    // 2. Test unauthorized transaction (should queue)
    console.log("2. Testing unauthorized transaction...");
    // Have unauthorized address try to transfer - should be queued

    // 3. Test malicious attempt (should block + sweep)
    console.log("3. Testing malicious attempt...");
    // Give approval to test address
    // Have them try to transfer - should sweep tokens

    // 4. Test emergency mode
    console.log("4. Testing emergency mode...");
    await safetyTimer.setEmergencyMode(true);
    // Try transaction - should fail
    await safetyTimer.setEmergencyMode(false);

    console.log("All tests complete!");
}
```

## 🔧 Integration with Existing Bots

Update your existing sweep bots to work with SafetyTimer:

```javascript
// In your bot code
const safetyTimer = new ethers.Contract(...);

// Add bot as controller
await safetyTimer.addController(botWallet.address);

// Now your bot can execute immediately
// Your existing sweep functions will work without delays!
```

## ⚠️ Important Notes

1. **Guard vs Module**: The contract must be enabled as BOTH a module AND a guard
2. **Owner Permissions**: Safe owners always bypass all checks
3. **Controller Setup**: Add your bots as controllers ASAP
4. **Protected Tokens**: Configure which tokens to monitor
5. **Timelock Delay**: Default 24 hours, max 7 days
6. **Emergency Mode**: Use sparingly - blocks ALL transactions

## 🎯 Best Practices

1. **Initial Setup**
   - Deploy module
   - Enable as module
   - Set as guard
   - Add controllers
   - Add protected tokens
   - Test with small amounts

2. **Monitoring**
   - Run monitoring script 24/7
   - Set up alerts for malicious attempts
   - Review queued transactions daily
   - Check blacklisted addresses weekly

3. **Emergency Response**
   - Enable emergency mode if under attack
   - Sweep all tokens to vault
   - Review and update blacklist
   - Disable emergency mode when safe

4. **Regular Maintenance**
   - Review pending transactions
   - Update controller list
   - Adjust timelock delay if needed
   - Monitor gas costs

## 📞 Support

If you encounter issues:
1. Check `healthCheck()` function
2. Verify module and guard are enabled
3. Ensure controllers are added
4. Review event logs
5. Test with small amounts first

## 🚀 Production Checklist

- [ ] SafetyTimerModule deployed
- [ ] Module enabled on Safe
- [ ] Guard set on Safe
- [ ] Owner address configured
- [ ] Vault address configured
- [ ] Controllers added
- [ ] Protected tokens added
- [ ] Timelock delay configured
- [ ] Monitoring script running
- [ ] Alert system configured
- [ ] Tested with small amounts
- [ ] Emergency procedures documented

---

**You now have the holy grail of Safe protection!** Any unauthorized transfer attempts will be caught, delayed, or automatically swept to safety. 🛡️
