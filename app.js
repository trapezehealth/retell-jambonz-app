// Load environment variables from .env file
require('dotenv').config();
const { TRANSFER_LOOKUP_MAP } = require('./lib/config'); // Import config


const express = require('express');
const {createServer} = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const { Retell } = require('retell-sdk');
const app = express();
const server = createServer(app);
const makeService = createEndpoint({server});
const opts = Object.assign({
  timestamp: () => `, "time": "${new Date().toISOString()}"`,
  level: process.env.LOGLEVEL || 'info'
});
const logger = require('pino')(opts);
const port = process.env.WS_PORT || 3000;

// Map key: jambonz_session.call_sid, Value: Jambonz Session Object
const activeJambonzSessions = new Map();

// Set up app locals
app.locals = { ...app.locals, logger, activeJambonzSessions }; // Make map globally accessible within app scope

// Add middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Set up WebSocket routes
require('./lib/routes')({logger, makeService, activeJambonzSessions});

app.post('/transfer', async (req, res) => {
  logger.info({ body: req.body, headers: req.headers }, 'Received POST on /transfer');

  // 1. Authenticate Request using Retell's signature verification
  if (
    !Retell.verify(
      JSON.stringify(req.body),
      process.env.RETELL_API_KEY,
      req.headers["x-retell-signature"]
    )
  ) {
    logger.warn('Unauthorized transfer attempt: Invalid Retell signature');
    return res.status(401).json({ error: 'Unauthorized' });
  }

    // Retell's payload structure is { name: "func_name", args: { /* LLM generated */ }, call: { /* call context */ } }
    logger.info({ request_body: req.body }, 'Received POST on /transfer');
    const llmArgs = req.body.args;
    const callContext = req.body.call;
  
    if (!llmArgs || !callContext) {
      logger.warn('Request body missing "args" or "call" field from Retell.', { request_body: req.body });
      return res.status(400).json({ error: 'Malformed request from Retell: missing args or call object.' });
    }
  
    const { target_key } = llmArgs;
    let sbc_callid = null;
  
    // Extract jambonz_call_sid directly from the call context's custom_sip_headers
    if (callContext.custom_sip_headers && callContext.custom_sip_headers['x-cid']) {
      sbc_callid = callContext.custom_sip_headers['x-cid'];
      logger.info(`Extracted jambonz_sbc_callid ('${sbc_callid}') from call.custom_sip_headers['x-cid']`);
    } else if (callContext.retell_llm_dynamic_variables && callContext.retell_llm_dynamic_variables['cid']) {
      // Fallback to dynamic variables if custom header is not found or preferred
      sbc_callid = callContext.retell_llm_dynamic_variables['cid'];
      logger.info(`Extracted jambonz_sbc_callid ('${sbc_callid}') from call.retell_llm_dynamic_variables['cid']`);
    }
  
  
    if (!target_key) {
      logger.warn({ llmArgs }, 'Missing target_key in function arguments from Retell LLM');
      return res.status(400).json({ error: 'Missing target_key in function arguments' });
    }
    if (!sbc_callid) {
      logger.warn({ callContext }, 'Could not find sbc_callid in call.custom_sip_headers["x-cid"] or call.retell_llm_dynamic_variables["cid"]');
      return res.status(400).json({ error: 'Jambonz Call SID not found in Retell call context' });
    }
  
    const session = app.locals.activeJambonzSessions.get(sbc_callid);
    if (!session) {
      logger.warn(`No active Jambonz session found for sbc_callid: ${sbc_callid}. Current map size: ${app.locals.activeJambonzSessions.size}`);
      return res.status(404).json({ error: `No active Jambonz session found for SID ${sbc_callid}` });
    }
  
    const destination_uri = TRANSFER_LOOKUP_MAP[target_key]; // From lib/config.js
    if (!destination_uri) {
      logger.warn(`No destination URI found for target_key: ${target_key}`);
      return res.status(400).json({ error: `Invalid target_key: ${target_key}` });
    }
  
    try {
      logger.info(`Initiating SIP REFER for Jambonz session ${sbc_callid} to ${destination_uri}`);
      session.sendCommand('sip:refer', {
        referTo: destination_uri,
        actionHook: '/transferActionHook' // To get feedback on the transfer itself
      });
  
      logger.info(`SIP REFER command sent for session ${sbc_callid}`);
      // Respond to Retell's custom function call with a success indicator
      res.status(200).json({ transfer_status: "initiated", destination: destination_uri, commanded_jambonz_sid: sbc_callid });
    } catch (err) {
      logger.error({ err, sbc_callid }, `Error initiating SIP REFER`);
      // Still send 200 OK to Retell custom func, but indicate error in payload so LLM knows it failed
      res.status(200).json({ transfer_status: "error", error_message: 'Failed to initiate transfer on Jambonz side' });
    }
});

// Handle 404 - Not Found
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Handle other errors
app.use((err, req, res, next) => {
  logger.error(err, 'burped error');
  res.status(err.status || 500).json({msg: err.message});
});

server.listen(port, () => {
  logger.info(`jambonz websocket server listening at http://localhost:${port}`);
});