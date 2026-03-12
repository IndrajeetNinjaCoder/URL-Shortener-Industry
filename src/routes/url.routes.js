const express = require('express');
const router  = express.Router();

const {
  createShortUrl,
  redirectUrl,
  previewUrl,
  editUrl,
  deleteUrl,
  bulkCreate
} = require('../controllers/url.controller');

router.post('/shorten',       createShortUrl);
router.post('/shorten/bulk',  bulkCreate);
router.get( '/preview/:shortId', previewUrl);
router.put( '/edit/:shortId',    editUrl);
router.delete('/delete/:shortId', deleteUrl);
router.get( '/:shortId',         redirectUrl);   // keep last — catch-all

module.exports = router;
