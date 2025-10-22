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

/** 기본 힌트 (TrustWallet 유사): base * 1.2 + tip */
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

  const maxFee = base.mul(12).div(10).add(tip);

  // 안전 클램프
  const minTip = ethers.utils.parseUnits('1', 'gwei');
  const maxTip = ethers.utils.parseUnits('200', 'gwei'); // 상한 넓게
  const clampedTip = tip.lt(minTip) ? minTip : tip.gt(maxTip) ? maxTip : tip;
  const clampedMaxFee = maxFee.gt(clampedTip.add(base)) ? maxFee : base.add(clampedTip);

  return { base, tip: clampedTip, maxFee: clampedMaxFee };
}

/** 스폰서 잔액으로부터 "허용 가능한 최대 tip(gwei)" 계산 */
function computeMaxTipGweiCap({
  sponsorBalWei,
  baseWei,          // baseFeePerGas (wei)
  gasLimit,         // BigNumber
  extraFundWei,     // BigNumber
}) {
  // 총 필요 ETH = (tokenTx 가스 상한 + fundTx 가스 상한) * tip  +  (tokenTx 가스 상한 * base*0.3) + extraFund
  // 램프에서 maxFee = base*1.3 + tip 으로 잡을 것이므로,
  //   tokenTx 상한: (base*1.3 + tip) * gasLimit
  //   sponsorTx 상한: (base*1.3 + tip) * 21000
  // 총합 = (gasLimit + 21000) * tip  +  (gasLimit + 21000) * base*1.3  + extraFund
  // → tip 상한 = floor( (sponsorBal - extraFund - (gasLimit+21000)*base*1.3) / (gasLimit+21000) )
  const totalGas = gasLimit.add(bn(21000));          // BigNumber
  const base13 = baseWei.mul(13).div(10);            // base*1.3
  const fixedPart = totalGas.mul(base13).add(extraFundWei); // base*1.3 부분 + 여유금
  if (sponsorBalWei.lte(fixedPart)) return bn(0);

  const tipWeiMax = sponsorBalWei.sub(fixedPart).div(totalGas); // wei
  // gwei 숫자로 변환(정수)
  const tipGweiMax = bn(ethers.utils.formatUnits(tipWeiMax, 'gwei').split('.')[0]);
  return tipGweiMax;
}

