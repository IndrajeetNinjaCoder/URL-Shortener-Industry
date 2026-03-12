const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');   // ← add

const {
  createShortUrl, redirectUrl, previewUrl,
  editUrl, deleteUrl, bulkCreate
} = require('../controllers/url.controller');

router.post('/shorten',          authenticate, createShortUrl);   // protected
router.post('/shorten/bulk',     authenticate, bulkCreate);       // protected
router.get( '/preview/:shortId', authenticate, previewUrl);       // protected
router.put( '/edit/:shortId',    authenticate, editUrl);          // protected
router.delete('/delete/:shortId',authenticate, deleteUrl);        // protected
router.get(  '/:shortId',        redirectUrl);   // public — anyone can visit short links

module.exports = router;


// const express = require('express');
// const router  = express.Router();
// const { authenticate } = require('../middleware/auth');


// const {
//   createShortUrl,
//   redirectUrl,
//   previewUrl,
//   editUrl,
//   deleteUrl,
//   bulkCreate
// } = require('../controllers/url.controller');

// router.post('/shorten',       createShortUrl);
// router.post('/shorten/bulk',  bulkCreate);
// router.get( '/preview/:shortId', previewUrl);
// router.put( '/edit/:shortId',    editUrl);
// router.delete('/delete/:shortId', deleteUrl);
// router.get( '/:shortId',         redirectUrl);   // keep last — catch-all

// module.exports = router;
