// services/rescueBundle.js
require('dotenv').config();
const { ethers } = require('ethers');
const crypto = require('crypto');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');

const ERC20_ABI = [
  'function transfer(address to,uint256 value) returns (bool)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  // optional/common guards (best-effort)
  'function paused() view returns (bool)',
  'function isBlacklisted(address) view returns (bool)',
  'function isBlackListed(address) view returns (bool)', // some variants
];

const bn = (x) => ethers.BigNumber.from(String(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ---------- 공통 유틸 ---------- */

// 간단 fetch (Node18+) : 없는 환경이면 node-fetch 설치해서 대체
const doFetch = (...args) => (globalThis.fetch ? fetch(...args) : import('node-fetch').then(m => m.default(...args)));

// 번들용 raw txs 만들기
async function buildRawBundleTxs(sponsorWallet, fundTx, compromisedWallet, tokenTx) {
  const rawFund = await sponsorWallet.signTransaction(fundTx);
  const rawTok  = await compromisedWallet.signTransaction(tokenTx);
  return [rawFund, rawTok];
}

// 다수 릴레이로 동시에 보내기

async function broadcastBundleToRelays({ relays, authWallet, rawTxs, targetBlockHex }) {
  if (!relays || !relays.length) return [];
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendBundle',
    params: [{ txs: rawTxs, blockNumber: targetBlockHex }]
  };
  const sigPayload = crypto.randomBytes(8).toString('hex');
  const sig = await authWallet.signMessage(sigPayload);
  const signatureHeader = `${authWallet.address}:${sig}`;

  const results = await Promise.allSettled(relays.map(async (url) => {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        'X-Flashbots-Signature': signatureHeader
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    return { url, ok: res.ok, status: res.status, body: text.slice(0, 300) };
  }));

  console.log('[MULTI-RELAY]', results);
  return results;
}
// === END utils ===

// revert reason 최대한 뽑아내기
function decodeRevert(e) {
  try {
    const data = e?.error?.data || e?.data || e?.error?.error?.data;
    if (typeof data === 'string') {
      // Panic/Custom Error signature가 포함된 경우 텍스트로만 노출
      return `revert: ${data.slice(0, 200)}`;
    }
    return e?.message || String(e);
  } catch (_) {
    return e?.message || String(e);
  }
}

// 안전한 선택적 호출 (없으면 false/undefined)
async function safeReadBool(contract, fn, args = []) {
  if (!contract.interface.functions[fn]) return undefined;
  try { return await contract[fn](...args); } catch { return undefined; }
}

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
  const maxTip = ethers.utils.parseUnits('200', 'gwei');
  const clampedTip = tip.lt(minTip) ? minTip : tip.gt(maxTip) ? maxTip : tip;
  const clampedMaxFee = maxFee.gt(clampedTip.add(base)) ? maxFee : base.add(clampedTip);

  return { base, tip: clampedTip, maxFee: clampedMaxFee };
}

/** 스폰서 잔액으로부터 "허용 가능한 최대 tip(gwei)" 계산 */
function computeMaxTipGweiCap({ sponsorBalWei, baseWei, gasLimit, extraFundWei }) {
  const totalGas = gasLimit.add(bn(21000));
  const base13 = baseWei.mul(13).div(10); // base*1.3
  const fixedPart = totalGas.mul(base13).add(extraFundWei);
  if (sponsorBalWei.lte(fixedPart)) return bn(0);
  const tipWeiMax = sponsorBalWei.sub(fixedPart).div(totalGas);
  const tipGweiMax = bn(ethers.utils.formatUnits(tipWeiMax, 'gwei').split('.')[0]); // floor
  return tipGweiMax;
}

