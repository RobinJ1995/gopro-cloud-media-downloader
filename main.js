import NodeFetch from 'node-fetch';
import FetchCookie from 'fetch-cookie';
const fetch = FetchCookie(NodeFetch);

import { checkHttpStatus, httpCheckParse, pluralise, stripFields, getMediaPageUrl, getDownloadUrl, autoRetry } from './utils.js';
import { welcome, logSuccess, logInfo, logWarn, logError, logDebug, logUrl } from './logging.js';
import Fs from 'fs';
import Promise from 'bluebird';
import { loadState, saveState } from './state.js';
import { initLocalFolderScanRoutine } from './scan_local_folder.js';
import { initLoginRoutine } from './login.js';

const state = loadState();

welcome();

state.local = await initLocalFolderScanRoutine(state) // Needs to be a mutable reference. Might change this to be nice and immutable later.
saveState(state);

const accessToken = await initLoginRoutine();
const getHeaders = () => ({
	'Authorization': `Bearer ${accessToken}`,
	'Accept': 'application/vnd.gopro.jk.media+json; version=2.0.0',
	'Content-Type': 'application/json'
});

logInfo('Retrieving GoPro media library...');
const mediaLibFirstPage = await autoRetry(fetch(logUrl(getMediaPageUrl(1)), {
	headers: getHeaders()
}).then(httpCheckParse));
const {
	current_page: currentPage,
	per_page: perPage,
	total_items: totalItems,
	total_pages: totalPages
} = mediaLibFirstPage._pages;
logInfo(`Found ${totalPages} pages with ${totalItems} media items.`);

const mediaPageUrls = Array(totalPages).fill(true).map((x, pageNum) => getMediaPageUrl(pageNum));
const mediaPageRetrievalPromises = mediaPageUrls.map((url, i) => {
	logDebug(`Fetching media library page number ${i}...`);
	return autoRetry(fetch(logUrl(url), {
		headers: getHeaders()
	}).then(httpCheckParse))
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
const mediaPages = await Promise.all(mediaPageRetrievalPromises);
const cloudMediaItems = mediaPages.reduce((acc, cur) => [...cur, ...acc], []);
logInfo(`Retrieved metadata about ${cloudMediaItems.length} media library items from GoPro.`);

const itemIds = cloudMediaItems.map(item => item.id);
const oldStateItemIds = state.media.map(item => item.id);
const itemIdsPresentInOldStateButNotInNewState = oldStateItemIds.filter(
	oldItemId => !itemIds.includes(oldItemId));
const itemIdsPresentInNewStateButNotInOldState = itemIds.filter(
	newItemId => !oldStateItemIds.includes(newItemId));
const itemsPresentInNewStateButNotInOldState = cloudMediaItems.filter(
	item => itemIdsPresentInNewStateButNotInOldState.includes(item.id));
const itemIdsAlreadyDownloaded = state.media.filter(item => !!item.downloaded_at).map(item => item.id);
const itemsThatHaveNotYetBeenDownloaded = cloudMediaItems.filter(item => !itemIdsAlreadyDownloaded.includes(item.id));

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

const nItemsAlreadyDownloaded = cloudMediaItems.length - itemsThatHaveNotYetBeenDownloaded.length;
if (nItemsAlreadyDownloaded > 0) {
	logInfo(`${nItemsAlreadyDownloaded} have already previously been downloaded, and will be skipped.`);
}
const filenamesAlreadyPresentLocally = new Set(state.local.filter(file => !file.disappeared_at)
	.map(file => file.filename));

for (let i = 0; i < itemsThatHaveNotYetBeenDownloaded.length; i++) {
	const item = itemsThatHaveNotYetBeenDownloaded[i];
	
	const itemToDownload = await autoRetry(fetch(logUrl(getDownloadUrl(item)), {
		headers: getHeaders()
	}).then(httpCheckParse));
	
	const {
		filename,
		_embedded: {
			files,
			variations
		}
	} = itemToDownload;
	
	if (!filename) {
		logError(`No filename for media library item with ID ${item.id}.`, itemToDownload);
		continue;
	}
	
	// State changes start here
	let stateChanged = false;
	
	const stateMediaItem = state.media.find(iStateMediaItem => iStateMediaItem.id === item.id);
	if (!stateMediaItem) {
		logError(`Media item ${item.id} with filename ${filename} is being processed, `
			+ 'but is not present in the application state. This is a bug.');
		throw new Error(`Media item ${item.id} with filename ${filename} is being processed, `
			+ 'but is not present in the application state.');
	} else if (stateMediaItem.filename !== filename) {
		stateMediaItem.filename = filename;
		stateChanged = true;
	}
	
	const stateLocalFile = state.local.find(iStateLocalFile => !iStateLocalFile.cloud_id && iStateLocalFile.filename === filename);
	if (stateLocalFile && stateLocalFile.cloud_id !== item.id) {
		stateLocalFile.cloud_id = item.id;
		stateChanged = true;
	}
	
	if (filenamesAlreadyPresentLocally.has(filename)) {
		/*
		 * This is really not the most robust check, but it will do for now.
		 * Assuming users only manage/have content from a single GoPro device, as far as I know these
		 * should not overlap.
		 */
		logInfo(`File ${filename} is already present on your machine. It will be skipped.`);
		
		stateMediaItem.downloaded_at = true;
		saveState(state);
		
		continue;
	}
	
	// State changes end here.
	// Only writing once, and only if state changes were actually performed, as this is a blocking I/O operation.
	if (stateChanged) {
		saveState(state); // This relies on the reference remaining intact. Not ideal.
	}
	
	logDebug(`File ${filename} has ${files.length} ${pluralise('file', files)} and ${variations.length} ${pluralise('variation', variations)}.`);
	if (files.length !== 1) {
		logError(`Media item ${filename} contains ${files.length} files. This is unsupported.`);
		continue;
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
	
	const fileResponse = await autoRetry(fetch(logUrl(highestQuality.url)).then(checkHttpStatus));
	logDebug(`Download of file ${filename} started.`);
	
	const stream = Fs.createWriteStream(filename);
	await new Promise((resolve, reject) => {
		fileResponse.body.pipe(stream);
		fileResponse.body.on('error', reject);
		fileResponse.body.on('finish', resolve)
		stream.on('error', reject);
	})
	.then(() => {
		logSuccess(`Download succeeded: ${filename}`);
		stateMediaItem.downloaded_at = new Date();
		saveState(state);
	})
	.catch(err => {
		logError(`Download of file ${filename} failed.`, err);
	});
}
