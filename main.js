import NodeFetch from 'node-fetch';
import NodeFetchProgress from 'node-fetch-progress';
import FetchCookie from 'fetch-cookie';
const fetch = FetchCookie(NodeFetch);

import { checkHttpStatus, httpCheckParse, pluralise, stripFields, getMediaPageUrl, getDownloadUrl, autoRetry, DEFAULT_HEADERS } from './utils.js';
import { welcome, logSuccess, logInfo, logWarn, logError, logDebug, logUrl, prompt, promptYesOrNo } from './logging.js';
import Fs from 'fs';
import Path from 'path';
import Promise from 'bluebird';
import { loadState, saveState } from './state.js';
import { initLocalFolderScanRoutine } from './scan_local_folder.js';
import { initLoginRoutine } from './login.js';

const state = loadState();

const ARGS = process.argv.slice(2).map(x => String(x).toLowerCase().trim());
const DRY_RUN = ARGS.includes('--dry-run');
welcome();
if (DRY_RUN) {
	logInfo('--dry-run supplied. No items will actually be downloaded.');
}

state.local = await initLocalFolderScanRoutine(state); // Needs to be a mutable reference. Might change this to be nice and immutable later.
saveState(state);

const accessToken = await initLoginRoutine();
const getHeaders = () => ({
	...DEFAULT_HEADERS,
	'Authorization': `Bearer ${accessToken}`,
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
const fetchMediaLibraryPage = async (url, i) => {
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
	});
};
const mediaPageRetrievalPromises = mediaPageUrls.map((url, i) => fetchMediaLibraryPage(url, i));
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
const itemIdsToBeRedownloaded = new Set(ARGS.includes('--redownload')
	? state.media.filter(item => !!item.redownload_requested_at).map(item => item.id)
	: []);

const itemsAvailableForDownload = cloudMediaItems.filter(
	item => !itemIdsAlreadyDownloaded.includes(item.id) || itemIdsToBeRedownloaded.has(item.id));

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
const fileIdsAlreadyPresentLocally = new Set(state.local.filter(file => !file.disappeared_at)
	.map(file => file.id));

logInfo(`State of GoPro media library indexed. Contains ${state?.media?.length} items.`);
const downloadItemsAfterDateStr = process.env.DOWNLOAD_FILES_CAPTURED_AFTER_DATE ?? await prompt('Enter the date from after which you would like to download items, or leave empty to download all items.', 'date', { mask: 'YYYY-MM-DD'});
let itemsToDownload = null;
if (!String(downloadItemsAfterDateStr).trim()) {
	if (!await promptYesOrNo('No date supplied. All items will be downloaded. Correct?')) {
		logInfo('Operation aborted.');
		process.exit(0);
	}

	itemsToDownload = [...itemsAvailableForDownload];
} else {
	const downloadItemsAfterDate = new Date(downloadItemsAfterDateStr);
	if (!await promptYesOrNo(`Items with a capture date after (and including) ${downloadItemsAfterDate.toDateString()} will be downloaded. Correct?`)) {
		logInfo('Operation aborted.');
		process.exit(0);
	}

	itemsToDownload = itemsAvailableForDownload.filter(item => downloadItemsAfterDate <= new Date(item.captured_at));
	logInfo(`Out of ${itemsAvailableForDownload.length} items available for download, ${itemsToDownload.length} were captured after ${downloadItemsAfterDate.toDateString()}.`);
}

