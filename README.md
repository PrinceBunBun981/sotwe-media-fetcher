# Sotwe Media Fetcher
This script is designed to fetch media data from Sotwe's API endpoint. It downloads images and videos associated with a user's Twitter (X) account.

## Prerequisites
Before running the script make sure you have Node.js installed. You can download it [here](https://nodejs.org/)

## Installation
1. Clone the repository or download the files manually.
2. Install the dependencies using npm: `npm install`

## Usage
To run the script, use the following format:
```
npm run start -- --user:<username> [--cursor:<cursor>] [--noextra] [--dupe]
```

### Arguments
- `--user`: **Required**. Specifies the username for which data should be fetched for.
- `--cursor`: **Optional.** Provides a starting cursor for fetching data from a specific point.
- `--noextra`: **Optional.** Prevents downloading media from retweets and conversations.
- `--dupe`: **Optional.** Prevents the download from stopping when it encounters media you already have saved. 
  > Note: This is only accounted for regular posts, when encountering retweets it will continue to download until reaching a regular post from `user` with the day before the last saved date (to account for new media on the same day). If you used the `--noextra` flag initally, then decide you want to download all extra media, use the `--dupe` flag.

## Notes
- The script will download images and videos associated with the user's account.
- There is a random delay between fetches to ensure rate limits don't get hit.
- Downloaded media files are saved in the `./media/<user>` directory relative to the script's location.
- Media files from retweets and conversations will be saved in the `./media/_extra/<user>` directory.
- There may be directories made in the media folder for other users based on media found in replies.