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
    try {
      // getNotice가 콜백 방식으로 동작하는 경우
      await getNotice((error, results) => {
        if (error) {
          // 콜백에서 발생한 오류를 Express의 에러 처리 미들웨어로 전달
          return next(error);
        }
        // 정상적인 경우 결과를 클라이언트로 전송
        res.status(200).send({ result: 'success', data: results });
      });
    } catch (error) {
      // 비동기 함수 자체에서 발생한 예외를 처리
      next(error);
    }
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
