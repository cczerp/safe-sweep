# MEV_SEARCHER_KEY Setup Guide

## What is MEV_SEARCHER_KEY?

`MEV_SEARCHER_KEY` is a private key used to **sign bundle requests** sent to Marlin Relay. It's separate from your main `PRIVATE_KEY` that signs actual transactions.

**Key Points:**
- It's just a private key (like `PRIVATE_KEY`)
- You generate it yourself - no registration needed
- It's used only for authentication with Marlin Relay
- The address derived from this key is included in the signature header
- It does NOT need to have any funds or be registered anywhere

## How to Generate MEV_SEARCHER_KEY

### Option 1: Generate with Node.js (Recommended)

```bash
node -e "const { ethers } = require('ethers'); console.log(ethers.Wallet.createRandom().privateKey);"
```

This will output a new private key like:
```
0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
```

### Option 2: Generate with ethers.js in a script

Create a file `generate_searcher_key.js`:

```javascript
const { ethers } = require("ethers");

// Generate a new random wallet
const wallet = ethers.Wallet.createRandom();

console.log("🔑 Generated MEV Searcher Key:");
console.log(`   Private Key: ${wallet.privateKey}`);
console.log(`   Address: ${wallet.address}`);
console.log("\n💡 Add this to your .env file:");
console.log(`   MEV_SEARCHER_KEY=${wallet.privateKey}`);
```

Run it:
```bash
node generate_searcher_key.js
```

### Option 3: Use an existing private key

You can use any private key you already have, but for security best practices:
- **Use a separate key** from your main `PRIVATE_KEY`
- This key is only used for signing requests, not transactions
- It doesn't need funds or any special setup

## Adding to .env

Once you have the key, add it to your `.env` file:

```env
# Your main transaction signing key
PRIVATE_KEY=0xyourmainprivatekey

# Searcher key for Marlin Relay bundle authentication
MEV_SEARCHER_KEY=0xyoursearcherprivatekey
```

## Security Notes

1. **Keep it secret**: Like `PRIVATE_KEY`, never commit `MEV_SEARCHER_KEY` to git
2. **Separate keys**: Use different keys for `PRIVATE_KEY` and `MEV_SEARCHER_KEY`
3. **No funds needed**: The searcher key doesn't need any MATIC or tokens
4. **Backup**: Store it securely like any other private key

## Verification

After adding `MEV_SEARCHER_KEY` to your `.env`, test it:

```bash
node test_marlin_bundles.js
```

If configured correctly, you should see:
```
✅ Marlin Relay initialized successfully
   Searcher Address: 0xYourSearcherAddress
```

## Troubleshooting

**Error: "MEV_SEARCHER_KEY not provided"**
- Make sure you've added `MEV_SEARCHER_KEY=0x...` to your `.env` file
- Restart your application after adding it

**Error: "Invalid private key"**
- Ensure the key starts with `0x`
- Check that it's 66 characters long (0x + 64 hex characters)
- Verify there are no extra spaces or quotes

## Summary

1. Generate a private key (any method above)
2. Add `MEV_SEARCHER_KEY=0x...` to your `.env`
3. That's it! No registration or setup needed.

The searcher key is just used for signing HTTP requests to Marlin Relay - it's purely for authentication, not for signing actual blockchain transactions.

