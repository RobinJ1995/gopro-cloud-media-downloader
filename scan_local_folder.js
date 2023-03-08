import recurse from 'recurse';
import Fs from 'fs';
import Path from 'path';
import { logSuccess, logInfo, logWarn, logError, logDebug, prompt } from './logging.js';

const mediaFilter = path => path.match(/\.(mp4|jpg|jpeg)$/i);

const scandir = path => new Promise((resolve, reject) => {
	const mediaFiles = [];
	
	try {
		logInfo(`Scanning for local media: ${path}`)
		recurse(path, {writefilter: mediaFilter})
			.on('data', file => {
				logDebug(`Media file found: ${file}`);
				mediaFiles.push(file);
			})
			.on('end', () => {
				logDebug(`Local media scan finished. ${mediaFiles.length} media files found.`);
				resolve(mediaFiles);
			})
			.on('error', reject);
	} catch (ex) {
		reject(ex);
	}
});

export const initLocalFolderScanRoutine = async state => {
	let localDirToScan = process.env.SCAN_LOCAL_DIR;
	let scanLocalDir = localDirToScan ? true : null;
	while (scanLocalDir !== false && !localDirToScan) {
		const answerDoScan = await prompt('Would you like to scan a local folder for media so as to not download files from the GoPro Cloud that you already have locally? (yes/no)');
		if (String(answerDoScan).toLowerCase().trim() === 'no') {
			scanLocalDir = false;
			continue;
		} else if (String(answerDoScan).toLowerCase().trim() === 'yes') {
			scanLocalDir = true;
			const answerLocalDir = await prompt('Please enter the path to the local folder you would like to scan (or enter \'.\' for the folder you are running this application from):');
			const stat = Fs.statSync(answerLocalDir, {
				throwIfNoEntry: false
			});
			if (!stat || !stat.isDirectory()) {
				logWarn(`The path "${answerLocalDir}" does not exist, or is not a folder.`);
				continue;
			}
			
			localDirToScan = answerLocalDir;
			break;
		} else {
			logWarn('Please answer "yes" or "no".');
			continue;
		}
	}
	
	const oldState = state.local || [];
	if (!scanLocalDir) {
		return Promise.resolve(oldState);
	}
	
	return scandir(localDirToScan)
		.then(localMediaPaths => {
			const oldStateLocalMediaPaths = oldState.map(file => file.path);
			
			const localMediaPathsNotPresentInOldState = localMediaPaths.filter(path => !oldStateLocalMediaPaths.includes(path));
			const localMediaInOldStateNotPresentInNewScan = oldState.filter(file => !localMediaPaths.includes(file.path));
			const newState = oldState.map(file => {
				if (localMediaInOldStateNotPresentInNewScan.includes(file.path) && !file.disappeared_at) {
					logDebug(`${file.path} was present in last scan, but no longer exists on the local filesystem.`);
					file.disappeared_at = new Date();
				}
				
				return file;
			});
			localMediaPathsNotPresentInOldState.forEach(path => {
				logDebug(`Discovered new previously unknown local media file: ${path}`);
				newState.push({
					path,
					filename: Path.basename(path),
					discovered_at: new Date()
				});
			});
			
			logSuccess(`Found ${localMediaPathsNotPresentInOldState.length} new local media files.`);
			
			return newState;
		});
};
