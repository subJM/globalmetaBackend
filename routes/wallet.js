var express = require('express');
var router = express.Router();

const { getWalletBalance , updateWallet , getHistory} = require('../mysql.js');


/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.post('/getAddressBalance', async (req,res) => {
//    const data = req.body;
    const user_srl = req.body.user_srl;
    await getWalletBalance(user_srl , (error, results)=>{
        if(error){
            res.status(202).send({ result: 'error' , error : error });
        }
        res.status(200).send({ result: 'success' , data: results});
    });

});

router.post("/updateWallet", async (req, res)=>{
    const user_srl = req.body.user_srl;
    const token_name = req.body.token_name;
    const balance = req.body.balance;

    updateWallet(user_srl , token_name , balance, (result)=>{
        console.log("updateWallet : ",result);
        res.status(200).send({result: "success" , result: result});
    });

});
router.post("/getHistory", async (req, res)=>{
    const user_srl = req.body.user_srl;
    const token_name = req.body.token_name;
    const address = req.body.address;
    getHistory(user_srl , token_name , address, (result)=>{
        console.log('getHistory : ',result);
        res.status(200).send({result: "success" , data: result});
    });
});

module.exports = router;
