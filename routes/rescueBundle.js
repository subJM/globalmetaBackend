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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Trust Wallet 수준으로 보수 완화:
 * maxFeePerGas ≈ baseFee * 1.2 + priorityFee
 * - provider.getFeeData() 값 신뢰 (없으면 보수적으로 계산)
 */
async function buildFees(provider, fallbackTipGwei = '5') {
  const feeData = await provider.getFeeData(); // { maxFeePerGas, maxPriorityFeePerGas, lastBaseFeePerGas }
  const latest = await provider.getBlock('latest');

  const base = bn(
    latest?.baseFeePerGas ??
    feeData?.lastBaseFeePerGas ??
    ethers.utils.parseUnits('20', 'gwei')
  );

  const tip = feeData?.maxPriorityFeePerGas?.gt(0)
    ? bn(feeData.maxPriorityFeePerGas)
    : ethers.utils.parseUnits(fallbackTipGwei, 'gwei');

  // base * 1.2 + tip  (상한 유도)
  const maxFee = base.mul(12).div(10).add(tip);

  // 하한/상한 클램프 (급격한 변동 방지)
  const minTip = ethers.utils.parseUnits('1', 'gwei');
  const maxTip = ethers.utils.parseUnits('15', 'gwei');
  const clampedTip = tip.lt(minTip) ? minTip : tip.gt(maxTip) ? maxTip : tip;

  // maxFee는 tip보다 항상 커야 함
  const clampedMaxFee = maxFee.gt(clampedTip.add(base)) ? maxFee : base.add(clampedTip);

  return { base, tip: clampedTip, maxFee: clampedMaxFee };
}

/**
 * Flashbots 번들 구조:
 * (1) sponsor -> compromised : 가스 펀딩
 * (2) compromised -> token transfer
 * 동일 블록에서 원자적 실행 (공개 mempool 우회)
 */
