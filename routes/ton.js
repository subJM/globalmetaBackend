var express = require('express');
var router = express.Router();

const fs = require('fs');
const {getAddressSendHistory , insertDB ,getTokenList, checkAddress , updateWalletInfo, getAllHistory, historyUpdate, historyDelete,checkUser, updateWallet , updateWalletAccount} = require('../mysql');

const TonWeb = require('tonweb');

var testnet = '1bb67a0cb948a5309998edcb22f3847656addc9808dc0080ed2e4b8517ed1567';
var mainnet = '6dd6a34b7ccf5fb766bd7d5f7a141214c1d25377f0f1b45a049d6d10432b4ceb';

router.get('/create_account', async (req, res) => {
    const user_id = req.body.user_id;
    const email = req.body.email;
  
    try {
  
      const result = await checkUser(user_id , email);
      if (result.length > 0) {
        // 아이디가 이미 존재하면 응답 후 종료
        return res.status(201).send('exist');
      };
  
      // TonWeb 인스턴스 생성
      const tonweb = new TonWeb(new TonWeb.HttpProvider('https://testnet.toncenter.com/api/v2/jsonRPC'));

  
      // users 테이블에 데이터 삽입
      const userResults = await insertDB('users', req.body);
      
      // Ton 계정 생성
      const keyPair = await TonWeb.utils.keyPair();
      const publicKey = keyPair.publicKey;
      const secretKey = keyPair.secretKey;
  
      console.log("Public Key:", TonWeb.utils.bytesToHex(publicKey));
      console.log("Secret Key:", TonWeb.utils.bytesToHex(secretKey));
  
      // Simple Wallet V3를 사용하여 Wallet 생성
      const wallet = tonweb.wallet.create({
          publicKey: publicKey,
          workchain: 0 // 기본적으로 workchain 0 사용
      });
  
      // Wallet 주소 가져오기
      const walletAddress = await wallet.getAddress();
  
      // 키 파일 생성
      await Promise.all([
        makeKeyFile(user_id, publicKey, 'publicKey'),
        makeKeyFile(user_id, secretKey, 'secretKey'),
      ]);
  
      // walletinfo 테이블에 데이터 삽입
      const walletData = [
        {
          user_srl: userResults.insertId,
          wallet: 'TON',
          token_name: 'TON',
          address: account_result.address.base58,
        },
        // {
        //   user_srl: userResults.insertId,
        //   wallet: 'TRON',
        //   token_name: 'EVC',
        //   address: account_result.address.base58,
        // },
      ];
  
      for (const data of walletData) {
        await insertDB('walletinfo', data);
      }
  
      // 성공 응답
      res.status(201).send('success');
    } catch (error) {
      console.error('error:', error);
      res.status(500).send('서버 오류 발생');
    }
});

async function makeKeyFile(user_id, content, fileName) {
  // 디렉토리 존재 확인
  const dirPath = `./user/${user_id}/TRON`;
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


module.exports = router;
