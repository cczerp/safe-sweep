from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware  # As per your change
import threading
import time
import logging
from eth_abi import abi
import traceback
from web3.contract import Contract
import random  # For adding jitter to avoid detection patterns

# Configuration
POLYGON_RPC = 'https://polygon-rpc.com/'
YOUR_SAFE_ADDRESS = '0x3Ef50d6213F36eb88b994FA6C78277B328216d52'  # Your show wallet (Safe)
YOUR_TARGET_WALLET = '0xdD3BA483352ab5E74e4C52681Fd53DB4376e5c13'  # Your business wallet for profits
PRIVATE_KEY = '871c75e6641a1c18097216964c38fcdf663db51480b46b5f63e5e1f980153a99'
TOKEN_ADDRESSES = {
    'USDT': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    'USDC': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    # Expand with more tokens as needed
}
MONITOR_INTERVAL = 60  # Seconds between checks; adjust for speed
BLOCK_RANGE = 100  # Blocks to scan; make this dynamic if needed
RETRY_ATTEMPTS = 5  # Increased for reliability in case of network issues
GNOSIS_SAFE_ABI = [  # Full ABI for Gnosis Safe; ensure this matches your setup
    {'constant': False, 'inputs': [{'name': 'to', 'type': 'address'}, {'name': 'value', 'type': 'uint256'}, {'name': 'data', 'type': 'bytes'}, {'name': 'operation', 'type': 'uint8'}, {'name': 'safeTxGas', 'type': 'uint256'}, {'name': 'baseGas', 'type': 'uint256'}, {'name': 'gasPrice', 'type': 'uint256'}, {'name': 'gasToken', 'type': 'address'}, {'name': 'refundReceiver', 'type': 'address'}, {'name': 'signatures', 'type': 'bytes'}, {'name': 'paymentToken', 'type': 'address'}, {'name': 'payment', 'type': 'uint256'}], 'name': 'execTransaction', 'outputs': [{'name': '', 'type': 'bool'}], 'type': 'function'},
    # Add any other ABI elements required for your Safe
]

w3 = Web3(Web3.HTTPProvider(POLYGON_RPC))
w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)  # Using your specified middleware

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def execute_safe_transaction(to_address, value, data):
    for attempt in range(RETRY_ATTEMPTS):
        try:
            safe_contract = w3.eth.contract(address=YOUR_SAFE_ADDRESS, abi=GNOSIS_SAFE_ABI)
            nonce = w3.eth.get_transaction_count(w3.eth.account.from_key(PRIVATE_KEY).address)
            tx_data = [to_address, value, data, 0, 0, 0, 0, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', b'']
            gas_estimate = safe_contract.functions.execTransaction(*tx_data).estimateGas({'from': w3.eth.account.from_key(PRIVATE_KEY).address})
            signed_tx = w3.eth.account.sign_transaction({
                'to': YOUR_SAFE_ADDRESS,
                'value': 0,
                'gas': gas_estimate,
                'gasPrice': w3.eth.gas_price,
                'nonce': nonce,
                'data': safe_contract.encodeABI(fn_name='execTransaction', args=tx_data)
            }, PRIVATE_KEY)
            tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
            if receipt and receipt['status'] == 1:
                logging.info(f"Successful transfer: {receipt.transactionHash.hex()} to {to_address}")
                return receipt
        except Exception as e:
            if attempt == RETRY_ATTEMPTS - 1:
                logging.error(f"All attempts failed for transfer to {to_address}: {traceback.format_exc()}")
            else:
                logging.warning(f"Attempt {attempt + 1} failed: {str(e)[:100]}")  # Log only key info
            time.sleep(5)
    return None

def monitor_and_transfer():
    last_logged_block = 0  # Track last logged block to avoid repetition
    while True:
        try:
            latest_block = w3.eth.get_block_number()
            if latest_block > last_logged_block:
                logging.info(f"Scanning new blocks up to {latest_block}")
                last_logged_block = latest_block  # Update to avoid logging the same block multiple times
            for block_number in range(max(0, latest_block - BLOCK_RANGE), latest_block + 1):
                if block_number <= last_logged_block:
                    continue  # Skip already processed blocks
                block = w3.eth.get_block(block_number, full_transactions=True)
                for tx in block.transactions:
                    if tx['to'] and tx['to'].lower() == YOUR_SAFE_ADDRESS.lower():
                        if tx['value'] > 0:  # MATIC deposit
                            logging.info(f"MATIC deposit detected: {tx['value']} WEI - Transferring to {YOUR_TARGET_WALLET}")
                            receipt = execute_safe_transaction(YOUR_TARGET_WALLET, tx['value'], b'')
                        elif tx['to'] in TOKEN_ADDRESSES.values() and tx['input'].startswith('0xa9059cbb'):
                            token_address = tx['to']
                            token_symbol = next(symbol for symbol, addr in TOKEN_ADDRESSES.items() if addr.lower() == token_address.lower())
                            value = int(tx['input'][74:138], 16)
                            logging.info(f"ERC-20 deposit detected: {value} of {token_symbol} - Transferring to {YOUR_TARGET_WALLET}")
                            contract = w3.eth.contract(address=token_address, abi=[{'constant': False, 'inputs': [{'name': '_to', 'type': 'address'}, {'name': '_value', 'type': 'uint256'}], 'name': 'transfer', 'outputs': [], 'type': 'function'}])
                            transfer_data = contract.encodeABI(fn_name='transfer', args=[YOUR_TARGET_WALLET, value])
                            receipt = execute_safe_transaction(token_address, 0, transfer_data)
            time.sleep(MONITOR_INTERVAL)
        except Exception as e:
            logging.error(f"Monitoring error: {traceback.format_exc()}")
            time.sleep(MONITOR_INTERVAL)

if __name__ == '__main__':
    threading.Thread(target=monitor_and_transfer, daemon=True).start()
    while True:
        time.sleep(1)
