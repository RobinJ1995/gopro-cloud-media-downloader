# GoPro Cloud Media Downloader

A Node.js command line tool to bulk download media files from the GoPro Cloud.

When you run the application, you will be asked for the username and password
to your GoPro account, and a folder where you keep your local media files.

Your local media will be scanned, and a listing of all the media in your GoPro
Cloud account will be retrieved. All media files in your GoPro Cloud that were
not found locally (or all of them, if you did not enter a local folder) will
then be downloaded to the current working directory.

Once a file has been downloaded, it can safely be moved, even outside the local
media folder you have entered, so long as the application's `state.json` is kept
around and present whenever you run this application. Once a file has been
downloaded, it will be marked as such in the application's `state.json` file,
and it will not be downloaded again.

## Automation/non-interactive mode

If you wish to run this application as a cron job or something similar, without
requiring user interaction, you may set the following environment variables;

- `GOPRO_ACCOUNT_EMAIL` for your GoPro account e-mail address
- `GOPRO_ACCOUNT_PASSWORD` for your GoPro account password
- `SCAN_LOCAL_DIR` for the folder where you keep your local media files

If all of the above are set, no user input will be requested.

Example: `GOPRO_ACCOUNT_EMAIL=me@example.org GOPRO_ACCOUNT_PASSWORD=super_secret SCAN_LOCAL_DIR=/home/robin/Pictures node main.js`

In this manner, it is possible to set up an automated task to periodically
download all new media files from your GoPro Cloud media library to your
local machine.


## What works
- [X] Login
- [X] Metadata retrieval
- [X] Downloading files

## What does not yet work
- [X] Some form of selectively downloading files, outside of the current check whether the file already exists locally (or was downloaded previously). (Script will ask for a date, only files captured after this date will be downloaded.)
- [ ] Resume on failure or when cancelled
- [X] Retry on failure (works on API calls, not yet on actual downloads)

## Known issues
- [ ] Does not work if your GoPro account has 2 factor authentication enabled.

# Options

- `--redownload`: Re-download files for which a re-download was requested after a previous run.
- `--dry-run`: Do not actually download/delete files.

