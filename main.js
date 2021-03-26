const prompt = require('prompt-sync')();
const fetch = require('fetch-cookie')(require('node-fetch'));
const { checkHttpStatus, httpCheckParse } = require('./utils');
const findCsrfToken = require('./find_cstf_token');
const { logInfo, logWarn, logError, logDebug } = require('./logging');
const Fs = require('fs');
const Promise = require('bluebird');


const LOGIN_URL = 'https://gopro.com/login';
const getMediaPageUrl = pageNum => `https://api.gopro.com/media/search?fields=camera_model,captured_at,content_title,content_type,created_at,gopro_user_id,gopro_media,file_size,height,fov,id,item_count,moments_count,on_public_profile,orientation,play_as,ready_to_edit,ready_to_view,resolution,source_duration,token,type,width&processing_states=pretranscoding,transcoding,failure,ready&order_by=captured_at&per_page=100&page=${pageNum}`;
const getDownloadUrl = item => `https://api.gopro.com/media/${item.id}/download`;


logInfo('Please provide your GoPro Cloud credentials');
console.log('  ===========================================');
const email = process.env.GOPRO_ACCOUNT_EMAIL || prompt('❓ E-mail address: ');
const password = process.env.GOPRO_ACCOUNT_PASSWORD || prompt('❓ Password: ');
console.log('  ===========================================');

if (!email || !password) {
	logError('Please provide a valid e-mail address and password.');
	process.exit(1);
}

let accessToken; // Yes, I'm using a global mutable variable for this one.

logInfo('Finding CSRF token...');
fetch(LOGIN_URL)
	.then(checkHttpStatus)
	.then(r => r.text())
	.then(findCsrfToken)
	.then(csrfToken => {
		logDebug(`CSRF token: ${csrfToken}`);
		logInfo('Logging in...');
		return fetch(LOGIN_URL, {
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
			exit(2);
		}
		
		logInfo('Retrieving GoPro media library...');
		return fetch(getMediaPageUrl(1), {
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'Accept': 'application/vnd.gopro.jk.media+json; version=2.0.0'
			}
		})
	})
	.then(httpCheckParse)
	.then(res => {
		const currentPage = res._pages.current_page;
		const perPage = res._pages.per_page;
		const totalItems = res._pages.total_items;
		const totalPages = res._pages.total_pages;
		
		logInfo(`Found ${totalPages} pages with ${totalItems} media items.`);
		
		const mediaUrls = Array(totalPages).fill(true).map((x, pageNum) => getMediaPageUrl(pageNum));
		const promises = mediaUrls.map((url, i) => {
			logDebug(`Fetching media library page number ${i}...`);
			return fetch(url, {
				headers: {
					'Authorization': `Bearer ${accessToken}`,
					'Accept': 'application/vnd.gopro.jk.media+json; version=2.0.0'
				}
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
		
		items.map((item, i) => Promise.delay(i * 500).then(() => fetch(getDownloadUrl(item)))
			.then(httpCheckParse)
			.then(r => {
				const filename = r.filename;
				const files = r._embedded.files;
				
				if (files.length > 1) {
					logError(`Media item contains ${files.length} files. This is unsupported.`);
					throw new Error(`Media item contains ${files.length} files. This is unsupported.`);
				}
				
				logInfo(`Downloading file: ${filename}`);
				const stream = Fs.createWriteStream(filename);
				return new Promise((resolve, reject) => {
					res.body.pipe(stream);
					res.body.on('error', reject);
					res.body.on('finish', resolve)
				});
			}));
	});