/** ---------- 원인 진단(핵심) ---------- */
async function diagnoseEnvironment({
  provider,
  wsProvider,               // optional: WebSocketProvider
  token,
  from, to,
  amountUnits,
  compNonceChosen,
  gasLimit,
  extraFundEth,
}) {
  const logs = [];

  // 1) nonce 상황
  const latestNonce  = await provider.getTransactionCount(from, 'latest');
  const pendingNonce = await provider.getTransactionCount(from, 'pending');
  logs.push({ kind: 'nonce', latestNonce, pendingNonce, compNonceChosen });

  if (pendingNonce > latestNonce) {
    logs.push({ kind: 'warn', msg: 'pending nonce > latest nonce → 공개 mempool에 대기 tx 존재(경쟁 가능성 높음)' });
  }

  // 2) 토큰 상태/리스크
  let decimals = 18, bal = null, paused = undefined, black1 = undefined, black2 = undefined;
  try { decimals = await token.decimals(); } catch {}
  try { bal = await token.balanceOf(from); } catch {}

  paused = await safeReadBool(token, 'paused');
  black1 = await safeReadBool(token, 'isBlacklisted', [from]);
  black2 = (black1 === undefined) ? await safeReadBool(token, 'isBlackListed', [from]) : undefined;

  logs.push({
    kind: 'token',
    decimals,
    balance: bal ? ethers.utils.formatUnits(bal, decimals) : null,
    paused,
    isBlacklisted: black1 !== undefined ? black1 : black2,
  });

  // 3) 사전 실행(callStatic)로 리버트 원인 잡기
  try {
    await token.callStatic.transfer(to, amountUnits, { from });
    logs.push({ kind: 'callStatic', ok: true });
  } catch (e) {
    logs.push({ kind: 'callStatic', ok: false, reason: decodeRevert(e) });
  }

  // 4) (옵션) 동일 nonce 경쟁 tx 스NI핑 (5초)
  if (wsProvider && typeof wsProvider.on === 'function') {
    const seen = [];
    let count = 0;
    const handler = async (txHash) => {
      try {
        const tx = await wsProvider.getTransaction(txHash);
        if (!tx || !tx.from) return;
        if (tx.from.toLowerCase() !== from.toLowerCase()) return;
        if (tx.nonce === compNonceChosen) {
          count++;
          seen.push({
            hash: tx.hash,
            nonce: tx.nonce,
            type: tx.type,
            gasPrice: tx.gasPrice ? ethers.utils.formatUnits(tx.gasPrice, 'gwei') : null,
            maxFeePerGas: tx.maxFeePerGas ? ethers.utils.formatUnits(tx.maxFeePerGas, 'gwei') : null,
            maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? ethers.utils.formatUnits(tx.maxPriorityFeePerGas, 'gwei') : null,
          });
        }
      } catch {}
    };
    logs.push({ kind: 'watch', msg: 'pending 구독 시작(5s)…' });
    wsProvider.on('pending', handler);
    await sleep(5000);
    wsProvider.off('pending', handler);
    logs.push({ kind: 'watchResult', competingCount: count, samples: seen.slice(0, 5) });
  } else {
    logs.push({ kind: 'watch', msg: 'wsProvider 없음 → pending 스니핑 스킵' });
  }

  // 5) 참고 정보
  logs.push({
    kind: 'gasHint',
    gasLimit: gasLimit.toString(),
    extraFundEth,
  });

  // 콘솔에 보기 좋게
  console.log('[DIAG]', JSON.stringify(logs, null, 2));
  return logs;
}

