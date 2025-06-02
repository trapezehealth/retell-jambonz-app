const { getE164, validateCountryCode } = require('../../lib/utils');
const { setInterval, clearInterval } = require('timers');

const service = ({ logger, makeService, activeJambonzSessions }) => { // activeJambonzSessions passed from app.js
  const svc = makeService({ path: '/retell' }); // Your existing path

  svc.on('session:new', async (session) => {
    const env = {
      pstnCarrier: process.env.PSTN_CARRIER,
      retellCarrier: process.env.RETELL_CARRIER,
      sipUsername: process.env.SIP_USERNAME,
      sipPassword: process.env.SIP_PASSWORD,
      countryCode: process.env.COUNTRY_CODE,
      overrideCallerId: process.env.OVERRIDE_CALLER_ID,
      overrideDialedNumber: process.env.OVERRIDE_DIALED_NUMBER
    };
    session.locals = { logger: logger.child({ sbc_callid: session.sbc_callid }) };
    let { from } = session;
    session.locals.logger.info({ session }, `New Jambonz session: ${session.sbc_callid}`);

    // Store session for external control via HTTP webhook
    activeJambonzSessions.set(session.sbc_callid, session);
    session.locals.logger.info(`Session ${session.sbc_callid} added to activeJambonzSessions. Map size: ${activeJambonzSessions.size}`);

    session.locals.keepAlive = setInterval(() => {
      session.ws.ping();
    }, 25000);

    let outboundFromRetell = false;
    if (session.direction === 'inbound'  &&
      env.pstnCarrier && env.sipUsername &&
      session.sip.headers['X-Authenticated-User']) {
        const username = session.sip.headers['X-Authenticated-User'].split('@')[0];
      if (username === env.sipUsername) {
        logger.info(`call ${session.sbc_callid} is coming from Retell`);
        outboundFromRetell = true;
      }
    }

    if (env.countryCode && !validateCountryCode(env.countryCode)) {
      logger.error(`invalid country code: ${env.countryCode}`);
      env.countryCode = null;
    }

    try {
      session
        .on('/refer', onRefer.bind(null, session))
        .on('close', onClose.bind(null, session, activeJambonzSessions))
        .on('error', onError.bind(null, session, activeJambonzSessions))
        .on('/dialAction', onDialAction.bind(null, session)) // Still useful for logging dial outcome
        .on('/transferActionHook', onTransferActionHook.bind(null, session));

      let target;
      const headersToOutgoingLeg = {}; // In case you need other headers for dialing

      if (outboundFromRetell) {
        // Call is from Retell to us; forward to original dialed PSTN number
        target = [{ type: 'phone', number: session.to, trunk: env.pstnCarrier }];
        if (env.overrideCallerId) from = env.overrideCallerId;
      } else {
        // Call is from PSTN to us; WE ARE DIALING RETELL
        const destNumberForRetell = env.countryCode ?
          await getE164(session.to, env.countryCode) :
          env.overrideDialedNumber || session.to;

        target = [{
          type: 'phone',
          number: destNumberForRetell, // The number/SIP URI for your Retell agent
          trunk: env.retellCarrier
        }];
        // NO NEED to explicitly add X-Jambonz-Call-SID if Retell already picks up a usable SID
        session.locals.logger.info(`Dialing Retell. Jambonz session ${session.sbc_callid} expects Retell to see its ID.`);
      }

      session
        .dial({
          callerId: from,
          answerOnBridge: true,
          anchorMedia: true,
          referHook: '/refer',
          actionHook: '/dialAction',
          target,
          headers: headersToOutgoingLeg
        })
        .hangup()
        .send();
    } catch (err) {
        session.locals.logger.error({ err }, `Error in session ${session.sbc_callid}`);
      session.hangup().send();
    }
  });
};

const onRefer = (session, evt) => {
  const { logger } = session.locals;
  const { refer_details } = evt;
  logger.info({ refer_details }, `session ${session.sbc_callid} received refer`);

  session
    .sip_refer({
      referTo: refer_details.refer_to_user,
      referredBy: evt.to
    })
    .reply();
};

const onClose = (session, activeJambonzSessions, code, reason) => {
  const { logger } = session.locals;
  clearInterval(session.locals.keepAlive);
  activeJambonzSessions.delete(session.sbc_callid); // Use session.call_sid as the key
  logger.info(`Session ${session.sbc_callid} removed from activeJambonzSessions. Map size: ${activeJambonzSessions.size}`);
  logger.info({ code, reason }, `Jambonz session ${session.sbc_callid} closed`);
};

const onError = (session, activeJambonzSessions, err) => {
  const { logger } = session.locals;
  logger.error({ err }, `Jambonz session ${session.sbc_callid} received error`);
  activeJambonzSessions.delete(session.sbc_callid); // Ensure cleanup on error too
  logger.info(`Session ${session.sbc_callid} removed from map due to error. Map size: ${activeJambonzSessions.size}`);
};

const onDialAction = (session, evt) => {
  // This hook is now primarily for logging the outcome of the dial to Retell (or other B leg)
  // It's NOT used for correlation ID capture in this simplified strategy.
  const { logger } = session.locals;
  logger.info({ DIAL_ACTION_EVENT: evt }, `/dialAction for ${session.sbc_callid}. Dial Status: ${evt.dial_call_status}, SIP: ${evt.dial_sip_status || 'N/A'}`);
  
  if (evt.dial_call_status !== 'completed' && evt.dial_call_status !== 'answered' && evt.dial_call_status !== 'early-media') {
    logger.warn(`Outbound dial from ${session.sbc_callid} did not connect successfully. Status: ${evt.dial_call_status}`);
    // The .hangup() in the main chain might cover this, or you could add specific handling.
  }
  session.reply(); // Acknowledge the hook
};

const onTransferActionHook = (session, evt) => {
  const { logger } = session.locals;
  logger.info({ evt }, `>> Outbound Transfer action hook for session ${session.sbc_callid}: referStatus ${evt.referStatus}, final_referred_call_status ${evt.final_referred_call_status}`);
  // This confirms the result of the transfer *we told Jambonz to do*.
  // You could potentially add logic here, e.g., if transfer failed, try something else,
  // but for now, just logging and acknowledging is fine.
  session.reply();
};

module.exports = service;