async function rescueBundle({
  provider,
  relayUrl,
  authWallet,        // 헤더서명 전용 (자금 불필요)
  sponsorWallet,     // 실제 ETH 보유 (가스 대납)
  compromisedWallet, // 토큰 보유/서명 가능한 위험 주소
  tokenAddress,
  toAddress,
  amountUnits,       // (선호) parseUnits 결과(정수)
  amountHuman,       // (옵션) "1.23" 같은 문자열 → decimals로 변환
  gasLimitHint = '130000',
  tipGwei = '5',
  // 너무 작은 여유는 재시도 중 baseFee 미세 상승 시 부족 오류 유발 → 소액 여유 유지
  extraFundEth = '0.00005',
  blocksToTry = 30,
  simulateRetries = 3,
  sendRetries = 3,
  reSignEachAttempt = true // 네트워크 변동 대응 위해 기본 true
}) {
  if (!provider || !relayUrl || !authWallet || !sponsorWallet || !compromisedWallet) {
    throw new Error('provider/relayUrl/authWallet/sponsorWallet/compromisedWallet are required');
  }

  const chainId = (await provider.getNetwork()).chainId;
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  // --- 전송 금액 단위 정리 ---
  let finalAmountUnits = amountUnits ? bn(amountUnits) : null;
  if (!finalAmountUnits && typeof amountHuman !== 'undefined') {
    const decimals = await token.decimals();
    finalAmountUnits = ethers.utils.parseUnits(String(amountHuman), decimals);
  }
  if (!finalAmountUnits) throw new Error('amountUnits or amountHuman is required');

  // --- transfer() 데이터 ---
  const data = token.interface.encodeFunctionData('transfer', [toAddress, finalAmountUnits]);

  // --- 가스 한도 추정 (되도록 실제 estimateGas 사용) ---
  let gasLimit;
  try {
    const est = await provider.estimateGas({
      from: compromisedWallet.address,
      to: tokenAddress,
      data
    });
    // 약간의 여유(5~10%)를 둬서 재시도 중 revert 방지
    gasLimit = bn(est).mul(11).div(10);
  } catch {
    gasLimit = bn(gasLimitHint);
  }

  // --- 논스 확보 (pending 기준) ---
  const compNonce = await provider.getTransactionCount(compromisedWallet.address, 'pending');
  const sponsorNonce = await provider.getTransactionCount(sponsorWallet.address, 'pending');

  // --- 수수료 (Trust Wallet 유사 계산) ---
  let { tip, maxFee } = await buildFees(provider, tipGwei);

  // --- 필요한 ETH(상한×가스한도 + 소액여유) 산출 ---
  // 상한은 실제 소비보다 클 수 있으나, EIP-1559 환불특성 + 번들 원자성 고려해 안전하게
  const needWeiCeil = bn(maxFee).mul(gasLimit);
  const needWei = needWeiCeil.add(ethers.utils.parseEther(String(extraFundEth)));

  // --- Flashbots provider ---
  const fb = await FlashbotsBundleProvider.create(provider, authWallet, relayUrl);

  // --- tx 생성 함수 (재서명 대비) ---
  const makeTokenTx = (curMaxFee, curTip) => ({
    to: tokenAddress,
    data,
    type: 2,
    maxFeePerGas: curMaxFee,
    maxPriorityFeePerGas: curTip,
    gasLimit,
    nonce: compNonce,
    chainId,
    value: 0
  });

  const makeFundTx = (curMaxFee, curTip, valueWei) => ({
    to: compromisedWallet.address,
    value: valueWei,
    type: 2,
    gasLimit: bn(21000),
    maxFeePerGas: curMaxFee,
    maxPriorityFeePerGas: curTip,
    nonce: sponsorNonce,
    chainId
  });

  const startBlock = await provider.getBlockNumber();
  let lastError = null;
  const attempts = [];

  for (let i = 1; i <= blocksToTry; i++) {
    const targetBlock = startBlock + i + 1;
    const entry = { targetBlock, simulateTries: [], sendTries: [] };

    // 블록마다 수수료 갱신 + 재서명 (기본 true) → “수수료 부족” 방지
    if (reSignEachAttempt) {
      const f = await buildFees(provider, tipGwei);
      tip = f.tip;
      maxFee = f.maxFee;
    }

    const tokenTx = makeTokenTx(maxFee, tip);
    const fundTx = makeFundTx(maxFee, tip, needWei);

    // --- 번들 서명 ---
    let signedBundle = null;
    try {
      signedBundle = await fb.signBundle([
        { signer: sponsorWallet, transaction: fundTx },
        { signer: compromisedWallet, transaction: tokenTx }
      ]);
    } catch (e) {
      lastError = e;
      return {
        status: 'sign_failed',
        triedBlocks: i - 1,
        lastError: e?.message || String(e),
        attempts
      };
    }

    // (루프 직전, 딱 한 번) 스폰서 잔액 체크 추가
    const sponsorBal = await provider.getBalance(sponsorWallet.address);
    const fundTxCostCeil = bn(21000).mul(maxFee); // 스폰서 자기 가스 상한
    const minSponsorNeed = needWei.add(fundTxCostCeil);
    if (sponsorBal.lt(minSponsorNeed)) {
      return {
        status: 'insufficient_sponsor_balance',
        detail: {
          sponsor: sponsorWallet.address,
          sponsorBal: sponsorBal.toString(),
          needWei: needWei.toString(),
          fundTxCostCeil: fundTxCostCeil.toString(),
          minSponsorNeed: minSponsorNeed.toString()
        }
      };
    }

    // --- simulate (재시도) ---
    let simOk = false;
    for (let s = 1; s <= simulateRetries; s++) {
      try {
        const sim = await fb.simulate(signedBundle, targetBlock);
        // 다양한 반환형 방어
        if ((Array.isArray(sim) && sim[0]?.error) || sim?.error) {
          const msg = (Array.isArray(sim) ? sim[0]?.error : sim?.error?.message) || 'simulate error';
          entry.simulateTries.push({ ok: false, msg });
          lastError = new Error(`simulate: ${msg}`);
          // 논리 실패는 반복 무의미 → 즉시 종료
          return {
            status: 'simulate_failed',
            triedBlocks: i,
            lastError: lastError.message,
            attempts: attempts.concat(entry)
          };
        }
        entry.simulateTries.push({ ok: true });
        simOk = true;
        break;
      } catch (e) {
        entry.simulateTries.push({ ok: false, msg: e?.message || String(e) });
        lastError = e;
        await sleep(250 * s);
      }
    }
    if (!simOk) {
      attempts.push(entry);
      return {
        status: 'simulate_failed',
        triedBlocks: i,
        lastError: lastError?.message || String(lastError),
        attempts
      };
    }

    // --- sendRawBundle (재시도) ---
    console.log('[BUNDLE] targetBlock=%d gasLimit=%s maxFee(gwei)=%s tip(gwei)=%s needWei(ETH)=%s sponsorBal(ETH)=%s',
      targetBlock,
      gasLimit.toString(),
      ethers.utils.formatUnits(maxFee, 'gwei'),
      ethers.utils.formatUnits(tip, 'gwei'),
      ethers.utils.formatEther(needWei),
      ethers.utils.formatEther(sponsorBal)
    );

    let resp = null;
    for (let t = 1; t <= sendRetries; t++) {
      try {
        resp = await fb.sendRawBundle(signedBundle, targetBlock);
        entry.sendTries.push({ ok: true });
        break;
      } catch (e) {
        entry.sendTries.push({
          ok: false,
          msg: e?.response?.data || e?.message || String(e),
          status: e?.response?.status
        });
        lastError = e;
        await sleep(600 * t);
      }
    }
    if (!resp) {
      attempts.push(entry);
      continue; // 다음 블록
    }

    // --- wait ---
    try {
      const code = await resp.wait(); // 0: included, 1: not included
      if (code === 0) {
        // 포함 → 해시 제공
        const rawFund = await sponsorWallet.signTransaction(fundTx);
        const rawTok  = await compromisedWallet.signTransaction(tokenTx);
        return {
          status: 'included',
          includedBlock: targetBlock,
          fundTxHash: ethers.utils.keccak256(rawFund),
          tokenTxHash: ethers.utils.keccak256(rawTok),
          attempts
        };
      } else {
        attempts.push(entry);
      }
    } catch (e) {
      entry.waitError = e?.response?.data || e?.message || String(e);
      console.log('[WAIT] error targetBlock=%d err=%s', targetBlock, entry.waitError);
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
