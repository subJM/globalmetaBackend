require('dotenv').config();
const { ethers } = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');

const ERC20_ABI = [
  "function transfer(address to,uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

function bn(x){ return ethers.BigNumber.from(String(x)); }

async function feeHint(provider, tipGwei="1.5"){
  const latest = await provider.getBlock('latest');
  const base = latest.baseFeePerGas || ethers.utils.parseUnits('20','gwei');
  const tip  = ethers.utils.parseUnits(tipGwei,'gwei'); // 0보다 커야 함
  return { maxPriorityFeePerGas: tip, maxFeePerGas: base.mul(2).add(tip) };
}

/** 번들: (1)스폰서→해킹주소 가스 / (2)해킹주소→새지갑 토큰전송 */
async function rescueBundle({
  provider, relayUrl, authWallet, sponsorWallet, compromisedWallet,
  tokenAddress, toAddress, amountUnits, gasLimitHint="100000", tipGwei="1.5",
  blocksToTry=30
}){
  const fees = await feeHint(provider, tipGwei);
  const chainId = (await provider.getNetwork()).chainId;

  // 토큰 전송 트랜잭션
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  let gasLimit;
  const data = token.interface.encodeFunctionData('transfer', [toAddress, amountUnits]);
  try {
    gasLimit = await provider.estimateGas({ from: compromisedWallet.address, to: tokenAddress, data });
  } catch { gasLimit = bn(gasLimitHint); }

  const compNonce = await provider.getTransactionCount(compromisedWallet.address, 'pending');
  const tokenTx = {
    to: tokenAddress, data, type: 2,
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    gasLimit, nonce: compNonce, chainId, value: 0
  };

  // 스폰서 → 해킹주소 (필요 가스 + 아주 소량 여유)
  const sponsorNonce = await provider.getTransactionCount(sponsorWallet.address, 'pending');
  const needWei = fees.maxFeePerGas.mul(gasLimit).add(ethers.utils.parseEther('0.0006'));
  const fundTx = {
    to: compromisedWallet.address, value: needWei, type: 2, gasLimit: bn(21000),
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    nonce: sponsorNonce, chainId
  };

  // 번들 전송
  const fb = await FlashbotsBundleProvider.create(provider, authWallet, relayUrl);
  const signed = await fb.signBundle([
    { signer: sponsorWallet,     transaction: fundTx },
    { signer: compromisedWallet, transaction: tokenTx }
  ]);

  const start = await provider.getBlockNumber();
  for (let i=1; i<=blocksToTry; i++){
    const target = start + i + 1;
    const sim = await fb.simulate(signed, target);
    if ("error" in sim) throw new Error(`simulate 실패: ${sim.error.message||JSON.stringify(sim)}`);
    const resp = await fb.sendRawBundle(signed, target);
    const res  = await resp.wait();
    if (res === 0){ // Included
      const rawFund  = await sponsorWallet.signTransaction(fundTx);
      const rawToken = await compromisedWallet.signTransaction(tokenTx);
      return {
        status: 'included', includedBlock: target,
        fundTxHash:  ethers.utils.keccak256(rawFund),
        tokenTxHash: ethers.utils.keccak256(rawToken)
      };
    }
  }
  return { status: 'not_included', triedBlocks: blocksToTry };
}

module.exports = { rescueBundle };
