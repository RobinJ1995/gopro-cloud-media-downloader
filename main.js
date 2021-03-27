const fetch = require('fetch-cookie')(require('node-fetch'));
const { checkHttpStatus, httpCheckParse, clone, pluralise, stripFields } = require('./utils');
const findCsrfToken = require('./find_cstf_token');
const { logSuccess, logInfo, logWarn, logError, logDebug, logUrl, prompt } = require('./logging');
const Fs = require('fs');
const Promise = require('bluebird');
const { loadState, saveState } = require('./state');


const LOGIN_URL = 'https://gopro.com/login';
const getMediaPageUrl = pageNum => `https://api.gopro.com/media/search?fields=camera_model,captured_at,content_title,content_type,created_at,gopro_user_id,gopro_media,file_size,height,fov,id,item_count,moments_count,on_public_profile,orientation,play_as,ready_to_edit,ready_to_view,resolution,source_duration,token,type,width&processing_states=pretranscoding,transcoding,failure,ready&order_by=captured_at&per_page=100&page=${pageNum}`;
const getDownloadUrl = item => `https://api.gopro.com/media/${item.id}/download`;


const state = loadState();
const runState = {
	started: new Date()
};
state.runs = [
	...state.runs,
	runState
];

logInfo('Please provide your GoPro Cloud credentials');
console.log('   ===========================================');
const email = process.env.GOPRO_ACCOUNT_EMAIL || prompt('E-mail address: ');
const password = process.env.GOPRO_ACCOUNT_PASSWORD || prompt('Password: ');
console.log('   ===========================================');

if (!email || !password) {
	logError('Please provide a valid e-mail address and password.');
	process.exit(1);
}

let accessToken; // Yes, I'm using a global mutable variable for this one.
const getHeaders = () => ({
	'Authorization': `Bearer ${accessToken}`,
	'Accept': 'application/vnd.gopro.jk.media+json; version=2.0.0',
	'Content-Type': 'application/json'
});

logInfo('Finding CSRF token...');
fetch(logUrl(LOGIN_URL))
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
				finterprint: '',
				brand: ''
			})
		});
	})
	.then(httpCheckParse)
	.then(res => {
		accessToken = res?.access_token;
		logDebug(`Access token: ${accessToken}`);
		if (!accessToken) {
			logError('Login failed. No access token found in response.', res);
			process.exit(2);
		}
		
		logSuccess('Login successful.');
		
		logInfo('Retrieving GoPro media library...');
		return fetch(logUrl(getMediaPageUrl(1)), {
			headers: getHeaders()
		})
	})
	.then(httpCheckParse)
	.then(res => {
		const {
			current_page: currentPage,
			per_page: perPage,
			total_items: totalItems,
			total_pages: totalPages
		} = res._pages;
		
		logInfo(`Found ${totalPages} pages with ${totalItems} media items.`);
		
		const mediaPageUrls = Array(totalPages).fill(true).map((x, pageNum) => getMediaPageUrl(pageNum));
		const promises = mediaPageUrls.map((url, i) => {
			logDebug(`Fetching media library page number ${i}...`);
			return fetch(logUrl(url), {
				headers: getHeaders()
			})
				.then(httpCheckParse)
				.then(r => {
					const media = r._embedded.media;
					const errors = r._embedded.errors;
					
					if ((errors || []).length) {
						logError(errors);
						throw new Error(errors);
					}
					
					logDebug(`Retrieved media library page number ${i} with ${media.length} items.`);
					return media;
				})
		});
		return Promise.all(promises);
	})
	.then(pages => pages.reduce((acc, cur) => [...cur, ...acc], []))
	.then(items => {
		logInfo(`Retrieved metadata about ${items.length} media library items from GoPro.`);
		
		runState.media = items;
		saveState(state);
		
		items.map((item, i) => Promise.delay(i * 500).then(() => fetch(logUrl(getDownloadUrl(item)), {
			headers: getHeaders()
		}))
			.then(httpCheckParse)
			.then(res => {
				const {
					filename,
					_embedded: {
						files,
						variations
					}
				} = res;
				
				logDebug(`File ${filename} has ${files.length} ${pluralise('file', files)} and ${variations.length} ${pluralise('variation', variations)}.`);
				if (files.length !== 1) {
					logError(`Media item ${filename} contains ${files.length} files. This is unsupported.`);
					throw new Error(`Media item ${filename} contains ${files.length} files. This is unsupported.`);
				}
				
				let highestQuality = files[0];
				for (let i = 0; i < variations.length; i++) {
					const variation = variations[0];
					
					if (variation?.label === 'source') {
						logDebug(`Variation ${i} has "source" label. Marking as highest quality file.`);
						highestQuality = variation;
						break;
					} else if (variation?.width > highestQuality?.width) {
						logDebug(`Variation ${i} has higher width (${variation?.width}) than currently selected (${highestQuality?.width}).`);
						highestQuality = variation;
					}
				}
				logDebug(`Highest quality file for ${filename} detected.`,
					stripFields(highestQuality, ['url', 'head']));
				
				logInfo(`Downloading file: ${filename}`);
				return fetch(logUrl(highestQuality.url))
					.then(checkHttpStatus)
					.then(fileResponse => {
						logDebug(`Download of file ${filename} started.`);
						
						const stream = Fs.createWriteStream(filename);
						return new Promise((resolve, reject) => {
							fileResponse.body.pipe(stream);
							fileResponse.body.on('error', reject);
							fileResponse.body.on('finish', resolve)
							stream.on('error', reject);
						});
					})
					.then(() => {
						logSuccess(`Download succeeded: ${filename}`);
					})
					.catch(err => {
						logError(`Download of file ${filename} failed.`, err);
					});
			}));
	});
