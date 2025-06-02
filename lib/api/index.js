const router = require('express').Router();

router.use('/transfer', require('./transfer'));
module.exports = router;
