const fetch = require('fetch-cookie')(require('node-fetch'));
const { checkHttpStatus, httpCheckParse, clone, pluralise, stripFields, getMediaPageUrl, getDownloadUrl } = require('./utils');
const { welcome, logSuccess, logInfo, logWarn, logError, logDebug, logUrl, prompt } = require('./logging');
const Fs = require('fs');
const Promise = require('bluebird');
const { loadState, saveState } = require('./state');
const { initLocalFolderScanRoutine } = require('./scan_local_folder');
const { initLoginRoutine } = require('./login');


const state = loadState();

welcome();

let accessToken; // Yes, I'm using a global mutable variable for this one.
const getHeaders = () => ({
	'Authorization': `Bearer ${accessToken}`,
	'Accept': 'application/vnd.gopro.jk.media+json; version=2.0.0',
	'Content-Type': 'application/json'
});

initLocalFolderScanRoutine(state) // Needs to be a mutable reference. Might change this to be nice and immutable later.
	.then(newLocalMediaState => {
		state.local = newLocalMediaState;
		saveState(state);
		
		return initLoginRoutine();
	})
	.then(token => {
		accessToken = token;
		
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
		
		const itemIds = items.map(item => item.id);
		const oldStateItemIds = state.media.map(item => item.id);
		const itemIdsPresentInOldStateButNotInNewState = oldStateItemIds.filter(
			oldItemId => !itemIds.includes(oldItemId));
		const itemIdsPresentInNewStateButNotInOldState = itemIds.filter(
			newItemId => !oldStateItemIds.includes(newItemId));
		const itemsPresentInNewStateButNotInOldState = items.filter(
			item => itemIdsPresentInNewStateButNotInOldState.includes(item.id));
		const itemIdsAlreadyDownloaded = state.media.filter(item => !!item.downloaded_at).map(item => item.id);
		const itemsThatHaveNotYetBeenDownloaded = items.filter(item => !itemIdsAlreadyDownloaded.includes(item.id));
		
		const newMediaState = state.media.map(item => {
			if (itemIdsPresentInOldStateButNotInNewState.includes(item.id) && !item.disappeared_at) {
				logWarn(`Media library item ${item.id} is present in local state, but no longer in GoPro Cloud. `
					+ `If the file has been deleted from the GoPro Cloud, then this is expected. `
					+ `Otherwise, something fishy may be up...`);
				item.disappeared_at = new Date();
			}
			
			return item;
		});
		itemsPresentInNewStateButNotInOldState.forEach(({
			                                                camera_model,
			                                                captured_at,
			                                                created_at,
			                                                gopro_user_id,
			                                                file_size,
			                                                height,
			                                                id,
			                                                item_count,
			                                                orientation,
			                                                resolution,
			                                                source_duration,
			                                                type,
			                                                width
		                                                }) =>
			newMediaState.push({
				camera_model,
				captured_at,
				created_at,
				gopro_user_id,
				file_size,
				height,
				id,
				item_count,
				orientation,
				resolution,
				source_duration,
				type,
				width,
				discovered_at: new Date()
			}));
		state.media = newMediaState;
		saveState(state);
		
		const nItemsAlreadyDownloaded = items.length - itemsThatHaveNotYetBeenDownloaded.length;
		if (nItemsAlreadyDownloaded > 0) {
			logInfo(`${nItemsAlreadyDownloaded} have already previously been downloaded, and will be skipped.`);
		}
		
		const filenamesAlreadyPresentLocally = state.local.filter(file => !file.disappeared_at)
			.map(file => file.filename);
		
		itemsThatHaveNotYetBeenDownloaded.map((item, i) => Promise.delay(i * 500).then(() => fetch(logUrl(getDownloadUrl(item)), {
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
				
				if (!filename) {
					logError(`No filename for media library item with ID ${item.id}.`, res);
					throw new Error(`No filename for media library item with ID ${item.id}.`);
				}
				
				const stateMediaItem = state.media.find(iStateMediaItem => iStateMediaItem.id === item.id);
				if (!stateMediaItem) {
					logError(`Media item ${item.id} with filename ${filename} is being processed, `
						+ 'but is not present in the application state. This is a bug.');
					throw new Error(`Media item ${item.id} with filename ${filename} is being processed, `
						+ 'but is not present in the application state.');
				}
				stateMediaItem.filename = filename;
				
				const stateLocalFile = state.local.find(iStateLocalFile => !iStateLocalFile.cloud_id && iStateLocalFile.filename === filename);
				if (stateLocalFile) {
					stateLocalFile.cloud_id = item.id;
				}
				
				saveState(state); // Yup. Relying on the reference remaining intact, here. Not ideal, I'll admit.
				
				if (filenamesAlreadyPresentLocally.includes(filename)) {
					/*
					 * This is really not the most robust check, but it will do for now.
					 * Assuming users only manage/have content from a single GoPro device, as far as I know these
					 * should not overlap.
					 */
					logInfo(`File ${filename} is already present on your machine. It will be skipped.`);
					
					stateMediaItem.downloaded_at = true;
					saveState(state);
					
					return Promise.resolve(true);
				}
				
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
						stateMediaItem.downloaded_at = new Date();
						saveState(state);
					})
					.catch(err => {
						logError(`Download of file ${filename} failed.`, err);
					});
			}));
	});
