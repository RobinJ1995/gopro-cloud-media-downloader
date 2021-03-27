const prompt = require('prompt-sync')();
require('colors');

const colouriseStrings = (params, colourisation) => params.map(param => {
	if (typeof param === 'string') {
		return colourisation(param);
	}
	
	return param;
})

// figlet -f slant GoPro
// figlet -f small Cloud Media Downloader
const welcome = () => console.log(`
	   ______      ____
	  / ____/___  / __ \\_________
	 / / __/ __ \\/ /_/ / ___/ __ \\
	/ /_/ / /_/ / ____/ /  / /_/ /
	\\____/\\____/_/   /_/   \\____/
`.brightCyan.bgBlack.bold + `
  ___ _             _   __  __        _ _
 / __| |___ _  _ __| | |  \\/  |___ __| (_)__ _
| (__| / _ \\ || / _\` | | |\\/| / -_) _\` | / _\` |
 \\___|_\\___/\\_,_\\__,_| |_|  |_\\___\\__,_|_\\__,_|
 
 ___                  _              _
|   \\ _____ __ ___ _ | |___  __ _ __| |___ _ _
| |) / _ \\ V  V / ' \\| / _ \\/ _\` / _\` / -_) '_|
|___/\\___/\\_/\\_/|_||_|_\\___/\\__,_\\__,_\\___|_|
`.bgBlack.brightBlue);

module.exports = {
	welcome,
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
	prompt: label => prompt(`❓ `.bgBlue + `${label}`.bgWhite.black.underline + ' ')
};
