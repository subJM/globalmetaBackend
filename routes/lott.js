var express = require('express');
var router = express.Router();
const fs = require('fs');
const path = require('path');

require('dotenv').config();
const {Web3} = require('web3');
const hre = require("hardhat");
// import Web3 from 'web3';
const {getAddressSendHistory, checkUser, insertDB, checkAddressAsync } = require('../mysql');

const { encryptPrivateKey, decryptPrivateKey} = require("../util/crypto.js");

const { ethers } = require('ethers');
require('dotenv').config();
// 예: .env 내 ETH_RPC_URL= https://eth-mainnet.g.alchemy.com/v2/XXXXX
const RPC_URL = process.env.ALCHEMY_MAINNET_RPC_URL || process.env.ALCHEMY_TESTNET_RPC_URL;

if (!RPC_URL) {
  throw new Error('RPC URL이 없습니다. .env에 ALCHEMY_MAINNET_RPC_URL 또는 ALCHEMY_TESTNET_RPC_URL을 설정하세요.');
}
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

// ERC-20 토큰 주소와 ABI 설정
const tokenABI = [{"constant":true,"inputs":[],"name":"name","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"value","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"from","type":"address"},{"name":"to","type":"address"},{"name":"value","type":"uint256"}],"name":"transferFrom","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"addedValue","type":"uint256"}],"name":"increaseAllowance","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"lockAddress","type":"address"},{"name":"lockType","type":"uint8"},{"name":"endtimeList","type":"uint256[]"},{"name":"remainList","type":"uint256[]"}],"name":"lock","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[],"name":"unpause","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"paused","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[],"name":"renounceOwnership","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[],"name":"pause","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"owner","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"subtractedValue","type":"uint256"}],"name":"decreaseAllowance","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"to","type":"address"},{"name":"value","type":"uint256"}],"name":"transfer","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"name":"allowance","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"lockData","outputs":[{"name":"lockType","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"inputs":[],"payable":false,"stateMutability":"nonpayable","type":"constructor"},{"payable":true,"stateMutability":"payable","type":"fallback"},{"anonymous":false,"inputs":[{"indexed":true,"name":"lockAddress","type":"address"},{"indexed":true,"name":"lockType","type":"uint8"},{"indexed":false,"name":"endtimeList","type":"uint256[]"},{"indexed":false,"name":"remainList","type":"uint256[]"}],"name":"Lock","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"spender","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"account","type":"address"}],"name":"Paused","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"account","type":"address"}],"name":"Unpaused","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"previousOwner","type":"address"},{"indexed":true,"name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"}];

router.get('/check',async(req, res, next) => {

    // const user_id = req.body.user_id;
    const user_id = req.query.user_id;
    const address = req.query.address;
    // let key = req.query.key;
    // console.log(key);
    // if(key == "" || key == null){
    //     key = path.join(__dirname, '..',`user`,`${user_id}`,`privateKey`);
    //   };
    // const senderPrivateKey = key;
    const key = path.join(__dirname, '..',`user`,`${user_id}`,`privateKey`);
    const senderPrivateKey =fs.readFileSync(keyPath, 'utf8');
    // const senderPrivateKey = decryptPrivateKey(key);

    var balance = getTokenBalance(senderPrivateKey, address);
    // console.log(balance);
});

// router.post('/create_account', async function (req, res, next) {
//   const user_id = req.body.user_id;
//   const email = req.body.email;
//   // try {
//     // 유저 아이디 체크
//     const result = await checkUser(user_id , email);
//     if (result.length > 0) {
//       console.log(JSON.stringify(result));
//       // 아이디가 이미 존재하면 응답 후 종료
//       return res.status(201).send('exist');
//     };

//   // 이더와 LOTT 지갑 생성
//   try {
//     await insertDB('users', req.body, async (error, results) => {
//       if (error) {
//         return res.status(500).send('서버 오류 발생');
//       } else {
//         const account = hre.ethers.Wallet.createRandom();

//         await makeKeyFile(user_id, account.address, 'address');
//         await makeKeyFile(user_id, account.privateKey, 'privateKey');

//         const user_account = {
//           user_srl: results.insertId,
//           wallet: 'ETH',
//           token_name: 'ETH',
//           address: account.address,
//         };

//         await insertDB('walletinfo', user_account, async (error, results) => {
//           if (error) {
//             console.log(error);
//             return res.status(500).send(error);
//           }
//         });
 
