// services/rescueBundle.js
require("dotenv").config();
const { ethers } = require("ethers");
const {
  FlashbotsBundleProvider,
} = require("@flashbots/ethers-provider-bundle");

const ERC20_ABI = [
  "function transfer(address to,uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

const bn = (x) => ethers.BigNumber.from(String(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Trust Wallet 수준으로 보수 완화:
 * maxFeePerGas ≈ baseFee * 1.2 + priorityFee
 * - provider.getFeeData() 값 신뢰 (없으면 보수적으로 계산)
 */
async function buildFees(provider, fallbackTipGwei = "5") {
  const feeData = await provider.getFeeData(); // { maxFeePerGas, maxPriorityFeePerGas, lastBaseFeePerGas }
  const latest = await provider.getBlock("latest");

  const base = bn(
    latest?.baseFeePerGas ??
      feeData?.lastBaseFeePerGas ??
      ethers.utils.parseUnits("20", "gwei")
  );

  const tip = feeData?.maxPriorityFeePerGas?.gt(0)
    ? bn(feeData.maxPriorityFeePerGas)
    : ethers.utils.parseUnits(fallbackTipGwei, "gwei");

  // base * 1.2 + tip  (상한 유도)
  const maxFee = base.mul(12).div(10).add(tip);

  // 하한/상한 클램프 (급격한 변동 방지)
  const minTip = ethers.utils.parseUnits("1", "gwei");
  const maxTip = ethers.utils.parseUnits("15", "gwei");
  const clampedTip = tip.lt(minTip) ? minTip : tip.gt(maxTip) ? maxTip : tip;

  // maxFee는 tip보다 항상 커야 함
  const clampedMaxFee = maxFee.gt(clampedTip.add(base))
    ? maxFee
    : base.add(clampedTip);

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
  authWallet, // 헤더서명 전용 (자금 불필요)
  sponsorWallet, // 실제 ETH 보유 (가스 대납)
  compromisedWallet, // 토큰 보유/서명 가능한 위험 주소
  tokenAddress,
  toAddress,
  amountUnits, // (선호) parseUnits 결과(정수)
  amountHuman, // (옵션) "1.23" 같은 문자열 → decimals로 변환
  gasLimitHint = "130000",
  tipGwei = "5",
  // 너무 작은 여유는 재시도 중 baseFee 미세 상승 시 부족 오류 유발 → 소액 여유 유지
  extraFundEth = "0.00005",
  blocksToTry = 30,
  simulateRetries = 3,
  sendRetries = 3,
  reSignEachAttempt = true, // 네트워크 변동 대응 위해 기본 true
}) {
  if (
    !provider ||
    !relayUrl ||
    !authWallet ||
    !sponsorWallet ||
    !compromisedWallet
  ) {
    throw new Error(
      "provider/relayUrl/authWallet/sponsorWallet/compromisedWallet are required"
    );
  }

  const chainId = (await provider.getNetwork()).chainId;
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  // --- 전송 금액 단위 정리 ---
  let finalAmountUnits = amountUnits ? bn(amountUnits) : null;
  if (!finalAmountUnits && typeof amountHuman !== "undefined") {
    const decimals = await token.decimals();
    finalAmountUnits = ethers.utils.parseUnits(String(amountHuman), decimals);
  }
  if (!finalAmountUnits)
    throw new Error("amountUnits or amountHuman is required");

  // --- transfer() 데이터 ---
  const data = token.interface.encodeFunctionData("transfer", [
    toAddress,
    finalAmountUnits,
  ]);

  // --- 가스 한도 추정 (되도록 실제 estimateGas 사용) ---
  let gasLimit;
  try {
    const est = await provider.estimateGas({
      from: compromisedWallet.address,
      to: tokenAddress,
      data,
    });
    // 약간의 여유(5~10%)를 둬서 재시도 중 revert 방지
    gasLimit = bn(est).mul(11).div(10);
  } catch {
    gasLimit = bn(gasLimitHint);
  }

  // --- 논스 확보 (pending 기준) ---
  const compNonce = await provider.getTransactionCount(
    compromisedWallet.address,
    "pending"
  );
  const sponsorNonce = await provider.getTransactionCount(
    sponsorWallet.address,
    "pending"
  );

  // --- 수수료 (Trust Wallet 유사 계산) ---
  let { tip, maxFee } = await buildFees(provider, tipGwei);

  // --- 필요한 ETH(상한×가스한도 + 소액여유) 산출 ---
  // 상한은 실제 소비보다 클 수 있으나, EIP-1559 환불특성 + 번들 원자성 고려해 안전하게
  const needWeiCeil = bn(maxFee).mul(gasLimit);
  const needWei = needWeiCeil.add(
    ethers.utils.parseEther(String(extraFundEth))
  );

  // --- Flashbots provider ---
  const fb = await FlashbotsBundleProvider.create(
    provider,
    authWallet,
    relayUrl
  );

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
        { signer: compromisedWallet, transaction: tokenTx },
      ]);
    } catch (e) {
      lastError = e;
      return {
        status: "sign_failed",
        triedBlocks: i - 1,
        lastError: e?.message || String(e),
        attempts,
      };
    }

    // (루프 직전, 딱 한 번) 스폰서 잔액 체크 추가
    const sponsorBal = await provider.getBalance(sponsorWallet.address);
    const compBal = await provider.getBalance(compromisedWallet.address);
    const sponsorNoncePending = await provider.getTransactionCount(
      sponsorWallet.address,
      "pending"
    );
    const compNoncePending = await provider.getTransactionCount(
      compromisedWallet.address,
      "pending"
    );

    console.log(
      "[PRECHECK] sponsor=%s bal=%s nonce_pending=%d, compromised=%s bal=%s nonce_pending=%d",
      sponsorWallet.address,
      ethers.utils.formatEther(sponsorBal),
      sponsorNoncePending,
      compromisedWallet.address,
      ethers.utils.formatEther(compBal),
      compNoncePending
    );

    // compute minimal sponsor need (fund value + sponsor tx gas ceiling)
    const fundTxCostCeil = bn(21000).mul(maxFee);
    const minSponsorNeed = needWei.add(fundTxCostCeil);
    if (sponsorBal.lt(minSponsorNeed)) {
      console.log("[ERROR] sponsor balance insufficient", {
        sponsorBal: ethers.utils.formatEther(sponsorBal),
        minSponsorNeed: ethers.utils.formatEther(minSponsorNeed),
      });
      return {
        status: "insufficient_sponsor_balance",
        sponsorBal: sponsorBal.toString(),
        minSponsorNeed: minSponsorNeed.toString(),
      };
    }

    // --- simulate (재시도) ---
    // ----- dynamic tip ramp -----
    const tipCandidatesGwei = ["3", "5", "8"]; // 필요시 ['5','8','12']로 상향
    let includedResult = null;

    for (
      let tipIdx = 0;
      tipIdx < tipCandidatesGwei.length && !includedResult;
      tipIdx++
    ) {
      // 1) 수수료 재계산
      const candidateTip = ethers.utils.parseUnits(
        tipCandidatesGwei[tipIdx],
        "gwei"
      );
      const latestBlock = await provider.getBlock("latest");
      const baseCurr = bn(
        latestBlock?.baseFeePerGas ??
          (await provider.getFeeData())?.lastBaseFeePerGas ??
          ethers.utils.parseUnits("20", "gwei")
      );
      const candidateMaxFee = baseCurr.mul(13).div(10).add(candidateTip);

      // 2) needWei도 함께 재계산 (상한 × gasLimit + extraFundEth)
      const needWeiCandidate = candidateMaxFee
        .mul(gasLimit)
        .add(ethers.utils.parseEther(String(extraFundEth)));

      // 3) 스폰서 잔액/가스 상한 재검증
      const sponsorBalNow = await provider.getBalance(sponsorWallet.address);
      const fundTxCostCeilCandidate = bn(21000).mul(candidateMaxFee);
      const minSponsorNeedCandidate = needWeiCandidate.add(
        fundTxCostCeilCandidate
      );
      if (sponsorBalNow.lt(minSponsorNeedCandidate)) {
        console.log(
          "[RAMP] skip tip=%s gwei — sponsor balance low: bal=%s need=%s",
          tipCandidatesGwei[tipIdx],
          ethers.utils.formatEther(sponsorBalNow),
          ethers.utils.formatEther(minSponsorNeedCandidate)
        );
        continue; // 다음 tip 후보로
      }

      console.log(
        "[RAMP] try tip=%s gwei base=%s gwei maxFee=%s gwei needWei=%s ETH",
        tipCandidatesGwei[tipIdx],
        ethers.utils.formatUnits(baseCurr, "gwei"),
        ethers.utils.formatUnits(candidateMaxFee, "gwei"),
        ethers.utils.formatEther(needWeiCandidate)
      );

      // 4) 이번 시도에 실제로 사용할 트랜잭션 객체
      const tokenTxAttempt = {
        ...makeTokenTx(candidateMaxFee, candidateTip),
      };
      const fundTxAttempt = {
        ...makeFundTx(candidateMaxFee, candidateTip, needWeiCandidate),
      };

      // (선택) simulate로 빠른 실패 감지
      let signedAttempt = null;
      try {
        signedAttempt = await fb.signBundle([
          { signer: sponsorWallet, transaction: fundTxAttempt },
          { signer: compromisedWallet, transaction: tokenTxAttempt },
        ]);
      } catch (e) {
        console.log(
          "[SIGN_FAIL] tip=%s err=%s",
          tipCandidatesGwei[tipIdx],
          e?.message || e
        );
        continue;
      }

      try {
        const sim = await fb.simulate(signedAttempt, startBlock + 2); // 임의 블록으로 시뮬(가까운 미래)
        if ((Array.isArray(sim) && sim[0]?.error) || sim?.error) {
          console.log(
            "[SIM_FAIL] tip=%s msg=%s",
            tipCandidatesGwei[tipIdx],
            (Array.isArray(sim) ? sim[0]?.error : sim?.error?.message) ||
              "simulate error"
          );
          continue;
        }
      } catch (e) {
        console.log(
          "[SIM_ERR] tip=%s err=%s",
          tipCandidatesGwei[tipIdx],
          e?.message || e
        );
        // 시뮬 오류는 전송 자체를 막을 이유가 아니면, 계속 진행해도 됨
      }

      // 5) 전송 + 대기
      let respAttempt = null;
      for (let t = 1; t <= sendRetries; t++) {
        try {
          respAttempt = await fb.sendRawBundle(signedAttempt, targetBlock);
          console.log("[SEND_OK] tip=%s try=%d", tipCandidatesGwei[tipIdx], t);
          break;
        } catch (e) {
          console.log(
            "[SEND_FAIL] tip=%s try=%d status=%s msg=%s",
            tipCandidatesGwei[tipIdx],
            t,
            e?.response?.status || "-",
            e?.response?.data || e?.message || String(e)
          );
          await sleep(500 * t);
        }
      }
      if (!respAttempt) {
        console.log("[NO_RESP] tip=%s → next tip", tipCandidatesGwei[tipIdx]);
        continue;
      }

      try {
        const code = await respAttempt.wait(); // 0: included, 1: not included
        console.log("[WAIT] tip=%s code=%d", tipCandidatesGwei[tipIdx], code);
        if (code === 0) {
          // 6) 해시는 "이번 시도에 사용한 트랜잭션"으로 계산해야 정확
          const rawFund = await sponsorWallet.signTransaction(fundTxAttempt);
          const rawTok = await compromisedWallet.signTransaction(
            tokenTxAttempt
          );
          return {
            status: "included",
            includedBlock: targetBlock,
            fundTxHash: ethers.utils.keccak256(rawFund),
            tokenTxHash: ethers.utils.keccak256(rawTok),
            tipUsedGwei: tipCandidatesGwei[tipIdx],
          };
        }
        // not included → 다음 tip
      } catch (e) {
        console.log(
          "[WAIT_ERR] tip=%s err=%s",
          tipCandidatesGwei[tipIdx],
          e?.message || e
        );
        // 다음 tip 후보
      }
    } // end ramp

    if (includedResult) {
      // compute hashes and return (do NOT log raw txs)
      const rawFund = await sponsorWallet.signTransaction(fundTx);
      const rawTok = await compromisedWallet.signTransaction(tokenTx);
      return {
        status: "included",
        includedBlock: includedResult.includedBlock,
        fundTxHash: ethers.utils.keccak256(rawFund),
        tokenTxHash: ethers.utils.keccak256(rawTok),
        tipUsedGwei: includedResult.tip,
      };
    }

    // if we reach here -> not included by any tip candidate
    console.log("[FINAL] bundle not included by tip ramp");
    attempts.push(entry);
  }

  return {
    status: "not_included",
    triedBlocks: blocksToTry,
    lastError: lastError?.message || String(lastError || ""),
    attempts,
  };
}

module.exports = { rescueBundle };
