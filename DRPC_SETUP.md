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
DRPC_HTTP=https://lb.drpc.org/ogrpc?network=polygon&dkey=YOUR_API_KEY_HERE

# dRPC WebSocket for real-time mempool monitoring (RECOMMENDED)
DRPC_WSS=wss://lb.drpc.org/ogws?network=polygon&dkey=YOUR_API_KEY_HERE
```

**Important:**
- Use their load-balanced endpoints (`lb.drpc.org`) for best performance
- WebSocket is **critical** for detecting pending transactions in the mempool
- If you have dRPC WSS, it will be prioritized over other providers

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
