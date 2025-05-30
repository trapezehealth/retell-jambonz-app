const { mergeEnvVarsWithDefaults } = require('@jambonz/node-client-ws');
const {getE164, validateCountryCode} = require('../../lib/utils');
const { setInterval, clearInterval } = require('timers');

const service = ({logger, makeService}) => {
  const svc = makeService({path: '/retell'});
  const schema = require('../../app.json');

  svc.on('session:new', async(session) => {
    const env = mergeEnvVarsWithDefaults(session.env_vars, svc.path, schema);
    session.locals = {logger: logger.child({call_sid: session.call_sid})};
    let {from} = session;
    logger.info({session}, `new incoming call: ${session.call_sid}`);

    /* Send ping to keep alive websocket as some platforms timeout, 25sec as 30sec timeout is not uncommon */
    session.locals.keepAlive = setInterval(() => {
      session.ws.ping();
    }, 25000);

    /* determine direction of the call */
    let outboundFromRetell = false;
    if (session.direction === 'inbound' &&
      env.pstnCarrier && env.sipUsername &&
      session.sip.headers['X-Authenticated-User']) {

      /* check if the call is coming from Retell; i.e. using the sip credential we provisioned there */
      const username = session.sip.headers['X-Authenticated-User'].split('@')[0];
      if (username === env.sipUsername) {
        logger.info(`call ${session.call_sid} is coming from Retell`);
        outboundFromRetell = true;
      }
    }

    /* validate country code */
    if (env.countryCode) {
      if (!validateCountryCode(env.countryCode)) {
        logger.error(`invalid country code: ${env.countryCode}`);
        env.countryCode = null;
      }
    }

    try {
      session
        .on('/refer', onRefer.bind(null, session))
        .on('close', onClose.bind(null, session))
        .on('error', onError.bind(null, session))
        .on('/dialAction', onDialAction.bind(null, session));

      let target;
      const headers = {};
      if (outboundFromRetell) {
        /* call is coming from Retell, so we will forward it to the original dialed number */
        target = [
          {
            type: 'phone',
            number: session.to,
            trunk: env.pstnCarrier
          }
        ];
        /* Workaround for SIPGATE and maybe others, put User ID as from and CLI in header */
        if (env.overrideCallerId) {
          //headers["P-Preferred-Identity"] = `${from}@SIPGATE_DOMAIN`;
          from = env.overrideCallerId;
        }
      }
      else {
        /* https://docs.retellai.com/make-calls/custom-telephony#method-1-elastic-sip-trunking-recommended */

        /**
         * Note: below we are forwarding the incoming call to Retell using the same dialed number.
         * This presumes you have added this number to your Retell account.
         * If you added a different number, you can change the `to` variable.
         */
        // If default country code is set then ensure to is in e.164 format
        const dest = env.countryCode ?
          await getE164(session.to, env.countryCode) :
          env.overrideDialedNumber || session.to;
        target = [
          {
            type: 'phone',
            number: dest,
            trunk: env.retellCarrier
          }
        ];
      }

      session
        .dial({
          callerId: from,
          answerOnBridge: true,
          anchorMedia: true,
          referHook: '/refer',
          actionHook: '/dialAction',
          target,
          headers
        })
        .hangup()
        .send();
    } catch (err) {
      session.locals.logger.info({err}, `Error to responding to incoming call: ${session.call_sid}`);
      session.close();
    }
  });
};

const onRefer = (session, evt) => {
  const {logger} = session.locals;
  const {refer_details} = evt;
  logger.info({refer_details}, `session ${session.call_sid} received refer`);

  session
    .sip_refer({
      referTo: refer_details.refer_to_user,
      referredBy: evt.to
    })
    .reply();
};

const onClose = (session, code, reason) => {
  const {logger} = session.locals;
  clearInterval(session.locals.keepAlive); // remove keep alive
  logger.info({session, code, reason}, `session ${session.call_sid} closed`);
};

const onError = (session, err) => {
  const {logger} = session.locals;
  logger.info({err}, `session ${session.call_sid} received error`);
};

const onDialAction = (session, evt) => {
  const {logger} = session.locals;
  if (evt.dial_call_status != 'completed') {
    logger.info(`outbound dial failed with ${evt.dial_call_status}, ${evt.dial_sip_status}`);
    session
      .sip_decline({status: evt.dial_sip_status})
      .reply();
  }
  else session.reply();
};

module.exports = service;