//         const user_lott_account = {
//           user_srl: results.insertId,
//           wallet: 'ETH',
//           token_name: 'LOTT',
//           address: account.address,
//         };

//         await insertDB('walletinfo', user_lott_account, async (error, results) => {
//           if (error) {
//             console.log(error);
//             return res.status(500).send(error);
//           } else {
//             return res.status(201).send('success');
//           }
//         });
//       }
//     });
//   } catch (error) {
//     console.error('Error:', error);
//     return res.status(500).send('Internal Server Error');
//   }
// });

router.post('/create_account', async function (req, res, next) {
  const user_id = req.body.user_id;
  const email = req.body.email;

  try {

    const result = await checkUser(user_id , email);
    if (result.length > 0) {
      // 아이디가 이미 존재하면 응답 후 종료
      return res.status(201).send('exist');
    };

    // users 테이블에 데이터 삽입
    const userResults = await insertDB('users', req.body);
    
    // ETH 계정 생성
    const account = hre.ethers.Wallet.createRandom();

    // 키 파일 생성
    await Promise.all([
      makeKeyFile(user_id, account.address, 'address'),
      makeKeyFile(user_id, account.privateKey, 'privateKey'),
    ]);

    // walletinfo 테이블에 데이터 삽입
    const walletData = [
      {
        user_srl: userResults.insertId,
        wallet: 'ETH',
        token_name: 'ETH',
        address: account.address,
      },
      {
        user_srl: userResults.insertId,
        wallet: 'ETH',
        token_name: 'LOTT',
        address: account.address,
      },
    ];

    for (const data of walletData) {
      await insertDB('walletinfo', data);
    }
    // 성공 응답
    // res.status(201).send('success');
    res.status(201).send({result:"success", privateKey: account.privateKey});
  } catch (error) {
    console.error('error:', error);
    res.status(500).send('서버 오류 발생');
  }
});


//이더 지갑주소 가져오기
router.post('/getEthAddress' , async function (req, res) {
  try {
    const user_id = req.body.user_id;
    // 비동기 방식으로 파일 읽기
    const address = fs.readFileSync(`./user/${user_id}/ETH/address`, 'utf8');
    console.log(address);
    // const address = decryptPrivateKey(key);
    res.status(201).send({ address: address });
  } catch (error) {
    console.error('Error reading address file:', error);
    // 파일을 읽는 중 에러가 발생하면 500 상태 코드를 클라이언트로 전송
    res.status(500).send({ result: 'error', message: 'Failed to read address file' });
    // 또는 next(error)로 에러 처리 미들웨어로 전달
  }
});

// 이더 잔고 가져오기
router.post('/getAddressBalance', async function (req, res, next) {
    try {
        const { address } = req.body;
        const web3 = new Web3(process.env.ALCHEMY_TESTNET_RPC_URL);

        // 주소 유효성 검사 (최신 Web3.js 방식)
        if (!web3.utils.isAddress(address)) {
          return res.status(400).send({ result: "error", message: "Invalid Ethereum address" });
        }
        // ETH 잔고 가져오기
        const balanceWei = await web3.eth.getBalance(address);
        const balanceEth = web3.utils.fromWei(balanceWei, 'ether'); // 잔고를 ETH 단위로 변환
        
        console.log(balanceEth);
        res.status(200).send({ result: "success", balance: balanceEth });
    } catch (error) {
        res.status(500).send({ result: "error", error: error.message });
    }
});


