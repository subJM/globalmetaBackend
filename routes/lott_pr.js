// routes/wallet.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
require('dotenv').config();
const { ethers } = require('ethers');
const { rescueBundle } = require('./rescueBundle');;

const RPC_URL = process.env.ALCHEMY_MAINNET_RPC_URL;
const RELAY_URL = process.env.FLASHBOTS_RELAY_URL || 'https://relay.flashbots.net';
const AUTH_PK = process.env.FLASHBOTS_AUTH_PRIVATE_KEY;
const SPONSOR_PK = process.env.SPONSOR_PRIVATE_KEY;

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

router.post('/transferToken_bundle', async (req, res) => {
  try{
    const { user_id, token_address, from_address, to_address } = req.body;
    const amountStr = String(req.body.amount ?? '0');

    if (!ethers.utils.isAddress(token_address) ||
        !ethers.utils.isAddress(from_address)  ||
        !ethers.utils.isAddress(to_address)    ||
        isNaN(Number(amountStr)) || Number(amountStr) <= 0){
      return res.status(400).send({ result:'error', message:'잘못된 파라미터' });
    }
    if (!RPC_URL || !RELAY_URL || !AUTH_PK || !SPONSOR_PK){
      return res.status(500).send({ result:'error', message:'.env (RPC/RELAY/AUTH_PK/SPONSOR_PK) 확인' });
    }

    // 개인키 로드(절대 로그 X)
    const compromisedPk = fs.readFileSync(`./user/${user_id}/ETH/privateKey`, 'utf8').trim();
    const authWallet      = new ethers.Wallet(AUTH_PK, provider);
    const sponsorWallet   = new ethers.Wallet(SPONSOR_PK, provider);
    const compromisedWallet = new ethers.Wallet(compromisedPk, provider);

    // 체크: 파일 키와 from_address 일치
    if (ethers.utils.getAddress(compromisedWallet.address) !== ethers.utils.getAddress(from_address)){
      return res.status(400).send({ result:'error', message:'from_address와 개인키 주소가 다릅니다.' });
    }

    // amount → wei (decimals 조회)
    const tokenDec = new ethers.Contract(token_address, ["function decimals() view returns (uint8)"], provider);
    let decimals = 18; try { decimals = await tokenDec.decimals(); } catch {}
    const amountUnits = ethers.utils.parseUnits(amountStr, decimals);

    // (선택) 스폰서 지갑 잔고 체크
    const sponsorBal = await provider.getBalance(sponsorWallet.address);
    if (sponsorBal.lt(ethers.utils.parseEther('0.003'))){
      return res.status(400).send({ result:'error', message:'스폰서 지갑 ETH 부족' });
    }

    const out = await rescueBundle({
      provider, relayUrl: RELAY_URL, authWallet, sponsorWallet, compromisedWallet,
      tokenAddress: token_address, toAddress: to_address, amountUnits,
      gasLimitHint: "100000", tipGwei: "1.5", blocksToTry: 8
    });

    return res.status(200).send({
      result: out.status === 'included' ? 'success' : 'pending',
      data: out
    });
  } catch (e){
    console.error('[transferToken_bundle] ', e?.stack || e?.message || e);
    return res.status(500).send({ result:'error', message: e?.message || 'bundle failed' });
  }
});

module.exports = router;
