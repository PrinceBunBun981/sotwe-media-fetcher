import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const __media = path.join(__dirname, 'media');
const __extra = path.join(__media, "_extra");

let user = null;
let startingCursor = null;
let noExtra = false;
let continueOnDuplicate = false;

// Utility functions
const createDirectoryIfNotExists = (directory) => {
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }
};

const fileExistsInDirectory = (directory, filename) => {
    return fs.readdirSync(directory).some(file => file.includes(filename));
};

const getLastDateInDirectory = (directory) => {
    const files = fs.readdirSync(directory);
    const dateStrings = files
        .map(file => {
            const [datePart] = file.split('_');
            return datePart;
        })
        .filter(datePart => !isNaN(new Date(datePart).getTime()));

    const uniqueDates = Array.from(new Set(dateStrings)).sort((a, b) => new Date(b) - new Date(a));
    if (uniqueDates.length < 2) return null;

    return uniqueDates[0];
};

const saveBufferToFile = (filePath, buffer) => {
    fs.writeFileSync(filePath, buffer);
};

const getFormattedDate = (timestamp) => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const getRandomDelay = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

const shouldExitForDuplicate = (createdAtTimestamp, userFolder, pinned) => {
    if (userFolder.toLowerCase() === user.toLowerCase() && !pinned && !continueOnDuplicate) {
        const lastDate = getLastDateInDirectory(path.join(__media, userFolder));
        if (lastDate) {
            const lastDateObj = new Date(lastDate);
            const createdAtDateObj = new Date(createdAtTimestamp);

            if (createdAtDateObj < lastDateObj) {
                console.log(`Files already exist for day before ${lastDate}. Exiting process.`);
                process.exit(0);
            }
        }
    }
}

// Function to download media
const downloadMedia = async (url, filename, createdAtTimestamp, userFolder, pinned) => {
    try {
        shouldExitForDuplicate(createdAtTimestamp, userFolder, pinned);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch media: ${response.statusText}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const dateString = getFormattedDate(createdAtTimestamp);
        const finalFilename = `${dateString}_${filename}`;
        const userDirectory = path.join(__media, userFolder);

		if (noExtra && !userFolder.toLowerCase().includes(user.toLowerCase())) {
			return console.log(`Skipped extra download for ${userFolder}: ${finalFilename}`);
		}

        createDirectoryIfNotExists(userDirectory);
        if (!fileExistsInDirectory(userDirectory, filename)) {
            saveBufferToFile(path.join(userDirectory, finalFilename), buffer);
            console.log(`Downloaded media for ${userFolder}: ${finalFilename}`);
        } else {
            console.log(`Skipped duplicate download for ${userFolder}: ${finalFilename}`);
        }
    } catch (error) {
        console.error(`Error downloading media ${filename} for ${userFolder}:`, error);
    }
};

// Function to process individual media entities
const processMediaEntities = async (mediaEntities, createdAtTimestamp, userFolder, pinned) => {
    if (!Array.isArray(mediaEntities)) return;

    for (const media of mediaEntities) {
        const { videoInfo, mediaURL, imageSize } = media;
        let url;

        if (videoInfo && Array.isArray(videoInfo.variants)) {
            const highestBitrateVariant = videoInfo.variants.reduce((prev, current) => (prev.bitrate > current.bitrate ? prev : current));
            url = highestBitrateVariant.url;
        } else if (imageSize && mediaURL) {
            url = mediaURL;
        }

        if (url) {
            const filename = path.basename(new URL(url).pathname);
            await downloadMedia(url, filename, createdAtTimestamp, userFolder, pinned);
        }
    }
};

// Function to process paginated data
const processData = async (data, user) => {
    if (Array.isArray(data.data)) {
        for (const item of data.data) {
            const userFolder = item.retweetedStatus && item.retweetedStatus.user.screenName.toLowerCase() != user.toLowerCase()
                ? path.join('_extra', item.retweetedStatus.user.screenName.toLowerCase())
                : user.toLowerCase();

            await processMediaEntities(item.mediaEntities, item.createdAt, userFolder, item.pinned);

            if (Array.isArray(item.conversation)) {
                for (const convoItem of item.conversation) {
                    const convoUserFolder = convoItem.user && convoItem.user.screenName.toLowerCase() == user.toLowerCase()
                        ? user.toLowerCase()
                        : path.join('_extra', convoItem.user.screenName.toLowerCase());

                    await processMediaEntities(convoItem.mediaEntities, convoItem.createdAt, convoUserFolder, item.pinned);
                }
            }
        }
    }
};

// Main function to fetch paginated data
const fetchPaginatedData = async () => {
    const args = process.argv.slice(2);
    args.forEach(arg => {
        if (arg.startsWith('--user:') || arg.startsWith('--u:')) {
            user = arg.split(':')[1];
        } else if (arg.startsWith('--cursor:') || arg.startsWith('--c:')) {
            startingCursor = arg.split(':')[1];
        } else if (arg.startsWith('--noextra') || arg.startsWith('--ne')) {
            noExtra = true;
        } else if (arg.startsWith('--dupe') || arg.startsWith('--d')) {
            continueOnDuplicate = true;
        }
    });

	if (!user) {
        return console.error('A user must be provided, try: npm run start -- --user:<username>\nOptionally, you can use:\n --cursor:<cursor> - start directly at a specific cursor.\n --noextra - exclude downloading media from reposts and conversations.');
    }

    let nextPageUrl = `https://api.sotwe.com/v3/user/${user}/`;
    if (startingCursor) nextPageUrl += `?after=${startingCursor}`;

    const headers = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.8",
        "priority": "u=1, i"
    };

    const userDirPath = path.join(__extra, user.toLowerCase());
    if (fs.existsSync(userDirPath)) {
        fs.renameSync(userDirPath, path.join(__media, user.toLowerCase()));
        console.log(`Moved ${user} directory from _extra to main media folder.`);
    }

    while (nextPageUrl) {
        try {
            console.log(nextPageUrl);
            const response = await fetch(nextPageUrl, { method: "GET", headers, mode: "cors", credentials: "include" });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            await processData(data, user);

            const nextCursor = data.after;
            if (nextCursor) {
                nextPageUrl = `https://api.sotwe.com/v3/user/${user}/?after=${nextCursor}`;
                console.log(`Next cursor found: ${nextCursor}`);
            } else {
                nextPageUrl = null;
                console.log("No more pages to fetch, exiting.");
                process.exit(0);
            }

            const delay = getRandomDelay(3000, 7000);
            console.log(`Waiting for ${delay} milliseconds before next request...`);
            await sleep(delay);
        } catch (error) {
            console.error('Error fetching data:', error);
            nextPageUrl = null;
        }
    }
};

// Start fetching data
fetchPaginatedData();