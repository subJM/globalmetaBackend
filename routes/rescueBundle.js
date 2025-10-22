// services/rescueBundle.js
require('dotenv').config();
const { ethers } = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');

const ERC20_ABI = [
  'function transfer(address to,uint256 value) returns (bool)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
];

const bn = (x) => ethers.BigNumber.from(String(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 기본 수수료 힌트: base * 1.2 + tip (TrustWallet 유사)
 */
async function buildFees(provider, fallbackTipGwei = '5') {
  const feeData = await provider.getFeeData();
  const latest = await provider.getBlock('latest');

  const base = bn(
    latest?.baseFeePerGas ??
      feeData?.lastBaseFeePerGas ??
      ethers.utils.parseUnits('20', 'gwei')
  );

  const tip = feeData?.maxPriorityFeePerGas?.gt(0)
    ? bn(feeData.maxPriorityFeePerGas)
    : ethers.utils.parseUnits(fallbackTipGwei, 'gwei');

  // base * 1.2 + tip
  const maxFee = base.mul(12).div(10).add(tip);

  // 안전 클램프
  const minTip = ethers.utils.parseUnits('1', 'gwei');
  const maxTip = ethers.utils.parseUnits('60', 'gwei');
  const clampedTip = tip.lt(minTip) ? minTip : tip.gt(maxTip) ? maxTip : tip;

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
  amountHuman,       // (옵션) "1.23" → decimals로 변환
  gasLimitHint = '130000',
  tipGwei = '5',
  extraFundEth = '0.00010', // 소폭 상향: 블록간 base 변동 흡수
  blocksToTry = 30,
  simulateRetries = 1,
  sendRetries = 2,
  reSignEachAttempt = true,
}) {
  if (!provider || !relayUrl || !authWallet || !sponsorWallet || !compromisedWallet) {
    throw new Error('provider/relayUrl/authWallet/sponsorWallet/compromisedWallet are required');
  }

  // 네트워크/릴레이 호환성 체크
  const { chainId, name } = await provider.getNetwork();
  console.log('[NET] chainId=%d name=%s relay=%s', chainId, name, relayUrl);
  if (relayUrl.includes('flashbots.net') && chainId !== 1) {
    throw new Error(`Flashbots mainnet relay only. Your chainId=${chainId}`);
  }

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

  // --- 가스 한도 추정 (estimateGas 권장) ---
  let gasLimit;
  try {
    const est = await provider.estimateGas({
      from: compromisedWallet.address,
      to: tokenAddress,
      data,
    });
    // 25% 여유(공격적 OOG 방지)
    gasLimit = bn(est).mul(125).div(100);
  } catch {
    gasLimit = bn(gasLimitHint);
  }

  // --- 논스 확보 (pending 기준) ---
  const compNonce = await provider.getTransactionCount(compromisedWallet.address, 'pending');
  const sponsorNonce = await provider.getTransactionCount(sponsorWallet.address, 'pending');
  console.log('[NONCE] compNonce=%d sponsorNonce=%d', compNonce, sponsorNonce);

  // --- Flashbots provider ---
  const fb = await FlashbotsBundleProvider.create(provider, authWallet, relayUrl);

  // --- tx 생성 함수 ---
  const makeTokenTx = (curMaxFee, curTip) => ({
    to: tokenAddress,
    data,
    type: 2,
    maxFeePerGas: curMaxFee,
    maxPriorityFeePerGas: curTip,
    gasLimit,
    nonce: compNonce,
    chainId,
    value: 0,
  });

  const makeFundTx = (curMaxFee, curTip, valueWei) => ({
    to: compromisedWallet.address,
    value: valueWei,
    type: 2,
    gasLimit: bn(21000),
    maxFeePerGas: curMaxFee,
    maxPriorityFeePerGas: curTip,
    nonce: sponsorNonce,
    chainId,
  });

  // 사전 진단 로그
  const sponsorBal = await provider.getBalance(sponsorWallet.address);
  const compBal = await provider.getBalance(compromisedWallet.address);
  const sponsorNoncePending = await provider.getTransactionCount(sponsorWallet.address, 'pending');
  const compNoncePending = await provider.getTransactionCount(compromisedWallet.address, 'pending');
  console.log('[PRECHECK] sponsor=%s bal=%s nonce_pend=%d, compromised=%s bal=%s nonce_pend=%d',
    sponsorWallet.address, ethers.utils.formatEther(sponsorBal), sponsorNoncePending,
    compromisedWallet.address, ethers.utils.formatEther(compBal), compNoncePending
  );

  // 초기 수수료 힌트
  const { base, tip, maxFee } = await buildFees(provider, tipGwei);
  console.log('[FEE_HINT] base≈%s gwei tip≈%s gwei maxFee≈%s gwei',
    ethers.utils.formatUnits(base, 'gwei'),
    ethers.utils.formatUnits(tip, 'gwei'),
    ethers.utils.formatUnits(maxFee, 'gwei')
  );

  const attempts = [];
  let lastError = null;

  for (let i = 1; i <= blocksToTry; i++) {
    // 매 루프마다 바로 다음 블록 지정
    const currentBlock = await provider.getBlockNumber();
    const targetBlock = currentBlock + 1;
    const entry = { targetBlock, tries: [] };

    // tip 램프 (잔액 0.00999 ETH 내에서 충분히 가능)
    const tipCandidatesGwei = ['20', '40', '80', '120'];
    let included = null;

    for (let tipIdx = 0; tipIdx < tipCandidatesGwei.length && !included; tipIdx++) {
      // 수수료 재계산: base * 1.3 + tipCandidate
      const latestBlock = await provider.getBlock('latest');
      const baseCurr = bn(
        latestBlock?.baseFeePerGas ??
          (await provider.getFeeData())?.lastBaseFeePerGas ??
          ethers.utils.parseUnits('20', 'gwei')
      );
      const candidateTip = ethers.utils.parseUnits(tipCandidatesGwei[tipIdx], 'gwei');
      const candidateMaxFee = baseCurr.mul(13).div(10).add(candidateTip);

      // 펀딩액 재계산: 상한×가스한도 + 여유
      const needWeiCandidate = candidateMaxFee.mul(gasLimit).add(
        ethers.utils.parseEther(String(extraFundEth))
      );

      // 스폰서 잔액 재검증 (자기 tx 가스 상한 포함)
      const sponsorBalNow = await provider.getBalance(sponsorWallet.address);
      const fundTxCostCeilCandidate = bn(21000).mul(candidateMaxFee);
      const minSponsorNeedCandidate = needWeiCandidate.add(fundTxCostCeilCandidate);
      if (sponsorBalNow.lt(minSponsorNeedCandidate)) {
        console.log('[RAMP] skip tip=%s gwei — sponsor low: bal=%s need=%s',
          tipCandidatesGwei[tipIdx],
          ethers.utils.formatEther(sponsorBalNow),
          ethers.utils.formatEther(minSponsorNeedCandidate)
        );
        continue;
      }

      const tokenTxAttempt = makeTokenTx(candidateMaxFee, candidateTip);
      const fundTxAttempt  = makeFundTx(candidateMaxFee, candidateTip, needWeiCandidate);

      console.log('[RAMP] target=%d tip=%s gwei base=%s gwei maxFee=%s gwei needWei=%s ETH',
        targetBlock,
        tipCandidatesGwei[tipIdx],
        ethers.utils.formatUnits(baseCurr, 'gwei'),
        ethers.utils.formatUnits(candidateMaxFee, 'gwei'),
        ethers.utils.formatEther(needWeiCandidate)
      );

      // 번들 서명
      let signedAttempt;
      try {
        signedAttempt = await fb.signBundle([
          { signer: sponsorWallet, transaction: fundTxAttempt },
          { signer: compromisedWallet, transaction: tokenTxAttempt },
        ]);
      } catch (e) {
        entry.tries.push({ tip: tipCandidatesGwei[tipIdx], stage: 'sign', ok: false, msg: e?.message || String(e) });
        lastError = e;
        continue;
      }

      // simulate (빠른 실패 감지)
      let simOk = false;
      for (let s = 1; s <= simulateRetries; s++) {
        try {
          const sim = await fb.simulate(signedAttempt, targetBlock);
          if ((Array.isArray(sim) && sim[0]?.error) || sim?.error) {
            const msg = (Array.isArray(sim) ? sim[0]?.error : sim?.error?.message) || 'simulate error';
            entry.tries.push({ tip: tipCandidatesGwei[tipIdx], stage: 'simulate', ok: false, msg });
            lastError = new Error(msg);
          } else {
            entry.tries.push({ tip: tipCandidatesGwei[tipIdx], stage: 'simulate', ok: true });
            simOk = true;
          }
          break;
        } catch (e) {
          entry.tries.push({ tip: tipCandidatesGwei[tipIdx], stage: 'simulate', ok: false, msg: e?.message || String(e) });
          lastError = e;
          await sleep(200 * s);
        }
      }
      if (!simOk && simulateRetries > 0) continue;

      // 전송 + 대기
      let respAttempt = null;
      for (let t = 1; t <= sendRetries; t++) {
        try {
          respAttempt = await fb.sendRawBundle(signedAttempt, targetBlock);
          entry.tries.push({ tip: tipCandidatesGwei[tipIdx], stage: 'send', ok: true, try: t });
          break;
        } catch (e) {
          entry.tries.push({
            tip: tipCandidatesGwei[tipIdx],
            stage: 'send',
            ok: false,
            try: t,
            msg: e?.response?.data || e?.message || String(e),
            status: e?.response?.status
          });
          lastError = e;
          await sleep(400 * t);
        }
      }
      if (!respAttempt) continue;

      try {
        const code = await respAttempt.wait(); // 0: included, 1: not included
        entry.tries.push({ tip: tipCandidatesGwei[tipIdx], stage: 'wait', ok: code === 0, code });
        if (code === 0) {
          // 성공: 이번 시도 트랜잭션으로 해시 계산
          const rawFund = await sponsorWallet.signTransaction(fundTxAttempt);
          const rawTok  = await compromisedWallet.signTransaction(tokenTxAttempt);
          return {
            status: 'included',
            includedBlock: targetBlock,
            fundTxHash: ethers.utils.keccak256(rawFund),
            tokenTxHash: ethers.utils.keccak256(rawTok),
            tipUsedGwei: tipCandidatesGwei[tipIdx],
            attempts: attempts.concat(entry),
          };
        }
        // 미포함이면 다음 tip 후보
      } catch (e) {
        entry.tries.push({ tip: tipCandidatesGwei[tipIdx], stage: 'wait', ok: false, msg: e?.message || String(e) });
        lastError = e;
      }
    } // tip ramp

    attempts.push(entry);
    console.log('[FINAL_BLOCK] not included at target=%d — try next block', targetBlock);
  }

  return {
    status: 'not_included',
    triedBlocks: blocksToTry,
    lastError: lastError?.message || String(lastError || ''),
    attempts,
  };
}

module.exports = { rescueBundle };
