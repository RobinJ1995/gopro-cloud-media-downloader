const prompt = require('prompt-sync')();
require('colors');

const colouriseStrings = (params, colourisation) => params.map(param => {
	if (typeof param === 'string') {
		return colourisation(param);
	}
	
	return param;
})

module.exports = {
	logSuccess: (...params) => console.info('✅'.bgGreen, ...colouriseStrings(params, x => x.green)),
	logInfo: (...params) => console.info('ℹ️ '.bgGreen, ...colouriseStrings(params, x => x.brightCyan)),
	logWarn: (...params) => console.warn('⚠️ '.bgYellow, ...colouriseStrings(params, x => x.red)),
	logError: (...params) => console.error('⚠️ '.bgRed, ...colouriseStrings(params, x => x.bgRed.bold.white)),
	logDebug: (...params) => process.env.DEBUG && console.info('🤓️'.bgBlack, ...colouriseStrings(params, x => x.dim)),
	logUrl: url => {
		if (process.env.DEBUG) {
			console.debug('🌐 '.bgBlack + `${url}`.dim.italic);
		}
		
		return url;
	},
	prompt: label => prompt(`❓ `.bgBlue + `${label}`.bgWhite.black.underline)
};