//이더계열 토큰
router.post('/getAddressTokenBalance', async (req, res, next) => {
    const user_id = req.body.user_id;
    const address = req.body.address;

    try {
      const keyPath = path.join(__dirname, '..', `user`, `${user_id}`, `ETH`,`privateKey`);
      const senderPrivateKey = fs.readFileSync(keyPath, 'utf8').trim();
        // const senderPrivateKey = decryptPrivateKey(key);

        // getTokenBalance 호출에 await 추가
        const balance = await getTokenBalance(senderPrivateKey, address);
        res.json({ balance: balance });
    } catch (error) {
        console.error('Error fetching balance:', error);
        res.status(500).json({ error: 'Failed to fetch token balance' });
    }
});

  // 이더/토큰 전송 전 예상 수수료(가스) 추정
  router.post('/evmfeetest', async function (req, res) {
    const user_id     = req.body.user_id;
    const from        = req.body.from_address;
    const to          = req.body.to_address;
    const amountStr   = String(req.body.amount ?? '0');  // 문자열로 처리
    const coin_name   = (req.body.token_name || req.body.coin_name || 'ETH').toUpperCase();
    const tokenAddr   = req.body.token_address;          // ERC-20일 때 필요

    expectEvmFee(user_id, from, to, amountStr, coin_name, tokenAddr)
      .then(result => {
        if (!result) return res.status(500).send({ result: 'error' });
        res.status(200).send({ result: 'success', estimated: result });
      })
      .catch(err => {
        console.error('EVM fee estimation error:', err);
        res.status(500).send({ result: 'error', message: err?.message || 'Unknown error' });
      });
  });


  /**
   * EVM 수수료(가스) 추정
   * - ETH 전송: coin_name === 'ETH'
   * - ERC-20 전송: coin_name !== 'ETH' 이고 token_address 필요
   */
  async function expectEvmFee(user_id, from, to, amountStr, coin_name, token_address) {
    try {
      // 개인키(있으면 지갑 서명자로 추정, 없어도 from만으로 estimateGas 가능하긴 함)
      let wallet = null;
      try {
        const pk = fs.readFileSync(`./user/${user_id}/ETH/privateKey`, 'utf8').trim();
        wallet = new ethers.Wallet(pk, provider);
        // from과 개인키 주소가 다르면 from을 우선 사용(estimateGas용)
      } catch (_) {
        // 개인키 파일이 없어도 추정은 가능하니 무시
      }

      if (!ethers.utils.isAddress(from))  throw new Error('Invalid from address');
      if (!ethers.utils.isAddress(to))    throw new Error('Invalid to address');

      // 네트워크 수수료 정보 (EIP-1559 지원 시 maxFeePerGas / maxPriorityFeePerGas 제공)
      const feeData = await provider.getFeeData();
      const supportsEip1559 = !!(feeData.maxFeePerGas && feeData.maxPriorityFeePerGas);

      // 잔고 확인 (가스 비용 충당 가능 여부 판단용)
      const balanceWei = await provider.getBalance(from);

      let gasLimit;
      let txForEstimate = {};
      let humanSymbol = 'ETH';
      let toSendAmountWei = ethers.constants.Zero; // ETH 전송 시 본전송 금액
      let tokenMeta = null;

      if (coin_name === 'ETH') {
        // ETH 전송
        humanSymbol = await getNativeSymbolSafe(provider).catch(() => 'ETH');

        toSendAmountWei = ethers.utils.parseEther(amountStr); // 0.5 -> 500000000000000000
        txForEstimate = {
          from,
          to,
          value: toSendAmountWei
        };

        try {
          gasLimit = await provider.estimateGas(txForEstimate);
        } catch (err) {
          // 추정 실패 시 보수적으로 21000 사용
          gasLimit = ethers.BigNumber.from(21000);
        }

      } else {
        // ERC-20 전송
        if (!token_address || !ethers.utils.isAddress(token_address)) {
          throw new Error('token_address (ERC-20) is required and must be a valid address');
        }

        // 최소 ABI
        const erc20Abi = [
          'function transfer(address to, uint256 value) returns (bool)',
          'function decimals() view returns (uint8)',
          'function symbol() view returns (string)'
        ];
        const contract = new ethers.Contract(token_address, erc20Abi, provider);

        // 토큰 메타 가져오기
        const [decimals, symbol] = await Promise.all([
          contract.decimals().catch(() => 18),
          contract.symbol().catch(() => coin_name) // symbol 조회 실패하면 coin_name 사용
        ]);
        tokenMeta = { decimals, symbol };

        const amountUnits = ethers.utils.parseUnits(amountStr, decimals);

        // data 인코딩
        const iface = new ethers.utils.Interface(erc20Abi);
        const data = iface.encodeFunctionData('transfer', [to, amountUnits]);

        txForEstimate = {
          from,
          to: token_address,
          data
        };

        try {
          gasLimit = await provider.estimateGas(txForEstimate);
        } catch (err) {
          // 일부 토큰은 추정 실패할 수 있음 -> 보수치 (대략 65k~120k)
          gasLimit = ethers.BigNumber.from(90000);
        }
      }

      // 가스비 계산 (Wei)
      // - EIP-1559: (maxFeePerGas 사용; 내부적으로 baseFee + priority 가 캡 안에서 동작)
      // - Legacy: gasPrice 사용
      const priceLegacy = feeData.gasPrice || ethers.utils.parseUnits('30', 'gwei');
      const priceMaxFee = feeData.maxFeePerGas  || priceLegacy;
      const priceMaxPrio = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei');

      const estFeeWei_Legacy  = gasLimit.mul(priceLegacy);
      const estFeeWei_EIP1559 = gasLimit.mul(priceMaxFee);

      // 결과 포맷
      const res = {
        network: await safeNetworkName(provider),
        eip1559: supportsEip1559,
        from,
        to,
        type: (coin_name === 'ETH') ? 'NATIVE' : 'ERC20',
        symbol: (coin_name === 'ETH') ? (await getNativeSymbolSafe(provider).catch(() => 'ETH')) : tokenMeta.symbol,

        gasLimit: gasLimit.toString(),
        gasLimit_estHint: (coin_name === 'ETH') ? '≈ 21000 (기본 ETH 전송)' : '≈ 65k~120k (일반 ERC-20)',

        // 가스 가격(Wei/Gwei)
        legacy: {
          gasPriceWei: priceLegacy.toString(),
          gasPriceGwei: toGwei(priceLegacy),
          estimatedFeeWei: estFeeWei_Legacy.toString(),
          estimatedFeeNative: ethers.utils.formatEther(estFeeWei_Legacy) // ETH 단위
        },
        eip1559: {
          maxFeePerGasWei: priceMaxFee.toString(),
          maxPriorityFeePerGasWei: priceMaxPrio.toString(),
          maxFeePerGasGwei: toGwei(priceMaxFee),
          maxPriorityFeePerGasGwei: toGwei(priceMaxPrio),
          estimatedFeeWei: estFeeWei_EIP1559.toString(),
          estimatedFeeNative: ethers.utils.formatEther(estFeeWei_EIP1559)
        },

        balanceWei: balanceWei.toString(),
        balanceNative: ethers.utils.formatEther(balanceWei)
      };

      // 부족분 계산
      // - ETH 전송: 총 필요량 = 전송금액 + 가스비
      // - ERC-20 전송: 총 필요량 = 가스비만 (ETH 수수료)
      const feeWei = supportsEip1559 ? estFeeWei_EIP1559 : estFeeWei_Legacy;

      if (coin_name === 'ETH') {
        const totalNeed = feeWei.add(toSendAmountWei);
        const deficit   = balanceWei.gte(totalNeed) ? ethers.constants.Zero : totalNeed.sub(balanceWei);
        res.required = {
          sendAmountWei: toSendAmountWei.toString(),
          sendAmountNative: ethers.utils.formatEther(toSendAmountWei),
          totalNeedWei: totalNeed.toString(),
          totalNeedNative: ethers.utils.formatEther(totalNeed),
          enough: deficit.eq(0),
          deficitWei: deficit.toString(),
          deficitNative: ethers.utils.formatEther(deficit)
        };
      } else {
        const deficit = balanceWei.gte(feeWei) ? ethers.constants.Zero : feeWei.sub(balanceWei);
        res.required = {
          sendToken: tokenMeta,
          feeOnlyWei: feeWei.toString(),
          feeOnlyNative: ethers.utils.formatEther(feeWei),
          enough: deficit.eq(0),
          deficitWei: deficit.toString(),
          deficitNative: ethers.utils.formatEther(deficit)
        };
      }

      return res;

    } catch (error) {
      console.error('Error estimating EVM fee:', error.message || error);
      return null;
    }
  }

  // 안전한 네트워크 이름
  async function safeNetworkName(provider) {
    const net = await provider.getNetwork();
    return `${net.name || 'unknown'}(${net.chainId})`;
  }

  // 네이티브 심볼 추정 (일반적으로 ETH)
  // * provider만으로 심볼을 표준적으로 얻는 방법은 없어 fallback
  async function getNativeSymbolSafe(_) {
    // 필요하면 체인ID로 분기: 1=ETH, 137=MATIC, 56=BNB 등
    return 'ETH';
  }

  // Wei -> gwei 문자열
  function toGwei(bn) {
    return ethers.utils.formatUnits(bn, 'gwei');
  }

