# EOA Wallet Bot - Quick Start Guide

## 🚀 5-Minute Setup

### Step 1: Test the Bot

Run the test suite to verify everything works:

```bash
node test_eoa_bot.js
```

You should see all tests pass ✅

### Step 2: Configure Your Wallet

Create your configuration file:

```bash
cp eoa_bot_config.example.json eoa_bot_config.json
```

Edit `eoa_bot_config.json` with your details:

```json
{
  "walletAddress": "0xYourTrustWalletAddress",
  "privateKey": "your_private_key_from_trust_wallet",
  "rpcUrl": "https://your-rpc-provider.com",
  "wsRpcUrl": "wss://your-rpc-provider.com",
  "backupRpcUrls": [
    "https://backup1.com",
    "https://backup2.com"
  ],
  "chainId": 137,
  "gasPremium": 0.5,
  "maxGasPrice": "1000000000000"
}
```

### Step 3: Choose Your RPC Provider

Pick a provider and get an API key:

- **Alchemy** (Recommended): https://www.alchemy.com
  - Free tier: 300M compute units/month
  - WebSocket support: ✅
  - URL format: `https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY`
  - WS format: `wss://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY`

- **Infura**: https://infura.io
  - Free tier: 100k requests/day
  - WebSocket support: ✅
  - URL format: `https://polygon-mainnet.infura.io/v3/YOUR_KEY`
  - WS format: `wss://polygon-mainnet.infura.io/ws/v3/YOUR_KEY`

- **QuickNode**: https://www.quicknode.com
  - Free trial available
  - Premium tier needed for txpool_content
  - URL format: `https://rpc-mainnet.matic.quiknode.pro/YOUR_KEY`

### Step 4: Get Your Trust Wallet Private Key

⚠️ **SECURITY WARNING**: Your private key gives FULL ACCESS to your wallet. Keep it secure!

**In Trust Wallet:**
1. Open Trust Wallet app
2. Go to Settings → Wallets
3. Select your wallet
4. Tap "Show Recovery Phrase" or "Show Private Key"
5. Enter your password
6. Copy the private key

**Add `0x` prefix if it doesn't have one:**
- ❌ Wrong: `1234567890abcdef...`
- ✅ Correct: `0x1234567890abcdef...`

### Step 5: Run the Bot

```bash
node run_eoa_bot.js
```

You should see:

```
╔════════════════════════════════════════════════════════════╗
║              🤖 EOA WALLET BOT v1.0 🤖                     ║
║       High-Speed Approval Revocation System                ║
╚════════════════════════════════════════════════════════════╝

🤖 EOA Wallet Bot initialized
   Wallet: 0xYourAddress
   Chain ID: 137
   Gas Premium: 50%

🚀 Starting EOA Wallet Bot...
📡 WebSocket monitoring started
🔍 TxPool monitoring started

✅ EOA Wallet Bot is now monitoring mempool
   Watching for transferFrom() calls to: 0xYourAddress
   Ready to revoke approvals instantly
```

**The bot is now protecting your wallet! 🛡️**

### Step 6: What Happens When a Threat is Detected

When someone tries to call `transferFrom(yourWallet, theirWallet, amount)`:

```
🚨 THREAT DETECTED! transferFrom() targeting wallet
   Token: 0xc2132D05D31c914a87C6611C10748AEb04B58e8F
   Attacker Tx: 0xabc123...
   Attacker: 0xBadActor...

⚡ REVOKING APPROVAL...
   Gas Config:
     maxFeePerGas: 150 gwei
     maxPriorityFeePerGas: 75 gwei
     gasLimit: 100000
   Signed Tx Hash: 0xdef456...
   Broadcasting via shotgun...
     ✅ Primary RPC SUCCESS (45ms)
     ✅ Backup RPC 1 SUCCESS (52ms)
     ✅ Backup RPC 2 SUCCESS (48ms)

✅ APPROVAL REVOCATION SENT!
   Response Time: 123ms
   Tx Hash: 0xdef456...
   Fastest RPC: Primary RPC

🎉 APPROVAL REVOKED! Transaction confirmed.
```

## Monitoring & Maintenance

### Check Bot Status

The bot prints statistics every 30 seconds:

```
📊 Bot Statistics (Uptime: 3600s)
   Threats Detected: 2
   Revocations Sent: 2
   Revocations Confirmed: 2
   Revocations Failed: 0
   Avg Response Time: 145ms
```

### Stop the Bot

Press `Ctrl+C` to gracefully shutdown:

```
🛑 Received SIGINT, shutting down gracefully...
🛑 Stopping EOA Wallet Bot...
✅ Bot stopped
```

## Recommended Configuration for Production

```json
{
  "walletAddress": "0xYourAddress",
  "privateKey": "0xYourKey",

  "rpcUrl": "https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY",
  "wsRpcUrl": "wss://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY",

  "backupRpcUrls": [
    "https://polygon-mainnet.infura.io/v3/YOUR_INFURA_KEY",
    "https://lb.drpc.org/ogrpc?network=polygon&dkey=YOUR_DRPC_KEY",
    "https://rpc.ankr.com/polygon",
    "https://polygon.nodies.app"
  ],

  "chainId": 137,
  "gasPremium": 0.5,
  "maxGasPrice": "1000000000000",
  "monitoringInterval": 500,
  "enableTxPoolMonitoring": true,
  "enableWebSocketMonitoring": true
}
```

## Troubleshooting

### "Configuration file not found"
- Make sure you created `eoa_bot_config.json` from the example
- Run: `cp eoa_bot_config.example.json eoa_bot_config.json`

### "WebSocket error" or "WebSocket disconnected"
- Check your `wsRpcUrl` is correct
- Try using Alchemy or Infura (better WebSocket support)
- The bot will auto-reconnect, or continue with TxPool monitoring

### "All shotgun paths failed"
- Check your RPC URLs are valid
- Ensure you have internet connection
- Try using different RPC providers

### Bot not detecting threats
- Ensure WebSocket or TxPool monitoring is enabled
- Check your RPC supports `txpool_content` (premium tier)
- Verify your wallet address is correct

## Next Steps

- ✅ Bot is running and monitoring
- ✅ Test with a small approval (optional)
- ✅ Monitor logs for any issues
- ✅ Add to startup script for 24/7 protection

## Need Help?

See the full documentation: `EOA_BOT_README.md`

---

**Happy protecting! 🛡️**
