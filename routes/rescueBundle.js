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

// Node18+ fetch (없으면 node-fetch 사용)
const doFetch = (...args) =>
  (globalThis.fetch ? fetch(...args) : import('node-fetch').then(m => m.default(...args)));

function decodeRevert(e) {
  try {
    const data = e?.error?.data || e?.data || e?.error?.error?.data;
    if (typeof data === 'string') return `revert: ${data.slice(0, 200)}`;
    return e?.message || String(e);
  } catch {
    return e?.message || String(e);
  }
}

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

/** 번들 raw txs */
async function buildRawBundleTxs(sponsorWallet, fundTx, compromisedWallet, tokenTx) {
  const rawFund = await sponsorWallet.signTransaction(fundTx);
  const rawTok  = await compromisedWallet.signTransaction(tokenTx);
  return [rawFund, rawTok];
}

/** (참고용) 추가 릴레이 URL 정리 — 서처가 eth_sendBundle 칠 수 없는 릴레이는 자동 제외 */
function normalizeRelayUrls(raw) {
  return (raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(u => {
      try {
        const url = new URL(u);
        if (url.username || url.password) {
          url.username = '';
          url.password = '';
          console.warn('[RELAYS] stripped credentials from', u, '=>', url.toString());
        }
        return url.toString();
      } catch {
        console.warn('[RELAYS] invalid url skipped:', u);
        return null;
      }
    })
    .filter(Boolean)
    .filter(u => {
      const host = new URL(u).host;
      const unsupported =
        host.includes('boost-relay.flashbots.net') || // mev-boost (validator용, 405)
        host.includes('blxrbdn.com') ||               // bloXroute는 전용 API 필요
        host.includes('aestus.live') ||
        host.includes('agnostic-relay.net');
      if (unsupported) console.warn('[RELAYS] unsupported for eth_sendBundle (skipped):', u);
      return !unsupported;
    });
}

/** (선택) bloXroute 전송 — API Key 필요 */
async function sendBundleViaBloxroute({ rawTxs, targetBlockHex }) {
  const apiKey = process.env.BLXR_API_KEY;
  if (!apiKey) return { used: false };

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'blxr_submit_bundle',
    params: [{
      transaction: rawTxs,
      blockchain: 'ETH',
      // block_number는 정책에 맞게: 고정 타깃 or 미지정(릴레이 라우팅)
      block_number: targetBlockHex
    }]
  };

  let res, text;
  try {
    res = await doFetch('https://api.blxrbdn.com', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify(body)
    });
    text = await res.text();
  } catch (e) {
    console.log('[BLXR_ERR]', e?.message || String(e));
    return { used: true, ok: false, status: 0, err: e?.message || String(e) };
  }

  console.log('[BLXR]', res.status, (text || '').slice(0, 600));
  return { used: true, ok: res.ok, status: res.status };
}

/** (옵션) 외부 릴레이로 eth_sendBundle (현재 실사용 없음 — 대부분 거부) */
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

  const settled = await Promise.allSettled(relays.map(async (url) => {
    try {
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
      return { url, ok: res.ok, httpStatus: res.status, body: text.slice(0, 300) };
    } catch (e) {
      return { url, ok: false, httpStatus: 0, err: e?.message || String(e) };
    }
  }));

  const flat = settled.map(item =>
    item.status === 'fulfilled' ? item.value
                                : { url: '(unknown)', ok: false, httpStatus: 0, err: item.reason?.message || String(item.reason) }
  );
  console.log('[MULTI-RELAY]', flat);
  return flat;
}

/** 환경 진단 */
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
  const latestNonce  = await provider.getTransactionCount(from, 'latest');
  const pendingNonce = await provider.getTransactionCount(from, 'pending');
  logs.push({ kind: 'nonce', latestNonce, pendingNonce, compNonceChosen });
  if (pendingNonce > latestNonce) {
    logs.push({ kind: 'warn', msg: 'pending nonce > latest nonce → 공개 mempool 대기 tx 존재(경쟁 가능성)' });
  }

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

  try {
    await token.callStatic.transfer(to, amountUnits, { from });
    logs.push({ kind: 'callStatic', ok: true });
  } catch (e) {
    logs.push({ kind: 'callStatic', ok: false, reason: decodeRevert(e) });
  }

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

  logs.push({ kind: 'gasHint', gasLimit: gasLimit.toString(), extraFundEth });
  console.log('[DIAG]', JSON.stringify(logs, null, 2));
  return logs;
}