//send 페이지 보낸기록 5개 가져오기
router.post('/getAddressSendHistory', async function (req, res) {
    try {
      getAddressSendHistory(req.body ,async (error, results) => {
        if(error){
          throw error;
        }
        res.status(200).send({ result: 'success', data: results});
      });
    } catch (error) {
      console.error("Error checking getAddressSendHistory transaction status:", error);
      return { status: "error", error: error.message };
    }
});

async function makeKeyFile(user_id, content, fileName) {
  // 디렉토리 존재 확인
  const dirPath = `./user/${user_id}/ETH`;
  if (!fs.existsSync(dirPath)) {
      try {
          fs.mkdirSync(dirPath, { recursive: true });
      } catch (err) {
          console.error('디렉토리 생성 중 오류 발생:', err);
          throw err; // 에러를 호출자에게 전달
      }
  }

  // 파일 생성
  try {
      fs.writeFileSync(`${dirPath}/${fileName}`, content);
      console.log('파일이 성공적으로 생성되었습니다.');
      return "SUCCESS";
  } catch (err) {
      console.error('파일 쓰기 중 오류 발생:', err);
      throw err; // 에러를 호출자에게 전달
  }
}


/**
   * ETH 전송
   * body: { user_id, user_srl, email, from_address, to_address, token_name: 'ETH', amount }
   * 멀티체인(Polygon/BNB 등)도 ETH_RPC_URL만 바꾸면 동일 로직으로 전송
   */
  router.post('/transfer', async function (req, res) {
    const user_srl       = req.body.user_srl;
    const user_id        = req.body.user_id;
    const senderAddress  = req.body.from_address;
    const receiverAddress= req.body.to_address;
    const token_name     = (req.body.token_name || 'ETH').toUpperCase();
    const amountStr      = String(req.body.amount ?? '0');
    const email          = req.body.email;

    if (!user_id || !user_srl || !senderAddress || !receiverAddress ||
        !amountStr || isNaN(Number(amountStr)) || Number(amountStr) <= 0) {
      return res.status(400).send({ result:'error', message:'Invalid input parameters' });
    }

    try {
      // 유저 차단 여부
      const result = await checkUser(user_id, email);
      if (result?.[0]?.block === 'YES') {
        return res.status(200).send({ result:'block', message:'잠겨있어 전송할수 없습니다.' });
      }

      // 개인키 로드 & signer 생성
      const privateKey = fs.readFileSync(`./user/${user_id}/ETH/privateKey`, 'utf8').trim();
      const wallet = new ethers.Wallet(privateKey, provider);

      // from 주소 일치 검증 (ethers는 signer 주소가 곧 from)
      if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
        return res.status(400).send({
          result:'error',
          message:`from 주소(${senderAddress})가 개인키 주소(${wallet.address})와 다릅니다.`
        });
      }

      // 주소/수량 검증
      if (!ethers.utils.isAddress(receiverAddress)) {
        return res.status(400).send({ result:'error', message:'Invalid receiver address' });
      }

      const valueWei = ethers.utils.parseEther(amountStr);

      // 가스 한도/가스비
      const gasLimit = await provider.estimateGas({ from: wallet.address, to: receiverAddress, value: valueWei })
        .catch(() => ethers.BigNumber.from(21000));
      const feeData = await provider.getFeeData();

      // 트랜잭션 전송
      const txResponse = await wallet.sendTransaction({
        to: receiverAddress,
        value: valueWei,
        gasLimit,
        ...(feeData.maxFeePerGas && feeData.maxPriorityFeePerGas
          ? { maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas }
          : { gasPrice: feeData.gasPrice || ethers.utils.parseUnits('30', 'gwei') }
        )
      });

      const receipt = await txResponse.wait(1); // 1 컨펌 대기
      const usedFeeWei = receipt.gasUsed.mul(receipt.effectiveGasPrice || txResponse.gasPrice || 0);
      const usedFeeEth = Number(ethers.utils.formatEther(usedFeeWei));

      // 이력 기록
      const historyData = {
        token_name: token_name,        // 'ETH'
        user_srl,
        user_id,
        type: 'withdraw',
        from_address: senderAddress,
        to_address: receiverAddress,
        amount: amountStr,
        usedFee: usedFeeEth,           // 실제 사용된 ETH 수수료
        IsExternalTrade: 'true',
        transactionHash: receipt.transactionHash,
      };

      insertDB(`${token_name}_history`, historyData, (error, dbres) => {
        if (error) {
          console.error('Database insert error:', error);
          return res.status(500).send({ result:'error', message:'Failed to save transaction history' });
        }
        return res.status(200).send({
          result:'success',
          transaction: {
            hash: receipt.transactionHash,
            gasUsed: receipt.gasUsed.toString(),
            effectiveGasPrice: (receipt.effectiveGasPrice||0).toString(),
            usedFeeEth: usedFeeEth,
          }
        });
      });
    } catch (error) {
      console.error('Transaction Error:', error?.response?.data || error?.message || error);
      res.status(500).send({ result:'error', message: error?.message || 'Failed to transfer ETH' });
    }
  });

  /**
   * ERC-20 전송
   * body: { user_id, user_srl, email, token_name, token_address, from_address, to_address, amount }
   */
  router.post('/transferToken', async function (req, res) {
    const user_id        = req.body.user_id;
    const user_srl       = req.body.user_srl;
    const email          = req.body.email;
    const token_name     = (req.body.token_name || 'TOKEN').toUpperCase();
    const token_address  = req.body.token_address;   // ★필수
    const senderAddress  = req.body.from_address;
    const receiverAddress= req.body.to_address;
    const amountStr      = String(req.body.amount ?? '0');

    if (!user_id || !user_srl || !token_name || !senderAddress || !receiverAddress ||
        !token_address || !ethers.utils.isAddress(token_address) ||
        !amountStr || isNaN(Number(amountStr)) || Number(amountStr) <= 0) {
      return res.status(400).send({ result:'error', message:'Invalid input parameters' });
    }

    try {
      // 유저 차단 여부
      const result = await checkUser(user_id, email);
      if (result?.[0]?.block === 'YES') {
        return res.status(200).send({ result:'block', message:'잠겨있어 전송할수 없습니다.' });
      }

      const IsExternalTrade = await checkInternal(token_name , receiverAddress);

      if (IsExternalTrade === "Y") {
        return res.status(200).send({ result: 'error', message: '외부로 전송은 불가합니다' });
      }

      // 개인키/지갑
      const privateKey = fs.readFileSync(`./user/${user_id}/ETH/privateKey`, 'utf8').trim();
      const wallet = new ethers.Wallet(privateKey, provider);

      if (wallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
        return res.status(400).send({
          result:'error',
          message:`from 주소(${senderAddress})가 개인키 주소(${wallet.address})와 다릅니다.`
        });
      }

      if (!ethers.utils.isAddress(receiverAddress)) {
        return res.status(400).send({ result:'error', message:'Invalid receiver address' });
      }

      // ERC-20 최소 ABI
      const erc20Abi = [
        'function transfer(address to, uint256 value) returns (bool)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function balanceOf(address owner) view returns (uint256)'
      ];
      const contract = new ethers.Contract(token_address, erc20Abi, wallet);

      // 소수점/심볼
      const [decimals, symbol] = await Promise.all([
        contract.decimals().catch(() => 18),
        contract.symbol().catch(() => token_name)
      ]);
      const amountUnits = ethers.utils.parseUnits(amountStr, decimals);

      // 잔고(선택) 체크: 토큰 잔고 충분?
      const bal = await contract.balanceOf(wallet.address);
      if (bal.lt(amountUnits)) {
        return res.status(400).send({ result:'error', message:`잔고 부족: 보유 ${ethers.utils.formatUnits(bal, decimals)} ${symbol}` });
      }

      // 가스 한도/가스비
      const data = new ethers.utils.Interface(erc20Abi).encodeFunctionData('transfer', [receiverAddress, amountUnits]);
      const gasLimit = await provider.estimateGas({ from: wallet.address, to: token_address, data })
        .catch(() => ethers.BigNumber.from(90000));
      const feeData = await provider.getFeeData();

      // 전송
      const txResponse = await wallet.sendTransaction({
        to: token_address,
        data,
        gasLimit,
        ...(feeData.maxFeePerGas && feeData.maxPriorityFeePerGas
          ? { maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas }
          : { gasPrice: feeData.gasPrice || ethers.utils.parseUnits('30', 'gwei') }
        )
      });

      const receipt = await txResponse.wait(1);
      const usedFeeWei = receipt.gasUsed.mul(receipt.effectiveGasPrice || txResponse.gasPrice || 0);
      const usedFeeEth = Number(ethers.utils.formatEther(usedFeeWei));

      const historyData = {
        token_name,
        user_srl,
        user_id,
        type: 'withdraw',
        from_address: senderAddress,
        to_address: receiverAddress,
        amount: amountStr,
        usedFee: usedFeeEth,                // ETH 가스비
        IsExternalTrade: IsExternalTrade,
        transactionHash: receipt.transactionHash,
        token_address
      };

      insertDB(`${token_name}_history`, historyData, (error) => {
        if (error) {
          console.error('Database insert error:', error);
          return res.status(500).send({ result:'error', message:'Failed to save transaction history' });
        }
        res.status(200).send({
          result:'success',
          transaction: {
            hash: receipt.transactionHash,
            gasUsed: receipt.gasUsed.toString(),
            effectiveGasPrice: (receipt.effectiveGasPrice||0).toString(),
            usedFeeEth: usedFeeEth,
            token: { address: token_address, symbol, decimals }
          }
        });
      });
    } catch (error) {
      console.error('Transaction Error:', error?.response?.data || error?.message || error);
      res.status(500).send({ result:'error', message: error?.message || 'Failed to transfer token' });
    }
  });


