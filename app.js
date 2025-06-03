// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const {createServer} = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const jambonz = require('@jambonz/node-client');
const { Retell } = require('retell-sdk');
const app = express();
const server = createServer(app);
const makeService = createEndpoint({server});
const routes = require('./lib/api');
const opts = Object.assign({
  timestamp: () => `, "time": "${new Date().toISOString()}"`,
  level: process.env.LOGLEVEL || 'info'
});
const logger = require('pino')(opts);
const port = process.env.WS_PORT || 3000;

// Map key: jambonz_session.call_sid, Value: Jambonz Session Object
const client = jambonz(process.env.JAMBONZ_ACCOUNT_SID, process.env.JAMBONZ_API_KEY, {baseUrl: process.env.JAMBONZ_BASE_URL});
const activeJambonzSessions = new Map();

// Set up app locals
app.locals = { ...app.locals, logger, activeJambonzSessions }; // Make map globally accessible within app scope

// Add middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use('/api', (req, res, next) => {
  next();
},routes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'retell-jambonz-app',
    uptime: process.uptime()
  });
});

// Active sessions endpoint
app.get('/sessions', (req, res) => {
  const sessionCount = app.locals.activeJambonzSessions.size;
  const sessions = [];
  
  // Get basic info about each active session
  for (const [callSid, session] of app.locals.activeJambonzSessions.entries()) {
    sessions.push({
      call_sid: callSid,
      // Add any other relevant session info that's safe to expose
      session_id: session.session_id || null,
      created_at: session.created_at || null
    });
  }
  
  res.status(200).json({
    active_sessions: sessionCount,
    timestamp: new Date().toISOString(),
    sessions: sessions
  });
});

// Set up WebSocket routes
require('./lib/routes')({logger, makeService, activeJambonzSessions});

/**
 * Validates the Retell signature for authentication
 */
function validateRetellSignature(body, apiKey, signature) {
  return Retell.verify(JSON.stringify(body), apiKey, signature);
}

/**
 * Extracts and validates the request payload from Retell
 */
function extractRequestPayload(body) {
  const { args: llmArgs, call: callContext } = body;
  
  if (!llmArgs || !callContext) {
    throw new Error('Malformed request from Retell: missing args or call object');
  }
  
  return { llmArgs, callContext };
}

/**
 * Extracts the SBC call ID from the call context with fallback logic
 */
function extractSbcCallId(callContext, logger) {
  let sbc_callid = null;
  
  // Primary: Check custom SIP headers
  if (callContext.custom_sip_headers?.['x-cid']) {
    sbc_callid = callContext.custom_sip_headers['x-cid'];
    logger.info(`Extracted jambonz_sbc_callid ('${sbc_callid}') from call.custom_sip_headers['x-cid']`);
  } 
  // Fallback: Check dynamic variables
  else if (callContext.retell_llm_dynamic_variables?.['cid']) {
    sbc_callid = callContext.retell_llm_dynamic_variables['cid'];
    logger.info(`Extracted jambonz_sbc_callid ('${sbc_callid}') from call.retell_llm_dynamic_variables['cid']`);
  }
  
  return sbc_callid;
}

/**
 * Updates the Jambonz call hook for transfer
 */
function updateCallHook(client, session, target_key = null) {
  const baseUrl = `${process.env.HTTP_BASE_URL}/api/transfer/call-hook`;
  const callHookUrl = target_key ? `${baseUrl}?target_key=${encodeURIComponent(target_key)}` : baseUrl;
  
  client.calls.update(session.call_sid, {
    call_hook: {
      url: callHookUrl,
      method: 'POST'
    }
  });
}

app.post('/transfer', async (req, res) => {
  logger.info({ body: req.body, headers: req.headers }, 'Received POST on /transfer');

  try {
    // 1. Authenticate request using Retell's signature verification
    if (!validateRetellSignature(req.body, process.env.RETELL_API_KEY, req.headers["x-retell-signature"])) {
      logger.warn('Unauthorized transfer attempt: Invalid Retell signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 2. Extract and validate request payload
    const { llmArgs, callContext } = extractRequestPayload(req.body);
    const { target_key } = llmArgs;

    // 3. Validate required parameters
    if (!target_key) {
      logger.warn({ llmArgs }, 'Missing target_key in function arguments from Retell LLM');
      return res.status(400).json({ error: 'Missing target_key in function arguments' });
    }

    // 4. Extract SBC call ID with fallback logic
    const sbc_callid = extractSbcCallId(callContext, logger);
    if (!sbc_callid) {
      logger.warn({ callContext }, 'Could not find sbc_callid in call context');
      return res.status(400).json({ error: 'Jambonz Call SID not found in Retell call context' });
    }

    // 5. Find active Jambonz session
    const session = app.locals.activeJambonzSessions.get(sbc_callid);
    if (!session) {
      logger.warn(`No active Jambonz session found for sbc_callid: ${sbc_callid}. Current map size: ${app.locals.activeJambonzSessions.size}`);
      return res.status(404).json({ error: `No active Jambonz session found for SID ${sbc_callid}` });
    }

    // 6. Initiate transfer by updating call hook
    updateCallHook(client, session, target_key);
    
    logger.info(`Transfer initiated successfully for sbc_callid: ${sbc_callid} and call_sid: ${session.call_sid}`);
    res.status(200).json({ 
      transfer_status: "initiated", 
      destination: target_key
    });

  } catch (err) {
    logger.error(err, 'Error during transfer process');
    return res.status(500).json({ error: 'Internal server error during transfer' });
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