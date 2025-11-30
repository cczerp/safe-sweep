# dRPC Setup Guide (MEV Protection for Polygon)

## Why dRPC?

Alchemy's `eth_sendPrivateTransaction` only works on Ethereum mainnet, not Polygon. **dRPC provides MEV protection for Polygon** by routing transactions through private mempools and block builders.

## How It Works

When you add dRPC to your shotgun broadcast setup:
1. Your transaction is sent to **ALL providers simultaneously** (Alchemy, Infura, dRPC, etc.)
2. dRPC routes your tx through MEV-protected channels
3. Standard RPCs broadcast to public mempool
4. **Whichever succeeds first wins!**

This gives you:
- ✅ **MEV protection** (from dRPC)
- ✅ **Speed** (fastest provider wins)
- ✅ **Redundancy** (multiple paths)
- ✅ **Real-world comparison** (see which is faster)

## Setup Steps

### 1. Get dRPC API Key

Visit: https://drpc.org

1. Sign up for a free account
2. Create a new project
3. Select **Polygon** network
4. Copy your endpoint URL

### 2. Add to .env File

```bash
# dRPC HTTP endpoint for MEV-protected Polygon transactions
# Client type: bor (recommended for Polygon - official client)
DRPC_HTTP=https://lb.drpc.org/ogrpc?network=polygon&dkey=YOUR_API_KEY_HERE&client=bor

# dRPC WebSocket for real-time mempool monitoring (RECOMMENDED)
DRPC_WSS=wss://lb.drpc.org/ogws?network=polygon&dkey=YOUR_API_KEY_HERE&client=bor
```

**Client Type Options:**
- `bor` - Official Polygon client (RECOMMENDED)
  - Best compatibility with Polygon-specific features
  - Access to bor_* methods (getCurrentProposer, getCurrentValidators, etc.)
  - Most validators run Bor
- `erigon` - Faster syncing, lower disk usage, good for archive queries
- `nethermind` - .NET implementation, fast and efficient

**Why Bor for Polygon?**
- Native support for Polygon consensus
- Access to validator/proposer information
- Better MEV bundle routing (knows current block proposer)
- Most compatible with Polygon's Heimdall + Bor architecture

**Important:**
- Use their load-balanced endpoints (`lb.drpc.org`) for best performance
- WebSocket is **critical** for detecting pending transactions in the mempool
- If you have dRPC WSS, it will be prioritized over other providers
- Specifying `client=bor` ensures you're routing to Polygon-native nodes

### 3. Restart Monitor

```bash
DEBUG=true node udmv2.js
```

You should see:
```
📡 Connecting to network...
   ✅ WebSocket connected: wss://lb.drpc.org/ogws?network=polygon... (MEV Protected)

🔫 Setting up shotgun submission providers...
   ✅ Added backup (MEV Protected): https://lb.drpc.org/ogrpc?network=polygon...
   ✅ Added backup: https://polygon-mainnet.g.alchemy.com...
   ✅ Added backup: https://polygon-mainnet.infura.io...
✅ Shotgun configured with 5 providers
```

## Testing

Send a test `transferFrom()` attack and watch the logs:

```
🎯 SHOTGUN RESULT:
   ✅ 3/5 paths succeeded
   ⚡ Fastest: Backup RPC 1 (MEV Protected) in 145ms
```

This tells you which provider won the race!

## Advanced: Dedicated dRPC Endpoint

For production use, consider getting a **dedicated endpoint** from dRPC:
- Lower latency
- Higher rate limits
- Better MEV protection

## WebSocket Priority System

The monitor uses WebSocket connections to detect pending transactions in real-time:

**Priority Order:**
1. **dRPC WSS** (if configured) - MEV-protected mempool monitoring
2. **Quicknode WSS** - Fast mempool access
3. **Alchemy WSS** - Standard mempool monitoring

**Why dRPC WSS is prioritized:**
- Monitors MEV-protected mempool channels
- Better for detecting transactions that might bypass public mempool
- Still sees all public transactions too
- Lower latency to block builders

## Comparison: dRPC vs Standard RPC

| Feature | dRPC | Standard RPC |
|---------|------|--------------|
| MEV Protection | ✅ Yes | ❌ No |
| Public Mempool | ❌ No | ✅ Yes |
| Speed | ~150-250ms | ~100-150ms |
| Cost | Free tier available | Free tier available |
| Best For | High-value txs | Speed-critical txs |
| WebSocket Support | ✅ Yes | ✅ Yes |

## Recommended Strategy

**Use shotgun with both:**
- Send to dRPC (MEV protected)
- Send to Alchemy/Infura (faster)
- Let the network decide which wins!

This gives you the best of both worlds - MEV protection with fallback to speed if needed.

---

## Premium Tier Features 🚀

dRPC's pay-as-you-go premium tier unlocks advanced features that turn your defense into a fortress:

### 1. Approval Intelligence Tracker 🔍

**Monitors ERC20 Approval events in real-time using `eth_subscribe`**

**What it does:**
- Tracks when addresses get approval to spend from your Safe
- Builds a "watch list" of approved spenders
- Cross-references with transferFrom attacks for instant context

