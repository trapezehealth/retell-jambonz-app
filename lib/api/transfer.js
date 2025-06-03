/*

  This example uses the dial verb with INVITE as the SIP method to transfer the call to a human agent via Ultravox serverTools.
  https://docs.jambonz.org/verbs/verbs/dial

  Alternatively, you can use SIP REFER as a method. When opting for this method, uncomment the commented code snippets, and remove the lines marked with "Remove ... when using sip:refer instead of dial".
  Ensure that the carrier of your choice supports SIP REFER.
  https://docs.jambonz.org/verbs/verbs/sip-refer

*/

const { TRANSFER_LOOKUP_MAP } = require('../config');
const express = require('express');
const jambonz = require('@jambonz/node-client');
const {WebhookResponse} = jambonz;
// const client = jambonz(process.env.JAMBONZ_ACCOUNT_SID, process.env.JAMBONZ_API_KEY, {baseUrl: process.env.JAMBONZ_BASE_URL});

const routes = express.Router();
// routes.post('/', async (req, res) => {
//   const {logger} = req.app.locals;
//   logger.info({body: req.body}, 'POST /api/transfer');
  
//   setTimeout(() => {
//     client.calls.update(req.body.call_sid, {call_hook: {
//       url: `${process.env.HTTP_BASE_URL}/api/transfer/call-hook`,
//       method: 'POST'
//     }});
//   }, 4000);
  
//   let response = {
//     message: 'The call is being transferred, say goodbye to the caller'
//   }
//   res.status(200).json(response);

// });

// // Remove when using sip:refer instead of dial
// routes.post('/call-hook', async (req, res) => {
//   const {logger} = req.app.locals;
//   logger.info({body: req.body}, 'POST /api/call-hook');
  
//   // Parse target_key from query parameters
//   const { target_key } = req.query;
//   if (target_key) {
//     logger.info({ target_key }, 'Received target_key in call-hook');
//   } else {
//     logger.warn('No target_key found in call-hook query parameters');
//   }

//   const destinationConfig = TRANSFER_LOOKUP_MAP[target_key];
  
//   if (!destinationConfig) {
//     logger.error({ target_key }, 'No destination config found for target_key');
//     return res.status(400).json({ error: `Unknown target_key: ${target_key}` });
//   }

//   // Build dial target based on destination type
//   let dialTarget;
//   if (destinationConfig.type === 'phone') {
//     dialTarget = {
//       type: 'phone',
//       number: destinationConfig.destination,
//       // trunk: process.env.PSTN_CARRIER
//     };
//   } else if (destinationConfig.type === 'sip') {
//     dialTarget = {
//       type: 'sip',
//       sipUri: destinationConfig.destination,
//     };
//   } else {
//     logger.error({ destinationConfig }, 'Invalid destination type in config');
//     return res.status(400).json({ error: 'Invalid destination type in config' });
//   }

//   logger.info({ dialTarget, target_key }, 'Creating dial target for transfer');

//   // Format caller ID using getE164
//   const formattedCallerId = await getE164(logger, req.body.from, 'US');

//   const app = new WebhookResponse();
//   app
//     .dial({
//       actionHook: '/api/transfer/dial-action',
//       callerId: "16316122701", // This likely sets the 'From' header's user part
//       headers: {
//         'P-Asserted-Identity': '<sip:16316122701@10.192.192.125>'
//         // Other headers if needed, like 'Privacy': 'none'
//       },
//       target: [
//         dialTarget
//       ]
//     })
//   res.status(200).json(app);
// })

// // Remove when using sip:refer instead of dial
// routes.post('/dial-action', async (req, res) => {
//   const {logger} = req.app.locals;
//   logger.info({body: req.body}, 'POST /api/transfer/dial-action');
//     const app = new WebhookResponse();
//     app
//       .say({
//         text: 'your call with the human agent has ended'
//       })
//       .hangup()
//     res.status(200).json(app);
// })

routes.post('/call-hook', async (req, res) => {
  const {logger} = req.app.locals;
  logger.info({body: req.body}, 'POST /api/call-hook');
  const { target_key } = req.query;
  
  if (target_key) {
    logger.info({ target_key }, 'Received target_key in call-hook');
  } else {
    logger.warn('No target_key found in call-hook query parameters');
  }

  const destinationConfig = TRANSFER_LOOKUP_MAP[target_key];
  
  if (!destinationConfig) {
    logger.error({ target_key }, 'No destination config found for target_key');
    return res.status(400).json({ error: `Unknown target_key: ${target_key}` });
  }

  const app = new WebhookResponse();
  app
    .say({
      text: `Please wait while I transfer you to ${target_key}.`
    })
    .pause({ length: .5 })
    .sip_refer({
      actionHook: '/api/transfer/sip_refer-action',
      eventHook: '/api/transfer/sip_refer-event',
      referTo: destinationConfig.destination,
    });
    
  res.status(200).json(app);
})

routes.post('/sip_refer-action', async (req, res) => {
  const {logger} = req.app.locals;
  logger.info({body: req.body}, 'POST /api/transfer/sip_refer-action');
  
  res.status(200).send();
})

routes.post('/sip_refer-event', async (req, res) => {
  const {logger} = req.app.locals;
  logger.info({body: req.body}, 'POST /api/transfer/sip_refer-event');

  res.status(200).send();
});

module.exports = routes;