for (let i = 0; i < itemsToDownload.length; i++) {
	const item = itemsToDownload[i];
	let stateChanged = false;
	
	const stateMediaItem = state.media.find(iStateMediaItem => iStateMediaItem.id === item.id);
	if (!stateMediaItem) {
		logError(`Media item ${item.id} with filename ${item.filename} is being processed, `
			+ 'but is not present in the application state. This is a bug.');
		throw new Error(`Media item ${item.id} with filename ${item.filename} is being processed, `
			+ 'but is not present in the application state.');
	}

	let itemToDownload = null;
	try {
		itemToDownload = await autoRetry(fetch(logUrl(getDownloadUrl(item)), {
			headers: getHeaders()
		}).then(httpCheckParse));
	} catch (ex) {
		logError(`Failed to download item ${item.id}. ${ex}`);
		stateMediaItem.download_failed_at = new Date();
		stateChanged = true;
		continue;
	}
	
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

	const {
		ext: fileExtension,
		name: filenameWithoutExtension
	 } = Path.parse(filename);
	const targetFilename = [filenameWithoutExtension, item?.camera_model?.replace(/[^a-z0-9]/ig, ''), item?.id]
		.filter(x => !!x)
		.join('_') + fileExtension;
	
	const localStat = Fs.statSync(targetFilename, { throwIfNoEntry: false });
	if (localStat) {
		// File already exists locally.
		if (!itemIdsToBeRedownloaded.has(item.id)) {
			logError(`File ${targetFilename} already exists locally. It will be skipped.`);
			continue;
		}
		
		// It's grand. File is queued to be re-downloaded.
		logInfo(`File ${targetFilename} already exists, but is queued for re-download. Deleting current on-disk copy...`);
		if (DRY_RUN) {
			logInfo(`Except we're doing a dry run, so... not doing that :)`);
		} else {
			Fs.unlinkSync(targetFilename);
		}
	}
	
	if (stateMediaItem?.target_filename !== targetFilename) {
		stateMediaItem.target_filename = targetFilename;
		stateChanged = true;
	}
	if (stateMediaItem.filename !== filename) {
		stateMediaItem.filename = filename;
		stateChanged = true;
	}
	
	const stateLocalFile = state.local.find(iStateLocalFile => !iStateLocalFile.cloud_id && iStateLocalFile.filename === filename);
	if (stateLocalFile && stateLocalFile.cloud_id !== item.id) {
		stateLocalFile.cloud_id = item.id;
		stateChanged = true;
	}
	
	if (fileIdsAlreadyPresentLocally.has(item.id)) {
		logInfo(`File ${targetFilename} is already present on your machine. It will be skipped.`);
		
		stateMediaItem.downloaded_at = true;
		saveState(state);
		
		continue;
	}
	
	// State changes end here.
	// Only writing once, and only if state changes were actually performed, as this is a blocking I/O operation.
	if (stateChanged) {
		saveState(state); // This relies on the reference remaining intact. Not ideal.
	}
	
	logDebug(`File ${targetFilename} has ${files.length} ${pluralise('file', files)} and ${variations.length} ${pluralise('variation', variations)}.`);
	if (files.length !== 1) {
		logError(`Media item ${targetFilename} contains ${files.length} files. This is unsupported.`);
		continue;
	}
	
	let highestQuality = files[0];
	for (let i = 0; i < variations.length; i++) {
		const variation = variations[i];
		
		if (variation?.label === 'source') {
			logDebug(`Variation ${i} has "source" label. Marking as highest quality file.`);
			highestQuality = variation;
			break;
		} else if (variation?.width > highestQuality?.width) {
			logDebug(`Variation ${i} has higher width (${variation?.width}) than currently selected (${highestQuality?.width}).`);
			highestQuality = variation;
		}
	}
	logDebug(`Highest quality file for ${targetFilename} detected.`,
		stripFields(highestQuality, ['url', 'head']));
	
	if (DRY_RUN) {
		logInfo(`Dry run. Skipping download of file ${targetFilename}`);
		continue;
	}
	logInfo(`Downloading file: ${targetFilename}`);
	const fileResponse = await autoRetry(fetch(logUrl(highestQuality.url)).then(checkHttpStatus));
	const downloadProgress = new NodeFetchProgress(fileResponse, { throttle: 2500 });
	downloadProgress.on('progress', p => console.log(`🧮 ${i}/${itemsToDownload.length} 🌐 ${targetFilename} 📁 ${p.doneh}/${p.totalh} ⏬ ${p.rateh}`));
	logDebug(`Download of file ${targetFilename} started.`);
	
	const stream = Fs.createWriteStream(targetFilename);
	await new Promise((resolve, reject) => {
		fileResponse.body.pipe(stream);
		fileResponse.body.on('error', reject);
		fileResponse.body.on('finish', resolve)
		stream.on('error', reject);
	})
	.then(() => {
		logSuccess(`Download succeeded: ${targetFilename}`);
		stateMediaItem.downloaded_at = new Date();
		if (!!stateMediaItem.redownload_requested_at) {
			stateMediaItem.redownload_requested_at = null;
		}
		saveState(state);
	})
	.catch(err => {
		logError(`Download of file ${targetFilename} failed.`, err);
		stateMediaItem.download_failed_at = new Date();
		saveState(state);
	});
}

let stateChangedInPostDownloadFileSizeCheck = false;
for (let i = 0; i < state.media.length; i++) {
	const mediaStateItem = state.media[i];
	
	if (!mediaStateItem.target_filename) {
		// Can't find a thing with no filename.
		continue;
	} else if (!!mediaStateItem.disappeared_at) {
		// File no longer present in GoPro Cloud.
		continue;
	}
	
	const stat = Fs.statSync(mediaStateItem.target_filename, { throwIfNoEntry: false });
	if (!stat) {
		// File has since been moved out of the current working directory.
		continue;
	} else if (mediaStateItem.file_size !== stat.size) {
		const onDiskMib = (stat.size / 1024.0 / 1024.0).toFixed(2);
		const inCloudMib = (mediaStateItem.file_size / 1024.0 / 1024.0).toFixed(2);
		logWarn(`GoPro Cloud reports size of ${inCloudMib}MiB for ${mediaStateItem.target_filename}, but file on disk is ${onDiskMib}MiB. Run the application with --redownload command line flag to re-download it.`);
		mediaStateItem.redownload_requested_at = new Date();
		stateChangedInPostDownloadFileSizeCheck = true;
	}
}
if (stateChangedInPostDownloadFileSizeCheck) {
	saveState(state);
}

const nItemsQueuedForRedownload = state.media.filter(item => !!item.redownload_requested_at && !item.disappeared_at).length;
if (nItemsQueuedForRedownload > 0) {
	logInfo(`${nItemsQueuedForRedownload} items are queued to be re-downloaded because their size on disk is different from what the GoPro Cloud reports. Run the application with --redownload command line flag to delete your local copies (which are likely corrupted) and re-download them from the GoPro Cloud.`);
}

