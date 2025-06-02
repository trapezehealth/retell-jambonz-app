const { TRANSFER_LOOKUP_MAP } = require('./config');

/**
 * Initiates a SIP REFER transfer for a Jambonz session
 * @param {Object} session - The active Jambonz session object
 * @param {string} target_key - The target key to look up destination URI
 * @param {string} [sbc_callid] - The SBC call ID for logging purposes (optional)
 * @param {Object} logger - Pino logger instance
 * @returns {Promise<Object>} Result object with success/error status
 */
async function initiateSessionTransfer(session, target_key, sbc_callid = null, logger) {
  try {
    // Look up destination URI from target key
    const destination_uri = TRANSFER_LOOKUP_MAP[target_key];
    if (!destination_uri) {
      logger.warn(`No destination URI found for target_key: ${target_key}`);
      return {
        success: false,
        error: `Invalid target_key: ${target_key}`,
        error_code: 'INVALID_TARGET_KEY'
      };
    }

    // Initiate SIP REFER
    const logContext = sbc_callid ? `for Jambonz session ${sbc_callid}` : '';
    logger.info(`Initiating SIP REFER ${logContext} to ${destination_uri}`);
    await session.sendCommand('sip:refer', {
      referTo: destination_uri,
      actionHook: '/transferActionHook' // To get feedback on the transfer itself
    });

    logger.info(`SIP REFER command sent ${logContext}`);
    return {
      success: true,
      destination: destination_uri,
      sbc_callid: sbc_callid
    };

  } catch (err) {
    const logContext = sbc_callid ? { err, sbc_callid } : { err };
    logger.error(logContext, `Error initiating SIP REFER`);
    return {
      success: false,
      error: 'Failed to initiate transfer on Jambonz side',
      error_code: 'TRANSFER_COMMAND_FAILED',
      details: err.message
    };
  }
}

module.exports = {
  initiateSessionTransfer
}; 