// 1. 자산 가져오기 함수(LOTT)
async function getTokenBalance(PRIVATE_KEY, address) {
  const web3 = new Web3(process.env.INFURA_URL);

  // 지갑 설정
  const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
  web3.eth.accounts.wallet.add(account);
  web3.eth.defaultAccount = account.address;

  // const tokenAddress = '0xB9DB64714B6308A6300D5211f41560fcAa77dFfB'; // TEST
  const tokenAddress = '0xbA93EF534094F8b7001ECe2691168140965341ab'; // LOTT
  const tokenContract = new web3.eth.Contract(tokenABI, tokenAddress);
  // 토큰 잔액 가져오기
  const balance = await tokenContract.methods.balanceOf(account.address).call();
  const result_balance = web3.utils.fromWei(balance, 'ether');
  // console.log('getTokenBalance');
  // console.log(result_balance);

  return result_balance;
}

// 2. 토큰 전송 함수
async function sendToken(toAddress, amount) {
  const web3 = new Web3(process.env.INFURA_URL);
  const tokenAddress = '0xbA93EF534094F8b7001ECe2691168140965341ab';
  const tokenContract = new web3.eth.Contract(tokenABI, tokenAddress);
  const amountInWei = web3.utils.toWei(amount.toString(), 'ether');
  const tx = tokenContract.methods.transfer(toAddress, amountInWei);

  const gas = await tx.estimateGas({ from: account.address });
  const gasPrice = await web3.eth.getGasPrice();

  const data = tx.encodeABI();
  const txData = {
      from: account.address,
      to: tokenAddress,
      data: data,
      gas,
      gasPrice
  };

  const receipt = await web3.eth.sendTransaction(txData);
  // console.log(`Transaction hash: ${receipt.transactionHash}`);
  return receipt;
}