async function rescueBundle({
  provider,
  relayUrl,
  authWallet,
  sponsorWallet,
  compromisedWallet,
  tokenAddress,
  toAddress,
  amountUnits,
  amountHuman,
  gasLimitHint = '130000',
  tipGwei = '5',
  extraFundEth = '0.00003', // 줄여서 tip 여지 확보
  blocksToTry = 30,
  simulateRetries = 1,
  sendRetries = 2,
  reSignEachAttempt = true,
}) {
  if (!provider || !relayUrl || !authWallet || !sponsorWallet || !compromisedWallet) {
    throw new Error('provider/relayUrl/authWallet/sponsorWallet/compromisedWallet are required');
  }

  // 네트워크/릴레이 체크
  const { chainId, name } = await provider.getNetwork();
  console.log('[NET] chainId=%d name=%s relay=%s', chainId, name, relayUrl);
  if (relayUrl.includes('flashbots.net') && chainId !== 1) {
    throw new Error(`Flashbots mainnet relay only. chainId=${chainId}`);
  }

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  // 금액 단위 정리
  let finalAmountUnits = amountUnits ? bn(amountUnits) : null;
  if (!finalAmountUnits && typeof amountHuman !== 'undefined') {
    const decimals = await token.decimals();
    finalAmountUnits = ethers.utils.parseUnits(String(amountHuman), decimals);
  }
  if (!finalAmountUnits) throw new Error('amountUnits or amountHuman is required');

  const data = token.interface.encodeFunctionData('transfer', [toAddress, finalAmountUnits]);

  // 가스 한도 (12% 여유)
  let gasLimit;
  try {
    const est = await provider.estimateGas({
      from: compromisedWallet.address,
      to: tokenAddress,
      data,
    });
    gasLimit = bn(est).mul(112).div(100);
  } catch {
    gasLimit = bn(gasLimitHint);
  }

  // 논스
  const compNonce = await provider.getTransactionCount(compromisedWallet.address, 'pending');
  const sponsorNonce = await provider.getTransactionCount(sponsorWallet.address, 'pending');
  console.log('[NONCE] compNonce=%d sponsorNonce=%d', compNonce, sponsorNonce);

  // Flashbots provider
  const fb = await FlashbotsBundleProvider.create(provider, authWallet, relayUrl);

  // Tx 빌더
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

  // 사전 로그
  const sponsorBal = await provider.getBalance(sponsorWallet.address);
  const compBal = await provider.getBalance(compromisedWallet.address);
  const sponsorNoncePending = await provider.getTransactionCount(sponsorWallet.address, 'pending');
  const compNoncePending = await provider.getTransactionCount(compromisedWallet.address, 'pending');
  console.log('[PRECHECK] sponsor=%s bal=%s nonce_pend=%d, compromised=%s bal=%s nonce_pend=%d',
    sponsorWallet.address, ethers.utils.formatEther(sponsorBal), sponsorNoncePending,
    compromisedWallet.address, ethers.utils.formatEther(compBal), compNoncePending
  );

  // 초기 수수료 힌트
  const { base } = await buildFees(provider, tipGwei);
  console.log('[FEE_HINT] base≈%s gwei', ethers.utils.formatUnits(base, 'gwei'));

  // 현재 잔액으로 허용 가능한 tip 상한 계산
  const extraFundWei = ethers.utils.parseEther(String(extraFundEth));
  const maxTipGweiCap = computeMaxTipGweiCap({
    sponsorBalWei: sponsorBal,
    baseWei: base,
    gasLimit,
    extraFundWei,
  });

  const tipCapNum = Number(maxTipGweiCap.toString());
  if (tipCapNum <= 0) {
    return {
      status: 'insufficient_sponsor_balance_for_any_tip',
      detail: {
        sponsorBal: ethers.utils.formatEther(sponsorBal),
        tipCapGwei: tipCapNum,
      }
    };
  }

  // 후보 생성: cap에 맞춰 공격적으로
  const tipCandidates = Array.from(new Set([
    Math.max(1, Math.floor(tipCapNum * 0.5)),
    Math.max(1, Math.floor(tipCapNum * 0.75)),
    tipCapNum
  ])).map(String);

  console.log('[TIP_CAP] maxTip≈%d gwei, candidates=%o', tipCapNum, tipCandidates);

  const attempts = [];
  let lastError = null;

  for (let i = 1; i <= blocksToTry; i++) {
    const currentBlock = await provider.getBlockNumber();
    const targetBlock = currentBlock + 1;
    const entry = { targetBlock, tries: [] };

    let included = null;

    for (const tipG of tipCandidates) {
      // 수수료 재계산 (base*1.3 + tip)
      const latestBlock = await provider.getBlock('latest');
      const baseCurr = bn(
        latestBlock?.baseFeePerGas ??
        (await provider.getFeeData())?.lastBaseFeePerGas ??
        ethers.utils.parseUnits('20', 'gwei')
      );
      const candidateTip = ethers.utils.parseUnits(tipG, 'gwei');
      const candidateMaxFee = baseCurr.mul(13).div(10).add(candidateTip);

      // 펀딩액: 상한*가스 + 여유
      const needWeiCandidate = candidateMaxFee.mul(gasLimit).add(extraFundWei);

      // 스폰서 자기 가스 상한
      const fundTxCostCeilCandidate = bn(21000).mul(candidateMaxFee);
      const minSponsorNeedCandidate = needWeiCandidate.add(fundTxCostCeilCandidate);
      const sponsorBalNow = await provider.getBalance(sponsorWallet.address);
      if (sponsorBalNow.lt(minSponsorNeedCandidate)) {
        entry.tries.push({ tip: tipG, stage: 'balance', ok: false, msg: 'sponsor low', sponsorBal: ethers.utils.formatEther(sponsorBalNow) });
        continue;
      }

      const tokenTxAttempt = makeTokenTx(candidateMaxFee, candidateTip);
      const fundTxAttempt  = makeFundTx(candidateMaxFee, candidateTip, needWeiCandidate);

      console.log('[RAMP] target=%d tip=%s gwei base=%s gwei maxFee=%s gwei needWei=%s ETH',
        targetBlock,
        tipG,
        ethers.utils.formatUnits(baseCurr, 'gwei'),
        ethers.utils.formatUnits(candidateMaxFee, 'gwei'),
        ethers.utils.formatEther(needWeiCandidate)
      );

      // 서명
      let signedAttempt;
      try {
        signedAttempt = await fb.signBundle([
          { signer: sponsorWallet, transaction: fundTxAttempt },
          { signer: compromisedWallet, transaction: tokenTxAttempt },
        ]);
      } catch (e) {
        entry.tries.push({ tip: tipG, stage: 'sign', ok: false, msg: e?.message || String(e) });
        lastError = e;
        continue;
      }

      // simulate
      let simOk = false;
      for (let s = 1; s <= simulateRetries; s++) {
        try {
          const sim = await fb.simulate(signedAttempt, targetBlock);
          if ((Array.isArray(sim) && sim[0]?.error) || sim?.error) {
            const msg = (Array.isArray(sim) ? sim[0]?.error : sim?.error?.message) || 'simulate error';
            entry.tries.push({ tip: tipG, stage: 'simulate', ok: false, msg });
            lastError = new Error(msg);
          } else {
            entry.tries.push({ tip: tipG, stage: 'simulate', ok: true });
            simOk = true;
          }
          break;
        } catch (e) {
          entry.tries.push({ tip: tipG, stage: 'simulate', ok: false, msg: e?.message || String(e) });
          lastError = e;
          await sleep(150 * s);
        }
      }
      if (!simOk && simulateRetries > 0) continue;

      // 전송 + 대기
      let respAttempt = null;
      for (let t = 1; t <= sendRetries; t++) {
        try {
          respAttempt = await fb.sendRawBundle(signedAttempt, targetBlock);
          entry.tries.push({ tip: tipG, stage: 'send', ok: true, try: t });
          break;
        } catch (e) {
          entry.tries.push({
            tip: tipG, stage: 'send', ok: false, try: t,
            msg: e?.response?.data || e?.message || String(e),
            status: e?.response?.status
          });
          lastError = e;
          await sleep(300 * t);
        }
      }
      if (!respAttempt) continue;

      try {
        const code = await respAttempt.wait(); // 0: included, 1: not included
        entry.tries.push({ tip: tipG, stage: 'wait', ok: code === 0, code });
        if (code === 0) {
          const rawFund = await sponsorWallet.signTransaction(fundTxAttempt);
          const rawTok  = await compromisedWallet.signTransaction(tokenTxAttempt);
          return {
            status: 'included',
            includedBlock: targetBlock,
            fundTxHash: ethers.utils.keccak256(rawFund),
            tokenTxHash: ethers.utils.keccak256(rawTok),
            tipUsedGwei: tipG,
            attempts: attempts.concat(entry),
          };
        }
      } catch (e) {
        entry.tries.push({ tip: tipG, stage: 'wait', ok: false, msg: e?.message || String(e) });
        lastError = e;
      }
    } // tip candidates

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