**How it helps:**
```
Normal attack:
Attacker calls transferFrom() → ✅ You detect and respond

With Approval Tracking:
1. Attacker gets approval → 📝 Added to watch list
2. (hours/days pass)
3. Attacker calls transferFrom() → ✅ You detect and respond
   👁️ INTEL: Approved 2h ago for 1000 USDT - NOW ATTACKING!
```

**Key benefit:** You have advance intelligence on who CAN attack, giving you context when they DO attack.

### 2. TxPool Monitor (txpool_content) ⚡

**Gets entire mempool in ONE call instead of thousands**

**Traditional approach:**
- WebSocket sends alert for each pending tx
- You call `eth_getTransactionByHash` for each one
- 500-1000ms total latency
- 100+ RPC calls per second during busy periods

**With txpool_content:**
- Get ALL pending transactions in one call
- 50-100ms total latency
- 1 RPC call per scan (every 500ms)
- 10x faster detection!

**Usage:**
```javascript
// Automatically enabled if DRPC_HTTP is configured
// Scans mempool every 500ms
// Processes 1000+ pending txs in ~50ms
```

### 3. Pre-Flight Validator (trace_call & debug_traceCall) ✈️

**Simulates your sweep BEFORE broadcasting to catch failures**

**What it validates:**
- ✅ Transaction will succeed
- ✅ Sufficient gas
- ✅ No contract reverts
- ✅ Nonce is correct
- ✅ Account has balance

**Benefits:**
- Don't waste gas on failed sweeps
- Faster debugging (know WHY it will fail)
- Higher success rate
- Can adjust parameters before sending

**Example output:**
```
✈️ PRE-FLIGHT: Simulating transaction...
   From: 0x123...
   To: 0x456...
   Gas: 500000
   MaxFee: 50.5 gwei
   ✅ PRE-FLIGHT PASSED (87ms)
   Gas Used: 412,503 / 500,000

🔫 SHOTGUN BROADCAST: USDT
   Targeting 5 RPC providers...
```

**If it fails:**
```
✈️ PRE-FLIGHT: Simulating transaction...
   ❌ PRE-FLIGHT FAILED (92ms)
   Reason: insufficient funds for gas * price + value
   ⚠️ Skipping broadcast to avoid wasted gas
```

### 4. Failed Transaction Analysis 🔍

**When a sweep fails, debug_traceTransaction shows you exactly why**

```javascript
// Automatically available after any failed transaction
await preFlightValidator.analyzeFailedTransaction(txHash);

// Output:
🔍 ANALYZING FAILED TRANSACTION: 0xabc...
   Type: CALL
   Gas Used: 23,891
   ❌ Error: execution reverted
   ❌ Revert Reason: ERC20: transfer amount exceeds balance
```

### Setup for Premium Features

Add to `.env`:
```bash
# dRPC Premium Tier (pay-as-you-go)
# Use client=bor for Polygon (official client with best MEV routing)
DRPC_HTTP=https://lb.drpc.org/ogrpc?network=polygon&dkey=YOUR_API_KEY_HERE&client=bor
DRPC_WSS=wss://lb.drpc.org/ogws?network=polygon&dkey=YOUR_API_KEY_HERE&client=bor
```

**Cost:** Pay-as-you-go pricing
- Approval tracking: ~$0.001 per approval event
- TxPool scans: ~$0.0001 per scan (2/second = ~$0.02/day)
- Pre-flight validation: ~$0.001 per validation
- Failed tx analysis: ~$0.002 per analysis

**Typical cost:** $1-5/month for active monitoring

### What's Enabled Automatically?

Once you add dRPC endpoints, premium features activate automatically:

✅ **Approval Intelligence Tracker**
- Monitors USDT Approval events via `eth_subscribe`
- Builds watch list of approved spenders
- Shows intel when transferFrom detected

✅ **Pre-Flight Validator**
- Validates all sweeps before broadcast
- Prevents wasted gas on failed transactions
- Shows detailed revert reasons

✅ **TxPool Monitor** (optional)
- Faster mempool scanning
- Lower latency detection
- Reduced RPC calls

### Premium Status Display

Every 60 seconds, you'll see:

```
📊 ULTIMATE DEFENSE STATUS (V2):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Approval Intelligence:
     Approvals Detected: 12
     Active Watch List: 8 addresses
     Suspicious Patterns: 2

   ✈️ PRE-FLIGHT VALIDATOR STATUS:
     Validations: 45
     Passed: 43
     Failed: 2
     Success Rate: 95.6%
     Avg Validation Time: 87ms

   📊 TXPOOL MONITOR STATUS:
     Scans: 120
     Total Txs Seen: 45,231
     Avg Txs/Scan: 377
     Avg Scan Time: 52ms
```

### Worth It?

**Absolutely, if you're protecting high-value assets:**

- **Approval tracking** gives you advance warning
- **TxPool monitoring** is 10x faster than WebSocket polling
- **Pre-flight validation** prevents costly failed sweeps
- **Total cost:** $1-5/month vs losing $1000s to attacks

**The fortress is open for business.** 🏰
