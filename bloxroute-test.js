const WebSocket = require('ws');
const axios = require('axios');
require('dotenv').config();

// Simple BloxRoute Test - No ethers.js network detection
class SimpleBloxRouteTest {
  constructor() {
    this.bloxrouteHeader = process.env.BLOXROUTE_HEADER;
    // Use your actual RPC variables - try primary first, fallback to others
    this.rpcUrl = process.env.RPC_URL || 
                  process.env.ALCHEMY_HTTP || 
                  process.env.QUICKNODE_HTTP || 
                  process.env.WEB3_PROVIDER;
    this.bloxrouteWs = null;
  }

  async testWebSocketConnection() {
    console.log('🔗 Testing BloxRoute WebSocket connection...');
    
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      try {
        this.bloxrouteWs = new WebSocket('wss://api.blxrbdn.com/ws', {
          headers: {
            Authorization: this.bloxrouteHeader,
          },
        });

        this.bloxrouteWs.on('open', () => {
          const connectTime = Date.now() - startTime;
          console.log(`✅ BloxRoute WebSocket connected in ${connectTime}ms`);
          this.bloxrouteWs.close();
          resolve({ success: true, timeMs: connectTime });
        });

        this.bloxrouteWs.on('error', (error) => {
          console.error('❌ WebSocket error:', error.message);
          resolve({ success: false, error: error.message });
        });

        setTimeout(() => {
          if (this.bloxrouteWs?.readyState !== WebSocket.OPEN) {
            console.error('⏰ WebSocket connection timeout');
            resolve({ success: false, error: 'Connection timeout' });
          }
        }, 5000);
        
      } catch (error) {
        console.error('❌ WebSocket setup failed:', error.message);
        resolve({ success: false, error: error.message });
      }
    });
  }

  async testHttpAPI() {
    console.log('🌐 Testing BloxRoute HTTP API...');
    
    try {
      const startTime = Date.now();
      
      // Test a simple method call to verify API access
      const response = await axios.post('https://api.blxrbdn.com', {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1
      }, {
        headers: {
          'Authorization': this.bloxrouteHeader,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });
      
      const responseTime = Date.now() - startTime;
      
      if (response.data.error) {
        console.error('❌ API Error:', response.data.error);
        return { success: false, error: response.data.error.message };
      }
      
      console.log(`✅ BloxRoute HTTP API responding in ${responseTime}ms`);
      console.log(`📊 Latest block: ${parseInt(response.data.result, 16)}`);
      
      return { success: true, timeMs: responseTime, blockNumber: parseInt(response.data.result, 16) };
      
    } catch (error) {
      console.error('❌ HTTP API test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testStandardRPC() {
    console.log('🔄 Testing standard RPC connection...');
    
    if (!this.rpcUrl) {
      console.log('⚠️ RPC_URL not set in .env - skipping test');
      return { success: false, error: 'RPC_URL not configured' };
    }
    
    try {
      const startTime = Date.now();
      
      const response = await axios.post(this.rpcUrl, {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });
      
      const responseTime = Date.now() - startTime;
      
      if (response.data.error) {
        console.error('❌ RPC Error:', response.data.error);
        return { success: false, error: response.data.error.message };
      }
      
      console.log(`✅ Standard RPC responding in ${responseTime}ms`);
      console.log(`📊 Latest block: ${parseInt(response.data.result, 16)}`);
      
      return { success: true, timeMs: responseTime, blockNumber: parseInt(response.data.result, 16) };
      
    } catch (error) {
      console.error('❌ Standard RPC test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testSubmissionMethod() {
    console.log('📡 Testing BloxRoute submission method...');
    
    return new Promise((resolve) => {
      try {
        this.bloxrouteWs = new WebSocket('wss://api.blxrbdn.com/ws', {
          headers: {
            Authorization: this.bloxrouteHeader,
          },
        });

        this.bloxrouteWs.on('open', () => {
          console.log('✅ WebSocket ready for submission test');
          
          // Test the submission method without actually sending a transaction
          const testRequest = {
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'blxr_private_tx',
            params: {
              transaction: 'test_validation', // Invalid tx to test method availability
              timeout: 30,
              mev_builders: { all: '' },
              node_validation: true,
            },
          };

          const responseHandler = (data) => {
            try {
              const response = JSON.parse(data.toString());
              if (response.id === testRequest.id) {
                this.bloxrouteWs.removeListener('message', responseHandler);
                this.bloxrouteWs.close();
                
                // We expect an error since we sent invalid data, but the method should be recognized
                if (response.error) {
                  if (response.error.message.includes('invalid') || response.error.message.includes('decode')) {
                    console.log('✅ blxr_private_tx method is available (expected validation error)');
                    resolve({ success: true, method: 'available' });
                  } else {
                    console.log('⚠️ Unexpected error:', response.error.message);
                    resolve({ success: false, error: response.error.message });
                  }
                } else {
                  console.log('🤔 Unexpected success with test data');
                  resolve({ success: true, method: 'available' });
                }
              }
            } catch (e) {
              // Ignore parsing errors
            }
          };

          this.bloxrouteWs.on('message', responseHandler);
          this.bloxrouteWs.send(JSON.stringify(testRequest));

          setTimeout(() => {
            this.bloxrouteWs.removeListener('message', responseHandler);
            this.bloxrouteWs.close();
            resolve({ success: false, error: 'Method test timeout' });
          }, 5000);
        });

        this.bloxrouteWs.on('error', (error) => {
          console.error('❌ Method test error:', error.message);
          resolve({ success: false, error: error.message });
        });

      } catch (error) {
        console.error('❌ Method test setup failed:', error.message);
        resolve({ success: false, error: error.message });
      }
    });
  }

  async runDiagnostics() {
    console.log('🧪 BloxRoute Diagnostics - No Network Detection\n');
    
    // Test 1: WebSocket Connection
    const wsResult = await this.testWebSocketConnection();
    
    // Test 2: HTTP API
    const httpResult = await this.testHttpAPI();
    
    // Test 3: Standard RPC
    const rpcResult = await this.testStandardRPC();
    
    // Test 4: Submission Method
    const methodResult = await this.testSubmissionMethod();
    
    console.log('\n📊 Diagnostic Results:');
    console.log(`  WebSocket Connection: ${wsResult.success ? '✅ WORKING' : '❌ FAILED'} ${wsResult.timeMs ? `(${wsResult.timeMs}ms)` : ''}`);
    console.log(`  HTTP API Access: ${httpResult.success ? '✅ WORKING' : '❌ FAILED'} ${httpResult.timeMs ? `(${httpResult.timeMs}ms)` : ''}`);
    console.log(`  Standard RPC: ${rpcResult.success ? '✅ WORKING' : '❌ FAILED'} ${rpcResult.timeMs ? `(${rpcResult.timeMs}ms)` : ''}`);
    console.log(`  Private TX Method: ${methodResult.success ? '✅ AVAILABLE' : '❌ NOT AVAILABLE'}`);
    
    if (wsResult.success && httpResult.success && methodResult.success) {
      console.log('\n🎉 EXCELLENT: BloxRoute is fully functional!');
      console.log('   Your private relay should work for emergency sweeps');
      
      if (wsResult.timeMs < 500 && httpResult.timeMs < 1000) {
        console.log('   Connection speeds are excellent for emergency response');
      }
    } else {
      console.log('\n⚠️ ISSUES DETECTED:');
      
      if (!wsResult.success) {
        console.log(`   - WebSocket: ${wsResult.error}`);
      }
      if (!httpResult.success) {
        console.log(`   - HTTP API: ${httpResult.error}`);
      }
      if (!rpcResult.success) {
        console.log(`   - Standard RPC: ${rpcResult.error}`);
      }
      if (!methodResult.success) {
        console.log(`   - Private TX Method: ${methodResult.error}`);
      }
    }
    
    console.log('\n🔍 Configuration Check:');
    console.log(`  BloxRoute Header: ${this.bloxrouteHeader ? 'Present' : 'Missing'}`);
    console.log(`  RPC URL: ${this.rpcUrl ? 'Present' : 'Missing'}`);
    
    if (this.bloxrouteHeader) {
      console.log(`  Header Length: ${this.bloxrouteHeader.length} characters`);
    }
    
    return {
      websocket: wsResult,
      httpApi: httpResult,
      standardRpc: rpcResult,
      privateMethod: methodResult,
      overall: wsResult.success && httpResult.success && methodResult.success
    };
  }
}

// Run diagnostics
async function main() {
  const tester = new SimpleBloxRouteTest();
  await tester.runDiagnostics();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { SimpleBloxRouteTest };