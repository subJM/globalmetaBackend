// services/rescueBundle.js
require('dotenv').config();
const { ethers } = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');

const ERC20_ABI = [
  'function transfer(address to,uint256 value) returns (bool)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)'
];

const bn = (x) => ethers.BigNumber.from(String(x));

async function buildFees(provider, tipGwei = '5') {
  // 기본 tip 5 gwei (혼잡하면 8~12로 올려보세요)
  const latest = await provider.getBlock('latest');
  const base = latest.baseFeePerGas || ethers.utils.parseUnits('20', 'gwei');
  const tip = ethers.utils.parseUnits(tipGwei, 'gwei'); // 반드시 > 0
  const maxFee = base.mul(3).add(tip); // 여유있게 3x
  return { base, tip, maxFee };
}

/**
 * Flashbots 번들 방식:
 *  (1) sponsor -> compromised : 가스 충전
 *  (2) compromised -> newAddress: 토큰 transfer
 * 공개 mempool 우회, 동일 블록에서 원자적으로 실행
 */
async function rescueBundle({
  provider,
  relayUrl,
  authWallet,        // ethers.Wallet (자금 불필요, 헤더 서명용)
  sponsorWallet,     // ethers.Wallet (실제 ETH 보유, 가스 대납)
  compromisedWallet, // ethers.Wallet (해킹 주소, 이번 한번만 사용)
  tokenAddress,
  toAddress,
  amountUnits,       // decimals 반영한 정수값 (parseUnits 결과)
  gasLimitHint = '130000',
  tipGwei = '5',
  extraFundEth = '0.0006', // 충전 여유
  blocksToTry = 30,        // 시도 블록 수
  simulateRetries = 3,
  sendRetries = 3
}) {
  const { base, tip, maxFee } = await buildFees(provider, tipGwei);
  const chainId = (await provider.getNetwork()).chainId;

  // --- 토큰 전송 tx 데이터 준비 ---
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const data = token.interface.encodeFunctionData('transfer', [toAddress, amountUnits]);

  // 가스 한도 추정 (실패 시 넉넉한 기본값)
  let gasLimit;
  try {
    gasLimit = await provider.estimateGas({
      from: compromisedWallet.address,
      to: tokenAddress,
      data
    });
  } catch (_) {
    gasLimit = bn(gasLimitHint);
  }

  // pending nonce 사용 (공격자 pending tx와 충돌 방지)
  const compNonce = await provider.getTransactionCount(compromisedWallet.address, 'pending');
  const sponsorNonce = await provider.getTransactionCount(sponsorWallet.address, 'pending');

  const tokenTx = {
    to: tokenAddress,
    data,
    type: 2,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: tip,
    gasLimit,
    nonce: compNonce,
    chainId,
    value: 0
  };

  // 스폰서 → 해킹 주소: 필요한 가스비 + 여유
  const needWei = maxFee.mul(gasLimit).add(ethers.utils.parseEther(extraFundEth));
  const fundTx = {
    to: compromisedWallet.address,
    value: needWei,
    type: 2,
    gasLimit: bn(21000),
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: tip,
    nonce: sponsorNonce,
    chainId
  };

  // Flashbots provider (헤더 서명 자동 부착)
  const fb = await FlashbotsBundleProvider.create(provider, authWallet, relayUrl);

  // 미리 서명 묶기
  const signed = await fb.signBundle([
    { signer: sponsorWallet, transaction: fundTx },
    { signer: compromisedWallet, transaction: tokenTx }
  ]);

  const startBlock = await provider.getBlockNumber();

  // 진단 로그(원하면 주석 해제)
  // console.log('[DBG] base/tip/max', base.toString(), tip.toString(), maxFee.toString());
  // console.log('[DBG] gasLimit', gasLimit.toString(), 'needWei', needWei.toString());
  // console.log('[DBG] nonces', { sponsorNonce, compNonce });

  let lastError = null;
  const attempts = [];

  for (let i = 1; i <= blocksToTry; i++) {
    const targetBlock = startBlock + i + 1;
    const entry = { targetBlock, simulateTries: [], sendTries: [] };

    // --- simulate (재시도) ---
    let simOk = false;
    for (let s = 1; s <= simulateRetries; s++) {
      try {
        const sim = await fb.simulate(signed, targetBlock);
        if ('error' in sim) {
          const msg = sim.error?.message || JSON.stringify(sim);
          entry.simulateTries.push({ ok: false, msg });
          lastError = new Error(`simulate: ${msg}`);
          // simulate가 revert면 다음 블록도 동일하게 실패할 가능성 큼 → 즉시 종료
          throw lastError;
        } else {
          entry.simulateTries.push({ ok: true });
          simOk = true;
          break;
        }
      } catch (e) {
        entry.simulateTries.push({ ok: false, msg: e?.message || String(e) });
        lastError = e;
        await new Promise((r) => setTimeout(r, 500 * s));
      }
    }
    if (!simOk) {
      attempts.push(entry);
      // simulate 재시도 모두 실패 시 더 진행해도 의미 적어 바로 리턴
      return {
        status: 'simulate_failed',
        triedBlocks: i,
        lastError: lastError?.message || String(lastError),
        attempts
      };
    }

    // --- sendRawBundle (재시도) ---
    let resp = null;
    for (let t = 1; t <= sendRetries; t++) {
      try {
        resp = await fb.sendRawBundle(signed, targetBlock);
        entry.sendTries.push({ ok: true });
        break;
      } catch (e) {
        entry.sendTries.push({
          ok: false,
          msg: e?.response?.data || e?.message || String(e),
          status: e?.response?.status
        });
        lastError = e;
        await new Promise((r) => setTimeout(r, 800 * t));
      }
    }
    if (!resp) {
      attempts.push(entry);
      continue; // 다음 블록으로
    }

    // --- wait ---
    try {
      const code = await resp.wait(); // 0: included, 1: not included
      if (code === 0) {
        // 포함됨 → 해시 계산해서 반환
        const rawFund = await sponsorWallet.signTransaction(fundTx);
        const rawTok = await compromisedWallet.signTransaction(tokenTx);
        return {
          status: 'included',
          includedBlock: targetBlock,
          fundTxHash: ethers.utils.keccak256(rawFund),
          tokenTxHash: ethers.utils.keccak256(rawTok),
          attempts
        };
      } else {
        // not included: 다음 블록 시도
        attempts.push(entry);
      }
    } catch (e) {
      entry.waitError = e?.response?.data || e?.message || String(e);
      attempts.push(entry);
      lastError = e;
    }
  }

  return {
    status: 'not_included',
    triedBlocks: blocksToTry,
    lastError: lastError?.message || String(lastError || ''),
    attempts
  };
}

module.exports = { rescueBundle };
