// services/rescueBundle.js (improved)
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

async function buildFees(provider, tipGwei = '5') {
  // tip 기본값(가변) 및 provider 권장값 보조 사용
  const latest = await provider.getBlock('latest');
  // latest.baseFeePerGas may be undefined on pre-London chains
  const baseFromBlock = latest?.baseFeePerGas;
  const feeData = await provider.getFeeData(); // may include maxPriorityFeePerGas, lastBaseFee
  const base = baseFromBlock || feeData?.lastBaseFeePerGas || ethers.utils.parseUnits('20', 'gwei');
  const tip = feeData?.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas.gt(0)
    ? feeData.maxPriorityFeePerGas
    : ethers.utils.parseUnits(tipGwei, 'gwei'); // ensure BigNumber
  // conservative maxFee: base * factor + tip
  const maxFee = base.mul(2).add(tip);
  return { base: bn(base), tip: bn(tip), maxFee: bn(maxFee) };
}

/**
 * rescueBundle - improved and safer
 */
async function rescueBundle(opts) {
  const {
    provider,
    relayUrl,
    authWallet,
    sponsorWallet,
    compromisedWallet,
    tokenAddress,
    toAddress,
    amountUnits,       // optional if amount and decimals provided
    amount,            // optional human amount, e.g. '1.5'
    gasLimitHint = '130000',
    tipGwei = '5',
    extraFundEth = '0.0006',
    blocksToTry = 30,
    simulateRetries = 3,
    sendRetries = 3,
    reSignEachAttempt = false // if true, re-sign txs each block (safer when fees change)
  } = opts;

  if (!provider || !authWallet || !sponsorWallet || !compromisedWallet) {
    throw new Error('provider/authWallet/sponsorWallet/compromisedWallet are required');
  }

  // token contract helper
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  // if user passed human amount + token decimals, derive amountUnits
  let finalAmountUnits = amountUnits ? bn(amountUnits) : null;
  if (!finalAmountUnits && typeof amount !== 'undefined') {
    const decimals = await token.decimals();
    finalAmountUnits = ethers.utils.parseUnits(String(amount), decimals);
  }
  if (!finalAmountUnits) throw new Error('amountUnits or (amount + token decimals) required');

  // estimate gas limit (ensure BigNumber)
  let gasLimit;
  try {
    const data = token.interface.encodeFunctionData('transfer', [toAddress, finalAmountUnits]);
    const est = await provider.estimateGas({
      from: compromisedWallet.address,
      to: tokenAddress,
      data
    });
    gasLimit = bn(est);
  } catch (e) {
    gasLimit = bn(gasLimitHint);
  }

  // pending nonces
  const compNonce = await provider.getTransactionCount(compromisedWallet.address, 'pending');
  const sponsorNonce = await provider.getTransactionCount(sponsorWallet.address, 'pending');

  // fee setup
  const { base, tip, maxFee } = await buildFees(provider, tipGwei);

  // prepare tx constructors (we'll sign later; may re-sign each attempt)
  const makeTokenTx = (currentMaxFee, currentTip) => ({
    to: tokenAddress,
    data: token.interface.encodeFunctionData('transfer', [toAddress, finalAmountUnits]),
    type: 2,
    maxFeePerGas: currentMaxFee,
    maxPriorityFeePerGas: currentTip,
    gasLimit,
    nonce: compNonce,
    chainId: (await provider.getNetwork()).chainId,
    value: 0
  });

  const makeFundTx = (currentMaxFee, currentTip, needWei) => ({
    to: compromisedWallet.address,
    value: needWei,
    type: 2,
    gasLimit: bn(21000),
    maxFeePerGas: currentMaxFee,
    maxPriorityFeePerGas: currentTip,
    nonce: sponsorNonce,
    chainId: (await provider.getNetwork()).chainId
  });

  // compute needWei (BigNumber)
  const needWei = bn(maxFee).mul(gasLimit).add(ethers.utils.parseEther(String(extraFundEth)));

  // validate compromised wallet can sign
  if (!compromisedWallet._signingKey && !compromisedWallet.signTransaction) {
    throw new Error('compromisedWallet must be a signer (have private key) for signing token tx');
  }

  // create flashbots provider
  const fb = await FlashbotsBundleProvider.create(provider, authWallet, relayUrl);

  const startBlock = await provider.getBlockNumber();

  // bookkeeping
  let lastError = null;
  const attempts = [];

  for (let i = 1; i <= blocksToTry; i++) {
    const targetBlock = startBlock + i + 1;
    const entry = { targetBlock, simulateTries: [], sendTries: [] };

    // optionally recalc fees per-attempt (in case network moved)
    const perAttemptFees = await buildFees(provider, tipGwei);
    const curMaxFee = perAttemptFees.maxFee;
    const curTip = perAttemptFees.tip;

    // (re)build tx objects for this attempt using current fees
    const tokenTx = makeTokenTx(curMaxFee, curTip);
    const fundTx = makeFundTx(curMaxFee, curTip, needWei);

    // sign bundle (re-sign each attempt if requested)
    let signedBundle = null;
    try {
      if (reSignEachAttempt) {
        signedBundle = await fb.signBundle([
          { signer: sponsorWallet, transaction: fundTx },
          { signer: compromisedWallet, transaction: tokenTx }
        ]);
      } else {
        // sign once on first iteration
        if (!signedBundle) {
          signedBundle = await fb.signBundle([
            { signer: sponsorWallet, transaction: fundTx },
            { signer: compromisedWallet, transaction: tokenTx }
          ]);
        }
      }
    } catch (e) {
      // signing failure - unrecoverable
      lastError = e;
      return {
        status: 'sign_failed',
        triedBlocks: i,
        lastError: e?.message || String(e),
        attempts
      };
    }

    // --- simulate (with retries) ---
    let simOk = false;
    for (let s = 1; s <= simulateRetries; s++) {
      try {
        const sim = await fb.simulate(signedBundle, targetBlock);
        // fb.simulate returns object; check for error string or results
        if (sim && sim.length && sim[0] && sim[0].error) {
          // sometimes simulate returns array with .error
          const msg = sim[0].error;
          entry.simulateTries.push({ ok: false, msg });
          lastError = new Error(`simulate: ${msg}`);
          // if simulate returns revert-like error, abort entire flow
          throw lastError;
        } else if (sim && sim.error) {
          entry.simulateTries.push({ ok: false, msg: sim.error.message || JSON.stringify(sim) });
          lastError = new Error(`simulate: ${sim.error?.message || JSON.stringify(sim)}`);
          throw lastError;
        } else {
          entry.simulateTries.push({ ok: true, raw: sim });
          simOk = true;
          break;
        }
      } catch (e) {
        entry.simulateTries.push({ ok: false, msg: e?.message || String(e) });
        lastError = e;
        // backoff
        await sleep(300 * s);
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

    // --- sendRawBundle (with retries) ---
    let resp = null;
    for (let t = 1; t <= sendRetries; t++) {
      try {
        resp = await fb.sendRawBundle(signedBundle, targetBlock);
        entry.sendTries.push({ ok: true });
        break;
      } catch (e) {
        // include HTTP response if present
        entry.sendTries.push({
          ok: false,
          msg: e?.response?.data || e?.message || String(e),
          status: e?.response?.status
        });
        lastError = e;
        await sleep(800 * t);
      }
    }

    if (!resp) {
      attempts.push(entry);
      // try next block (fees might have changed)
      continue;
    }

    // wait for inclusion
    try {
      const code = await resp.wait(); // 0: included, 1: not included
      if (code === 0) {
        // included -> compute tx hashes from signed raw txs for return
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