/** ---------- 메인 함수 ---------- */
async function rescueBundle({
  provider,
  wsProvider,          // <=== 추가: 선택적 WebSocketProvider (mempool 진단용)
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
  extraFundEth = '0.00003',
  blocksToTry = 30,
  simulateRetries = 1,
  sendRetries = 2,
  reSignEachAttempt = true,
}) {
  if (!provider || !relayUrl || !authWallet || !sponsorWallet || !compromisedWallet) {
    throw new Error('provider/relayUrl/authWallet/sponsorWallet/compromisedWallet are required');
  }
  // rescueBundle 시작 직후(또는 루프 시작 전에 1회)
  const extraRelays = (process.env.EXTRA_RELAYS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
  console.log('[RELAYS]', { flashbots: relayUrl, extraRelays });
  
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
    // const est = await provider.estimateGas({ from: compromisedWallet.address, to: tokenAddress, data });
    // gasLimit = bn(est).mul(112).div(100);
    // 일시 테스트: 1.5배
    const est = await provider.estimateGas({ from: compromisedWallet.address, to: tokenAddress, data });
    gasLimit = bn(est).mul(150  ).div(100);
    console.log('[GASLIMIT_TEST]', est.toString(), '->', gasLimit.toString());
  } catch {
    gasLimit = bn(gasLimitHint);
  }

  // 논스
  const compNonce = await provider.getTransactionCount(compromisedWallet.address, 'pending');
  const sponsorNonce = await provider.getTransactionCount(sponsorWallet.address, 'pending');
  console.log('[NONCE] compNonce=%d sponsorNonce=%d', compNonce, sponsorNonce);

  // === ADD: NONCE_CHECK ===
  const latestNonce  = await provider.getTransactionCount(compromisedWallet.address, 'latest');
  const pendingNonce = await provider.getTransactionCount(compromisedWallet.address, 'pending');
  console.log('[NONCE_CHECK] latest=%d pending=%d delta=%d ourNonce=%d',
    latestNonce, pendingNonce, (pendingNonce - latestNonce), compNonce);
  // ========================

  // —— 여기서 “원인 진단”을 먼저 수행 —— //
  await diagnoseEnvironment({
    provider,
    wsProvider, // 없으면 스킵
    token,
    from: compromisedWallet.address,
    to: toAddress,
    amountUnits: finalAmountUnits,
    compNonceChosen: compNonce,
    gasLimit,
    extraFundEth,
  });

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
  console.log('[PRECHECK] sponsor=%s bal=%s, compromised=%s bal=%s',
    sponsorWallet.address, ethers.utils.formatEther(sponsorBal),
    compromisedWallet.address, ethers.utils.formatEther(compBal)
  );

  // 초기 수수료 힌트 & tip 상한 계산
  const { base } = await buildFees(provider, tipGwei);
  console.log('[FEE_HINT] base≈%s gwei', ethers.utils.formatUnits(base, 'gwei'));

  const extraFundWei = ethers.utils.parseEther(String(extraFundEth));
  const maxTipGweiCap = computeMaxTipGweiCap({ sponsorBalWei: sponsorBal, baseWei: base, gasLimit, extraFundWei });
  const tipCapNum = Number(maxTipGweiCap.toString());
  if (tipCapNum <= 0) {
    return { status: 'insufficient_sponsor_balance_for_any_tip', detail: { sponsorBal: ethers.utils.formatEther(sponsorBal), tipCapGwei: tipCapNum } };
  }
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
      const targets = [currentBlock + 2, currentBlock + 3]; // lead 2~3
      for (const targetBlock of targets) {
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

      // 스폰서 자기 가스 상한 포함
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
      let simOk = false, simMsg = 'ok';
      for (let s = 1; s <= simulateRetries; s++) {
        try {
          const sim = await fb.simulate(signedAttempt, targetBlock);
          console.log('[SIM]', JSON.stringify(sim, null, 2).slice(0, 1200));
          if ((Array.isArray(sim) && sim[0]?.error) || sim?.error) {
            simMsg = (Array.isArray(sim) ? sim[0]?.error : sim?.error?.message) || 'simulate error';
            entry.tries.push({ tip: tipG, stage: 'simulate', ok: false, msg: simMsg });
            lastError = new Error(simMsg);
          } else {
            entry.tries.push({ tip: tipG, stage: 'simulate', ok: true });
            simOk = true;
          }
            // 일부 구현은 { results: [...], coinbaseDiff } 형태
          const coinbaseDiff = sim?.coinbaseDiff ?? sim?.results?.[0]?.coinbaseDiff;
          if (coinbaseDiff) console.log('[SIM_PROFIT] coinbaseDiff', coinbaseDiff.toString());
          break;
        } catch (e) {
          simMsg = decodeRevert(e);
          entry.tries.push({ tip: tipG, stage: 'simulate', ok: false, msg: simMsg });
          lastError = e;
          await sleep(150 * s);
        }
      }
      if (!simOk && simulateRetries > 0) {
        // 시뮬 실패 사유를 명확히 로그하고 다음 tip로
        console.log('[SIM_FAIL_REASON]', simMsg);
        continue;
      }

      // 전송 + 대기
      // ① raw 번들 만들기
      const rawTxs = await buildRawBundleTxs(sponsorWallet, fundTxAttempt, compromisedWallet, tokenTxAttempt);

      // ② 타깃 블록 16진수
      const targetHex = '0x' + targetBlock.toString(16);

      // ③ 추가 릴레이 목록 (예시)
      const extraRelays = (process.env.EXTRA_RELAYS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      // ④ 멀티 릴레이 전송 (Flashbots와 병행)
      if (extraRelays.length) {
        broadcastBundleToRelays({
          relays: extraRelays,
          authWallet,
          rawTxs,
          targetBlockHex: targetHex
        }).catch(()=>{});
      }
      console.log('[MULTI-RELAY-SUMMARY]', resMulti.map(r => ({ url: r.url, ok: r.ok, status: r.status })));
      s
      // ⑤ 기존 Flashbots 경로도 그대로 유지
      let respAttempt = null;
      for (let t = 1; t <= sendRetries; t++) {
        try {
          respAttempt = await fb.sendRawBundle(signedAttempt, targetBlock);
          entry.tries.push({ tip: tipG, stage: 'send', ok: true, try: t });
          break;
        } catch (e) {
          entry.tries.push({ tip: tipG, stage: 'send', ok: false, try: t, msg: e?.response?.data || e?.message || String(e), status: e?.response?.status });
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
