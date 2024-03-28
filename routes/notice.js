var express = require('express');
var router = express.Router();

const {sendQuestion, getNotice , searchNotice ,getNoticeDetail} = require('../mysql');

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.post('/sendQuestion', async function(req, res, next) {
    const form = req.body;

    sendQuestion(form , (error , result) => {
        if(error){
            res.status(200).send({ result: 'error', error: error });
        }
        res.status(200).send({result: 'success'})
    });
});

router.get('/getNotice', async function(req, res, next) {
    await getNotice((error,results) =>{
        if(error){
            res.status(200).send({result: 'error' , error: error});
        }
        res.status(200).send({result: 'success' , data: results})
    });
});

router.post('/searchNotice', async function(req, res) {
    const searchData = req.body.search;
    console.log(searchData);

    await searchNotice(searchData , (error , results) => {
        if(error){
            res.status(200).send({result: 'error' , error: error});
        }
        console.log("results : "+ results);
        res.status(200).send({result: 'success', data: results});
    });
});

router.post('/getNoticeDetail', async function(req, res) {
    const notice_id = req.body.id;
    console.log();
    await getNoticeDetail(notice_id , (error , results) => {
        if(error){
            res.status(200).send({result: 'error' , error: error});
        }
        console.log("results : "+ results);
        res.status(200).send({result: 'success', data: results});
    });
});

module.exports = router;
