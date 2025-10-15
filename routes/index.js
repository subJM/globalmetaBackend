var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', (req, res) => {
  res.json({ ok: true, service: 'crypto-api' });
});

router.get('/health', (req, res) => res.send('ok'));


module.exports = router;
