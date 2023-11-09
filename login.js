import { logSuccess, logInfo, logWarn, logError, logDebug, logUrl, prompt } from './logging.js';
import { checkHttpStatus, httpCheckParse, LOGIN_URL, DEFAULT_HEADERS_FOR_WEB_REQUESTS } from './utils.js';
import NodeFetch from 'node-fetch';
import FetchCookie from 'fetch-cookie';

// Enable cookies with NodeFetch
const fetch = FetchCookie(NodeFetch);

// Function to find the CSRF token in the HTML content
const findCsrfTokenInPageHtml = html => [...html.matchAll(/meta\s+name=\"csrf\-token\"\s+content=\"?([^\"\/>]+)\"?\/?>/gi)][0][1];
// Function to load login page and extract CSRF token from it
const obtainCsrfToken = async () => {
	try {
		logInfo('Finding CSRF token...');
		const csrfToken = await fetch(logUrl(LOGIN_URL), {
			headers: DEFAULT_HEADERS_FOR_WEB_REQUESTS
		})
			.then(checkHttpStatus)
			.then(r => r.text())
			.then(findCsrfTokenInPageHtml);

		logDebug(`CSRF token: ${csrfToken}`);

		return csrfToken;
	} catch (ex) {
		logError('Failed to find CSRF token.');

		if (ex?.message?.startsWith('403 HTTP Forbidden')) {
			logWarn('It looks like GoPro has detected that you are using an automated script to download your media library, and is blocking you from doing so.');
		}

		throw ex;
	}
}

// Asynchronous function to initialize the login routine
export const initLoginRoutine = async () => {
	// Prompt user for email and password if they're not set as environment variables
	logInfo('Please provide your GoPro Cloud credentials');
	console.log('   ===========================================');
	const email = process.env.GOPRO_ACCOUNT_EMAIL || await prompt('E-mail address: ');
	const password = process.env.GOPRO_ACCOUNT_PASSWORD || await prompt('Password: ', 'password');
	console.log('   ===========================================');

	// Check if email and password are provided
	if (!email || !password) {
		logError('Please provide a valid e-mail address and password.');
		process.exit(1);
	}

	// Step 1: Fetch the login page and get the CSRF token
	const csrfToken = await obtainCsrfToken();

	// Step 2: Send a login request with the email, password, and CSRF token
	logInfo('Logging in...');
	const loginResponse = await fetch(logUrl(LOGIN_URL), {
		method: 'POST',
		headers: {
			...DEFAULT_HEADERS_FOR_WEB_REQUESTS,
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
	}).then(httpCheckParse);

	// Step 3: Extract the access token from the response
	const accessToken = loginResponse?.access_token;
	logDebug(`Access token: ${accessToken}`);

	// Check if the access token is present
	if (!accessToken) {
		logError('Login failed. No access token found in response.', loginResponse);
		process.exit(2);
	}

	// If the login is successful, return the access token
	logSuccess('Login successful.');
	return accessToken;
};
