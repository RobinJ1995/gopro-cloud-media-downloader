import Fs from 'fs';
import { logDebug } from './logging.js';
import { clone } from './utils.js';

const STATE_FILENAME = 'state.json';
const INITIAL_STATE = {
	media: [],
	local: []
}

export const loadState = () => {
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

export const saveState = state => {
	if (!state) {
		throw new Error('Attempt to save empty state.');
	}
	
	logDebug('Saving application state...');
	const json = JSON.stringify(state, undefined, 4);
	Fs.writeFileSync(STATE_FILENAME, json);
	logDebug('Saved application state.');
}