/** ---------- 메인 함수 ---------- */
async function rescueBundle({
  provider,
  wsProvider,          // optional: WebSocketProvider (mempool 진단용)
  relayUrl = process.env.RELAY_URL || 'https://relay.flashbots.net',
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
}) {
  if (!provider || !relayUrl || !authWallet || !sponsorWallet || !compromisedWallet) {
    throw new Error('provider/relayUrl/authWallet/sponsorWallet/compromisedWallet are required');
  }

  const extraRelays = normalizeRelayUrls(process.env.EXTRA_RELAYS);
  console.log('[RELAYS]', { flashbots: relayUrl, extraRelays });

  const { chainId, name } = await provider.getNetwork();
  console.log('[NET] chainId=%d name=%s relay=%s', chainId, name, relayUrl);
  if (relayUrl.includes('flashbots.net') && chainId !== 1) {
    throw new Error(`Flashbots mainnet relay only. chainId=${chainId}`);
  }

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  // 금액 단위
  let finalAmountUnits = amountUnits ? bn(amountUnits) : null;
  if (!finalAmountUnits && typeof amountHuman !== 'undefined') {
    const decimals = await token.decimals();
    finalAmountUnits = ethers.utils.parseUnits(String(amountHuman), decimals);
  }
  if (!finalAmountUnits) throw new Error('amountUnits or amountHuman is required');

  const data = token.interface.encodeFunctionData('transfer', [toAddress, finalAmountUnits]);

  // 가스 한도 (1.3x 버퍼 권장)
  let gasLimit;
  try {
    const est = await provider.estimateGas({ from: compromisedWallet.address, to: tokenAddress, data });
    gasLimit = bn(est).mul(130).div(100);
    console.log('[GASLIMIT_TEST]', est.toString(), '->', gasLimit.toString());
  } catch {
    gasLimit = bn(gasLimitHint);
  }

  const compNonce = await provider.getTransactionCount(compromisedWallet.address, 'pending');
  const sponsorNonce = await provider.getTransactionCount(sponsorWallet.address, 'pending');
  console.log('[NONCE] compNonce=%d sponsorNonce=%d', compNonce, sponsorNonce);

  const latestNonce  = await provider.getTransactionCount(compromisedWallet.address, 'latest');
  const pendingNonce = await provider.getTransactionCount(compromisedWallet.address, 'pending');
  console.log('[NONCE_CHECK] latest=%d pending=%d delta=%d ourNonce=%d',
    latestNonce, pendingNonce, (pendingNonce - latestNonce), compNonce);

  await diagnoseEnvironment({
    provider,
    wsProvider,
    token,
    from: compromisedWallet.address,
    to: toAddress,
    amountUnits: finalAmountUnits,
    compNonceChosen: compNonce,
    gasLimit,
    extraFundEth,
  });

  const fb = await FlashbotsBundleProvider.create(provider, authWallet, relayUrl);

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

  const sponsorBal = await provider.getBalance(sponsorWallet.address);
  const compBal = await provider.getBalance(compromisedWallet.address);
  console.log('[PRECHECK] sponsor=%s bal=%s, compromised=%s bal=%s',
    sponsorWallet.address, ethers.utils.formatEther(sponsorBal),
    compromisedWallet.address, ethers.utils.formatEther(compBal)
  );

  const { base } = await buildFees(provider, tipGwei);
  console.log('[FEE_HINT] base≈%s gwei', ethers.utils.formatUnits(base, 'gwei'));

  const extraFundWei = ethers.utils.parseEther(String(extraFundEth));
  const maxTipGweiCap = computeMaxTipGweiCap({ sponsorBalWei: sponsorBal, baseWei: base, gasLimit, extraFundWei });
  const tipCapNum = Number(maxTipGweiCap.toString());
  if (tipCapNum <= 0) {
    return { status: 'insufficient_sponsor_balance_for_any_tip', detail: { sponsorBal: ethers.utils.formatEther(sponsorBal), tipCapGwei: tipCapNum } };
  }

  const tipCandidates = Array.from(new Set([
    Math.max(1, Math.floor(tipCapNum * 0.90)),
    tipCapNum
  ])).map(String);
  console.log('[TIP_CANDIDATES]', tipCandidates);

  const attempts = [];
  let lastError = null;

  for (let i = 1; i <= blocksToTry; i++) {
    const currentBlock = await provider.getBlockNumber();
    const targets = [currentBlock + 2, currentBlock + 3, currentBlock + 4]; // 3개 블록 리드

    for (const targetBlock of targets) {
      const entry = { targetBlock, tries: [] };

      for (const tipStr of tipCandidates) {
        // 수수료 계산: base*1.3 + tip
        const latestBlock = await provider.getBlock('latest');
        const baseCurr = bn(
          latestBlock?.baseFeePerGas ??
          (await provider.getFeeData())?.lastBaseFeePerGas ??
          ethers.utils.parseUnits('20', 'gwei')
        );
        const candidateTip = ethers.utils.parseUnits(tipStr, 'gwei');
        const candidateMaxFee = baseCurr.mul(13).div(10).add(candidateTip);

        const needWeiCandidate = candidateMaxFee.mul(gasLimit).add(extraFundWei);
        const sponsorBalNow = await provider.getBalance(sponsorWallet.address);
        const fundTxCostCeilCandidate = bn(21000).mul(candidateMaxFee);
        const minSponsorNeedCandidate = needWeiCandidate.add(fundTxCostCeilCandidate);
        if (sponsorBalNow.lt(minSponsorNeedCandidate)) {
          entry.tries.push({ tip: tipStr, stage: 'balance', ok: false, sponsorBal: ethers.utils.formatEther(sponsorBalNow) });
          continue;
        }

        const tokenTxAttempt = makeTokenTx(candidateMaxFee, candidateTip);
        const fundTxAttempt  = makeFundTx(candidateMaxFee, candidateTip, needWeiCandidate);

        console.log('[RAMP]', {
          target: targetBlock,
          tip_gwei: tipStr,
          base_gwei: ethers.utils.formatUnits(baseCurr, 'gwei'),
          maxFee_gwei: ethers.utils.formatUnits(candidateMaxFee, 'gwei'),
          needWei: ethers.utils.formatEther(needWeiCandidate)
        });

        // 번들 서명
        let signedAttempt;
        try {
          signedAttempt = await fb.signBundle([
            { signer: sponsorWallet, transaction: fundTxAttempt },
            { signer: compromisedWallet, transaction: tokenTxAttempt },
          ]);
          entry.tries.push({ tip: tipStr, stage: 'sign', ok: true });
        } catch (e) {
          entry.tries.push({ tip: tipStr, stage: 'sign', ok: false, msg: e?.message || String(e) });
          lastError = e;
          continue;
        }

        // simulate
        try {
          const sim = await fb.simulate(signedAttempt, targetBlock);
          console.log('[SIM]', JSON.stringify(sim, null, 2).slice(0, 1200));
          if ((Array.isArray(sim) && sim[0]?.error) || sim?.error) {
            const msg = (Array.isArray(sim) ? sim[0]?.error : sim?.error?.message) || 'simulate error';
            entry.tries.push({ tip: tipStr, stage: 'simulate', ok: false, msg });
            lastError = new Error(msg);
            continue;
          } else {
            entry.tries.push({ tip: tipStr, stage: 'simulate', ok: true });
          }
          const coinbaseDiff = sim?.coinbaseDiff ?? sim?.results?.[0]?.coinbaseDiff;
          if (coinbaseDiff) console.log('[SIM_PROFIT] coinbaseDiff', coinbaseDiff.toString());
        } catch (e) {
          entry.tries.push({ tip: tipStr, stage: 'simulate', ok: false, msg: e?.message || String(e) });
          lastError = e;
          continue;
        }

        // raw 번들
        const rawTxs = await buildRawBundleTxs(sponsorWallet, fundTxAttempt, compromisedWallet, tokenTxAttempt);
        const targetHex = '0x' + targetBlock.toString(16);

        // (선택) bloXroute 경로 병행
        const blxr = await sendBundleViaBloxroute({ rawTxs, targetBlockHex: targetHex });
        if (blxr.used) console.log('[BLXR_SUMMARY]', { ok: blxr.ok, status: blxr.status });

        // (참고용) 기타 릴레이 eth_sendBundle — 대부분 거부되므로 off해도 무방
        if (extraRelays.length) {
          const resMulti = await broadcastBundleToRelays({
            relays: extraRelays,
            authWallet,
            rawTxs,
            targetBlockHex: targetHex
          }).catch(() => []);
          console.log('[MULTI-RELAY-SUMMARY]', resMulti.map(r => ({ url: r.url, ok: r.ok, httpStatus: r.httpStatus })));
        }

        // Flashbots 전송 + 대기
        let respAttempt = null;
        for (let t = 1; t <= sendRetries; t++) {
          try {
            respAttempt = await fb.sendRawBundle(signedAttempt, targetBlock);
            entry.tries.push({ tip: tipStr, stage: 'send', ok: true, try: t });
            break;
          } catch (e) {
            entry.tries.push({
              tip: tipStr, stage: 'send', ok: false, try: t,
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
          console.log('[FB_WAIT]', { targetBlock, code });
          entry.tries.push({ tip: tipStr, stage: 'wait', ok: code === 0, code });
          if (code === 0) {
            const rawFund = await sponsorWallet.signTransaction(fundTxAttempt);
            const rawTok  = await compromisedWallet.signTransaction(tokenTxAttempt);
            return {
              status: 'included',
              includedBlock: targetBlock,
              fundTxHash: ethers.utils.keccak256(rawFund),
              tokenTxHash: ethers.utils.keccak256(rawTok),
              tipUsedGwei: tipStr,
              attempts: attempts.concat(entry),
            };
          }
        } catch (e) {
          entry.tries.push({ tip: tipStr, stage: 'wait', ok: false, msg: e?.message || String(e) });
          lastError = e;
        }
      } // tip loop

      attempts.push(entry);
    } // targets loop

    console.log('[FINAL_BLOCK_ROUND] done round=%d', i);
  } // blocksToTry loop

  return {
    status: 'not_included',
    triedBlocks: blocksToTry,
    lastError: lastError?.message || String(lastError || ''),
    attempts,
  };
}

module.exports = { rescueBundle };
