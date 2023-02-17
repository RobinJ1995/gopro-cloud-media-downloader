import { logSuccess, logInfo, logWarn, logError, logDebug, logUrl, prompt } from './logging.js';
import { checkHttpStatus, httpCheckParse, clone, pluralise, stripFields, LOGIN_URL } from './utils.js';
import NodeFetch from 'node-fetch';
import FetchCookie from 'fetch-cookie';
const fetch = FetchCookie(NodeFetch);

const findCsrfToken = html => [...html.matchAll(/meta\s+name=\"csrf\-token\"\s+content=\"?([^\"\/>]+)\"?\/?>/gi)][0][1];

export const initLoginRoutine = () => {
	logInfo('Please provide your GoPro Cloud credentials');
	console.log('   ===========================================');
	const email = process.env.GOPRO_ACCOUNT_EMAIL || prompt('E-mail address: ');
	const password = process.env.GOPRO_ACCOUNT_PASSWORD || prompt('Password: ');
	console.log('   ===========================================');
	
	if (!email || !password) {
		logError('Please provide a valid e-mail address and password.');
		process.exit(1);
	}
	
	logInfo('Finding CSRF token...');
	return fetch(logUrl(LOGIN_URL))
		.then(checkHttpStatus)
		.then(r => r.text())
		.then(findCsrfToken)
		.then(csrfToken => {
			logDebug(`CSRF token: ${csrfToken}`);
			logInfo('Logging in...');
			return fetch(logUrl(LOGIN_URL), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-CSRF-Token': csrfToken
				},
				body: JSON.stringify({
					email,
					password,
					referrer: '',
					scope: 'username, email, me',
					clientUserAgent: 'GoPro Cloud Media Downloader',
					two_factor: '',
					fingerprint: '',
					brand: ''
				})
			});
		})
		.then(httpCheckParse)
		.then(res => {
			const accessToken = res?.access_token;
			logDebug(`Access token: ${accessToken}`);
			if (!accessToken) {
				logError('Login failed. No access token found in response.', res);
				process.exit(2);
			}
			
			logSuccess('Login successful.');
			
			return accessToken;
		});
};
