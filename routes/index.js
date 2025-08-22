var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', (req, res) => {
  res.json({ ok: true, service: 'crypto-api' });
});

module.exports = router;
