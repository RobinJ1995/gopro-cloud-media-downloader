import Prompts from 'prompts';
import Colors from 'colors';

const colouriseStrings = (params, colourisation) => params.map(param => {
	if (typeof param === 'string') {
		return colourisation(param);
	}
	
	return param;
})

// figlet -f slant GoPro
// figlet -f small Cloud Media Downloader
export const welcome = () => console.log(`
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


export const logSuccess = (...params) => console.info('✅'.bgGreen, ...colouriseStrings(params, x => x.green));
export const logInfo = (...params) => console.info('ℹ️ '.bgGreen, ...colouriseStrings(params, x => x.brightCyan));
export const logWarn = (...params) => console.warn('⚠️ '.bgYellow, ...colouriseStrings(params, x => x.red));
export const logError = (...params) => console.error('⚠️ '.bgRed, ...colouriseStrings(params, x => x.bgRed.bold.white));
export const logDebug = (...params) => process.env.DEBUG && console.info('🤓️'.bgBlack, ...colouriseStrings(params, x => x.dim));
export const logUrl = url => {
	if (process.env.DEBUG) {
		console.debug('🌐 '.bgBlack + `${url}`.dim.italic);
	}
	
	return url;
};
export const prompt = async (label, type = 'text', extraOpts = Object.freeze({})) => (await Prompts({
	message: label.bgWhite.black.underline,
	name: 'value',
	type,
	...extraOpts
})).value;
export const promptYesOrNo = async label => {
	while (true) {
		const answer = await prompt(`${label} (yes/no)`);
		if (String(answer).toLowerCase().trim() === 'no') {
			return false;
		} else if (String(answer).toLowerCase().trim() === 'yes') {
			return true;
		}

		logWarn('Please answer "yes" or "no".');
	}
};
