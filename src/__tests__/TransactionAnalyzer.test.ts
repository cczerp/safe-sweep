import { ethers } from 'ethers';
import { TransactionAnalyzer } from '../services/TransactionAnalyzer';
import { PendingTransaction } from '../types';

describe('TransactionAnalyzer', () => {
  const safeAddress = '0x1234567890123456789012345678901234567890';
  const tokenAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const authorizedAddress = '0x1111111111111111111111111111111111111111';
  const unauthorizedAddress = '0x2222222222222222222222222222222222222222';
  const recipientAddress = '0x3333333333333333333333333333333333333333';

  let analyzer: TransactionAnalyzer;

  beforeEach(() => {
    analyzer = new TransactionAnalyzer(safeAddress, [authorizedAddress]);
  });

  describe('transferFrom detection', () => {
    it('should detect unauthorized transferFrom', async () => {
      // Create a transferFrom transaction
      const iface = new ethers.Interface([
        'function transferFrom(address from, address to, uint256 amount)',
      ]);

      const data = iface.encodeFunctionData('transferFrom', [
        safeAddress,
        recipientAddress,
        ethers.parseEther('100'),
      ]);

      const tx: PendingTransaction = {
        hash: '0xtest',
        from: unauthorizedAddress,
        to: tokenAddress,
        data: data,
        value: '0',
      };

      const result = await analyzer.analyze(tx);

      expect(result).not.toBeNull();
      expect(result?.reason).toContain('Unauthorized transferFrom');
      expect(result?.tokenTransfers).toHaveLength(1);
      expect(result?.tokenTransfers[0].tokenAddress).toBe(tokenAddress);
    });

    it('should NOT flag authorized transferFrom', async () => {
      const iface = new ethers.Interface([
        'function transferFrom(address from, address to, uint256 amount)',
      ]);

      const data = iface.encodeFunctionData('transferFrom', [
        safeAddress,
        recipientAddress,
        ethers.parseEther('100'),
      ]);

      const tx: PendingTransaction = {
        hash: '0xtest',
        from: authorizedAddress,
        to: tokenAddress,
        data: data,
        value: '0',
      };

      const result = await analyzer.analyze(tx);

      expect(result).toBeNull();
    });

    it('should NOT flag transferFrom from different address', async () => {
      const iface = new ethers.Interface([
        'function transferFrom(address from, address to, uint256 amount)',
      ]);

      const data = iface.encodeFunctionData('transferFrom', [
        unauthorizedAddress, // Different from safe
        recipientAddress,
        ethers.parseEther('100'),
      ]);

      const tx: PendingTransaction = {
        hash: '0xtest',
        from: unauthorizedAddress,
        to: tokenAddress,
        data: data,
        value: '0',
      };

      const result = await analyzer.analyze(tx);

      expect(result).toBeNull();
    });

    it('should handle non-transferFrom transactions', async () => {
      const iface = new ethers.Interface([
        'function approve(address spender, uint256 amount)',
      ]);

      const data = iface.encodeFunctionData('approve', [
        recipientAddress,
        ethers.parseEther('100'),
      ]);

      const tx: PendingTransaction = {
        hash: '0xtest',
        from: unauthorizedAddress,
        to: tokenAddress,
        data: data,
        value: '0',
      };

      const result = await analyzer.analyze(tx);

      expect(result).toBeNull();
    });

    it('should handle transactions with no data', async () => {
      const tx: PendingTransaction = {
        hash: '0xtest',
        from: unauthorizedAddress,
        to: tokenAddress,
        data: '0x',
        value: ethers.parseEther('1').toString(),
      };

      const result = await analyzer.analyze(tx);

      expect(result).toBeNull();
    });
  });
});
