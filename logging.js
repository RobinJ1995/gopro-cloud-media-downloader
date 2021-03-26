module.exports = {
	logInfo: (...params) => console.info('ℹ️', ...params),
	logWarn: (...params) => console.warn('⚠️', ...params),
	logError: (...params) => console.error('⚠️', ...params),
	logDebug: (...params) => process.env.DEBUG && console.info('🤓️', ...params)
};