const Fs = require('fs');
const { logDebug } = require('./logging');
const { clone } = require('./utils');

const STATE_FILENAME = 'state.json';
const INITIAL_STATE = {
	media: [],
	local: []
}

const loadState = () => {
	try {
		logDebug('Loading previous application state...');
		const state = JSON.parse(Fs.readFileSync(STATE_FILENAME, 'utf8'));
		logDebug('Loaded application state.');
		
		return state;
	} catch {
		logDebug('Failed to read state.json. Returning empty state.');
		return clone(INITIAL_STATE);
	}
};

const saveState = state => {
	if (!state) {
		throw new Error('Attempt to save empty state.');
	}
	
	logDebug('Saving application state...');
	const json = JSON.stringify(state, undefined, 4);
	Fs.writeFileSync(STATE_FILENAME, json);
	logDebug('Saved application state.');
}

module.exports = {
	loadState,
	saveState
};
