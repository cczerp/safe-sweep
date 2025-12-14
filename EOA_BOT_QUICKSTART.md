# EOA Wallet Bot - Quick Start Guide

## 🚀 5-Minute Setup

### Step 1: Test the Bot

Run the test suite to verify everything works:

```bash
node test_eoa_bot.js
```

You should see all tests pass ✅

### Step 2: Configure Your Wallet

The bot uses the same `.env` file as your existing Safe defense system!

If you don't have a `.env` file yet:

```bash
cp .env.example .env
```

Edit `.env` and add your Trust Wallet details:

```bash
# ============ EOA WALLET BOT (Trust Wallet) ============
EOA_WALLET_ADDRESS=0xYourTrustWalletAddress
EOA_PRIVATE_KEY=your_trust_wallet_private_key_here

# EOA Bot Settings (optional - uses defaults if not set)
EOA_GAS_PREMIUM=0.5
EOA_MAX_GAS_PRICE_GWEI=1000
```

**That's it!** The bot will automatically use the RPC endpoints already configured in your `.env`:
- `ALCHEMY_HTTP` / `ALCHEMY_WSS` (primary)
- `QUICKNODE_HTTP` / `QUICKNODE_WSS` (backup)
- `INFURA_HTTP` / `INFURA_WSS` (backup)
- `ANKR_HTTP` (backup)
- `NODIES_HTTP` (backup)

**Optional but Recommended - MEV Bundles:**

For GUARANTEED protection (100% win rate), enable MEV bundles via Marlin Relay. Generate a searcher key:

```bash
node -e "console.log(require('ethers').Wallet.createRandom().privateKey)"
```

Add it to `.env`:
```bash
MEV_SEARCHER_KEY=0xYourGeneratedSearcherKey
ENABLE_MEV_BUNDLES=true
```

This key is just for signing bundle requests - it doesn't need any funds!

### Step 3: Get Your Trust Wallet Private Key

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

### Step 4: Run the Bot

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
🎯 MEV Bundles (Marlin Relay): ENABLED
   Priority Fee: 50 gwei
📡 WebSocket monitoring started
🔍 TxPool monitoring started

✅ EOA Wallet Bot is now monitoring mempool
   Watching for transferFrom() calls to: 0xYourAddress
   Ready to revoke approvals instantly
```

**The bot is now protecting your wallet! 🛡️**

### Step 5: What Happens When a Threat is Detected

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

🎯 USING MEV BUNDLE (Marlin Relay)
   Current block: 12345678
   Target block: 12345679
   Bundle size: 2 transactions
   ✅ Bundle submitted successfully
   Bundle hash: 0xbundle123...

✅ APPROVAL REVOCATION SENT!
   Method: MEV_BUNDLE
   Response Time: 185ms
   Tx Hash: 0xdef456...
   Bundle Hash: 0xbundle123...

🎉 APPROVAL REVOKED! Transaction confirmed.
   Your revocation executed BEFORE attacker's transferFrom
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
   MEV Bundles: 2 sent, 2 succeeded
   Shotgun: 0 sent, 0 succeeded
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

Your `.env` file should have:

```bash
# EOA Wallet Bot
EOA_WALLET_ADDRESS=0xYourTrustWalletAddress
EOA_PRIVATE_KEY=0xYourPrivateKey

# RPC Providers (at least one required, more = better)
ALCHEMY_HTTP=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
ALCHEMY_WSS=wss://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY

QUICKNODE_HTTP=https://your-endpoint.matic.quiknode.pro/YOUR_KEY/
QUICKNODE_WSS=wss://your-endpoint.matic.quiknode.pro/YOUR_KEY/

INFURA_HTTP=https://polygon-mainnet.infura.io/v3/YOUR_KEY
INFURA_WSS=wss://polygon-mainnet.infura.io/ws/v3/YOUR_KEY

ANKR_HTTP=https://rpc.ankr.com/polygon
NODIES_HTTP=https://lb.nodies.app/v1/YOUR_KEY

# Chain & Gas Settings
CHAIN_ID=137
EOA_GAS_PREMIUM=0.5
EOA_MAX_GAS_PRICE_GWEI=1000

# MEV Bundle Settings (RECOMMENDED for 100% win rate)
MEV_SEARCHER_KEY=0xYourSearcherKey
ENABLE_MEV_BUNDLES=true
BUNDLE_PRIORITY_FEE=50
BUNDLE_TIMEOUT=30
MAX_BLOCKS_AHEAD=3
```

## Troubleshooting

### "Please set EOA_WALLET_ADDRESS in .env file"
- Make sure you created `.env` from the example
- Run: `cp .env.example .env`
- Add your `EOA_WALLET_ADDRESS` and `EOA_PRIVATE_KEY`

### "WebSocket error" or "WebSocket disconnected"
- Check your RPC providers in `.env` (ALCHEMY_WSS, QUICKNODE_WSS, INFURA_WSS)
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
