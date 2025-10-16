// privateTx.js
const { ethers } = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');

async function sendPrivateErc20Transfer({
  provider,              // 일반 공개 RPC provider (estimate/nonce 조회용)
  relayUrl,              // PRIVATE_TX_RPC_URL
  authKey,               // FLASHBOTS_AUTH_PRIVATE_KEY (없으면 임시 랜덤 월렛)
  wallet,                // 해킹당한 주소의 Wallet(반드시 깨끗한/격리 환경)
  tokenAddress,
  to,
  amountUnits,           // parseUnits로 미리 만든 정수량
  gasLimitHint           // 대략 70k~120k
}) {
  // 1) 트랜잭션 데이터 준비
  const erc20Abi = ['function transfer(address to, uint256 value) returns (bool)'];
  const iface = new ethers.utils.Interface(erc20Abi);
  const data = iface.encodeFunctionData('transfer', [to, amountUnits]);

  const feeData = await provider.getFeeData();
  const base = (await provider.getBlock('latest')).baseFeePerGas || ethers.utils.parseUnits('20', 'gwei');
  const maxPriority = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei'); // 0보다 커야 함
  const maxFee = base.mul(2).add(maxPriority);

  // 가스 한도 추정(실패 시 보수적 상수)
  let gasLimit = gasLimitHint ? ethers.BigNumber.from(gasLimitHint) : undefined;
  try {
    gasLimit = gasLimit || await provider.estimateGas({ from: wallet.address, to: tokenAddress, data });
  } catch {
    gasLimit = ethers.BigNumber.from(90000);
  }

  // 2) 원시 트랜잭션 생성 & 서명
  const tx = {
    to: tokenAddress,
    data,
    type: 2,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: maxPriority,
    gasLimit,
    nonce: await provider.getTransactionCount(wallet.address, 'latest'),
    chainId: (await provider.getNetwork()).chainId,
    value: 0
  };
  const signed = await wallet.signTransaction(tx);

  // 3) 릴레이로 “비공개” 전송
  // 대부분의 Protect/Flashbots 릴레이는 아래 두 가지 중 하나를 받습니다:
  //  - eth_sendPrivateTransaction
  //  - eth_sendRawTransaction (Protect 게이트웨이가 intercept)  ← 릴레이별 상이
  // 먼저 eth_sendPrivateTransaction 시도 → 실패 시 fallback
  try {
    const hash = await rawRpcSend(relayUrl, 'eth_sendPrivateTransaction', [signed, { maxBlockNumber: null }], authKey);
    return { hash, sentVia: 'eth_sendPrivateTransaction' };
  } catch (e1) {
    // fallback: eth_sendRawTransaction로 릴레이가 가로채는 타입일 수도 있음
    const hash = await rawRpcSend(relayUrl, 'eth_sendRawTransaction', [signed], authKey);
    return { hash, sentVia: 'eth_sendRawTransaction' };
  }
}

async function rawRpcSend(url, method, params, authKey) {
  // 일부 릴레이는 헤더 서명을 요구할 수 있음. 필요 시 추가.
  const headers = {
    'Content-Type': 'application/json'
  };
  // 예: Flashbots는 X-Flashbots-Signature: <addr>:<sig> 헤더를 받을 수 있음
  if (authKey) {
    const authWallet = new ethers.Wallet(authKey);
    const payload = JSON.stringify({ method, params }); // 간단 예시(릴레이별 포맷 다를 수 있음)
    const sig = await authWallet.signMessage(payload);
    headers['X-Flashbots-Signature'] = `${authWallet.address}:${sig}`;
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1e9),
    method,
    params
  });

  const res = await fetch(url, { method: 'POST', headers, body });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

module.exports = { sendPrivateErc20Transfer };