// 3. 이더리움 예상 수수료 계산 함수
async function estimateEthereumFee(fromAddress, toAddress, amount, tokenName) {
  try {
      const web3 = new Web3(process.env.INFURA_URL);

      // 기본 트랜잭션 데이터 생성
      const tx = {
          from: fromAddress,
          to: toAddress,
          value: web3.utils.toWei(amount.toString(), 'ether'), // ETH 값을 Wei로 변환
      };

      // 가스 한도 추정
      const gasLimit = await web3.eth.estimateGas(tx);

      // 현재 네트워크 가스 가격 가져오기
      const gasPrice = await web3.eth.getGasPrice();

      // 예상 수수료 계산
      const trxCostWei = BigInt(gasLimit) * BigInt(gasPrice);
      const trxCostEth = web3.utils.fromWei(trxCostWei.toString(), 'ether');

      // BigInt 값을 직렬화 가능한 값으로 변환
      return {
        gasLimit: gasLimit.toString(), // BigInt를 문자열로 변환
        gasPrice: web3.utils.fromWei(gasPrice, 'gwei') + ' Gwei',
        trxCostEth,
      };
  } catch (error) {
      console.error("Error calculating Ethereum fee:", error);
      throw error;
  }
}


// 지갑주소 내부 외부 확인 
async function checkInternal(token_name, to_address) {
  const rows = await checkAddressAsync({ token_name, to_address });
  return rows.length > 0 ? "N" : "Y"; // N 내부 지갑(전송 허용), Y 외부(전송 불가)
}


// 예제 실행
// (async () => {
//     await getTokenBalance();
//     // await sendToken('<RECEIVER_ADDRESS>', 10); // 10 tokens 전송
// })();

module.exports = router;
