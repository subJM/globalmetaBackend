var express = require('express');
var router = express.Router();

const { getWalletBalance , updateWallet , getHistory} = require('../mysql.js');


/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.post('/getAddressBalance', async (req,res) => {
    const data = req.body;
    const user_srl = req.body.user_srl;

    await getWalletBalance(user_srl , (error, results)=>{

        if(error){
            res.status(500).send({ result: 'error' , error : error });
        }
        res.status(200).send({ result: 'success' , data: results});
    });

});
router.post('/getUserWallet', async (req,res) => {
    const user_srl = req.body.user_srl;

    await getWalletBalance(user_srl , (error, results)=>{

        if(error){
            return res.status(500).send({ result: 'error', message: error.message });
        }
        return res.status(200).send({ result: 'success' , data: results});
    });

});

router.post("/updateWallet", (req, res)=>{
    const user_srl = req.body.user_srl;
    const token_name = req.body.token_name;
    const balance = req.body.balance;
    console.log('업데이트' ,req.body);
    updateWallet(user_srl, token_name, balance, (error, results)=>{
        if (error) {
            console.error("updateWallet failed:", error);
            return res.status(500).send({
                result: "error",
                message: error.message,
            });
        }

        return res.status(200).send({ result: "success", data: results });
    });

});

// router.post("/updateWallet", async (req, res)=>{
//     const user_srl = req.body.user_srl;
//     const user_id = req.body.user_id;
//     const token_name = req.body.token_name;
//     const address = req.body.address;
//     const balance = req.body.balance;
//     const beforeBalance = req.body.beforeBalance;

    // const depositBalance = balance - beforeBalance; 
    // if(depositBalance != 0){
    //     const historyData = {
    //         token_name: token_name,
    //         user_srl: user_srl,
    //         user_id: user_id,
    //         from : "deposit",
    //         to : address,
    //         amount : depositBalance,
    //         usedFee : 0,
    //         transactionHash: "deposit",
    //     };
    //     await insertDB(token_name+'_history', historyData, (error, result)=>{
    //         if(error){
    //             throw error;
    //         }else{
    //             updateWallet(user_srl , token_name , balance, (result)=>{
    //                 console.log("updateWallet : ");
    //                 res.status(200).send({result: "success" });
    //             });
    //         }
    //     });
    // }
//     updateWallet(user_srl , token_name , balance, (result)=>{
//         console.log("updateWallet : ");
//         res.status(200).send({result: "success" });
//     });
// });

router.post("/getHistory", async (req, res)=>{
    const user_srl = req.body.user_srl;
    const token_name = req.body.token_name.toLowerCase();
    const address = req.body.address;
    console.log(req.body);
    getHistory(user_srl , token_name , address, (error , result)=>{
        res.status(200).send({result: "success" , data: result});
    });
});

module.exports = router;
