const Fs = require('fs');
const { logDebug } = require('./logging');
const { clone } = require('./utils');

const STATE_FILENAME = 'state.json';
const INITIAL_STATE = {
	runs: []
}

const loadState = () => {
	try {
		logDebug('Loading previous application state...');
		return JSON.parse(Fs.readFileSync(STATE_FILENAME, 'utf8'));
	} catch {
		logDebug('Failed to read state.json. Returning empty state.');
		return clone(INITIAL_STATE);
	} finally {
		logDebug('Loaded application state.');
	}
};

const saveState = state => {
	logDebug('Saving application state...');
	const json = JSON.stringify(state, undefined, 4);
	Fs.writeFileSync(STATE_FILENAME, json);
	logDebug('Saved application state.');
}

module.exports = {
	loadState,
	saveState
};