var express = require('express');
var router = express.Router();
const fs = require('fs');
const path = require('path');

require('dotenv').config();
const {Web3} = require('web3');
// import Web3 from 'web3';




// ERC-20 토큰 주소와 ABI 설정

const tokenABI = [{"constant":true,"inputs":[],"name":"name","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"value","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"from","type":"address"},{"name":"to","type":"address"},{"name":"value","type":"uint256"}],"name":"transferFrom","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"addedValue","type":"uint256"}],"name":"increaseAllowance","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"lockAddress","type":"address"},{"name":"lockType","type":"uint8"},{"name":"endtimeList","type":"uint256[]"},{"name":"remainList","type":"uint256[]"}],"name":"lock","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[],"name":"unpause","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"paused","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[],"name":"renounceOwnership","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[],"name":"pause","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"owner","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"subtractedValue","type":"uint256"}],"name":"decreaseAllowance","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"to","type":"address"},{"name":"value","type":"uint256"}],"name":"transfer","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"name":"allowance","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"lockData","outputs":[{"name":"lockType","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"inputs":[],"payable":false,"stateMutability":"nonpayable","type":"constructor"},{"payable":true,"stateMutability":"payable","type":"fallback"},{"anonymous":false,"inputs":[{"indexed":true,"name":"lockAddress","type":"address"},{"indexed":true,"name":"lockType","type":"uint8"},{"indexed":false,"name":"endtimeList","type":"uint256[]"},{"indexed":false,"name":"remainList","type":"uint256[]"}],"name":"Lock","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"spender","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"account","type":"address"}],"name":"Paused","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"account","type":"address"}],"name":"Unpaused","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"previousOwner","type":"address"},{"indexed":true,"name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"}];

router.get('/check',async(req, res, next) => {

    // const user_id = req.body.user_id;
    const user_id = req.query.user_id;
    const address = req.query.address;
  
    const keyPath = path.join(__dirname, '..',`user`,`${user_id}`,`privateKey`);
    console.log(keyPath);
    const senderPrivateKey =fs.readFileSync(keyPath, 'utf8');

    var balance = getTokenBalance(senderPrivateKey, address);
    console.log(balance);
});

router.post('/getLottBalance', async (req, res, next) => {
    const user_id = req.body.user_id;
    const address = req.body.address;
    try {
        const keyPath = path.join(__dirname, '..', `user`, `${user_id}`, `privateKey`);
        const senderPrivateKey = fs.readFileSync(keyPath, 'utf8').trim();
        // getTokenBalance 호출에 await 추가
        const balance = await getTokenBalance(senderPrivateKey, address);
        res.json({ balance: balance });
    } catch (error) {
        console.error('Error fetching balance:', error);
        res.status(500).json({ error: 'Failed to fetch token balance' });
    }
});


// 1. 자산 가져오기 함수
async function getTokenBalance(PRIVATE_KEY, address) {
    const web3 = new Web3(process.env.INFURA_URL);

    // 지갑 설정
    const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
    web3.eth.accounts.wallet.add(account);
    web3.eth.defaultAccount = account.address;
    console.log(account.address);

    // const tokenAddress = '0xB9DB64714B6308A6300D5211f41560fcAa77dFfB'; // TEST
    const tokenAddress = '0xbA93EF534094F8b7001ECe2691168140965341ab'; // LOTT
    const tokenContract = new web3.eth.Contract(tokenABI, tokenAddress);
    
    // 토큰 잔액 가져오기
    const balance = await tokenContract.methods.balanceOf(address).call();
    const result_balance = web3.utils.fromWei(balance, 'ether');
    console.log('잔액');
    console.log(result_balance);
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
    console.log(`Transaction hash: ${receipt.transactionHash}`);
    return receipt;
}

router.post('/getAddressBalance', async (req, res) => {
    const address = req.body.address;
    const result = await getAddressBalance(address);
    console.log(result);
    res.status(201).send({balance: result});
});
  
  

// 예제 실행
// (async () => {
//     await getTokenBalance();
//     // await sendToken('<RECEIVER_ADDRESS>', 10); // 10 tokens 전송
// })();

module.exports = router;
