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
let lastDay = null;
let update = false;
let duplicateDetected = false;

// Utility functions
const fileExistsInDirectory = (directory, filename) => {
    if (!fs.existsSync(directory)) return null;
    return fs.readdirSync(directory).some(file => file.includes(filename));
};

const getLastDateInDirectory = (directory) => {
    if (!fs.existsSync(directory)) return null;

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
    if (duplicateDetected) return;
    if (userFolder.toLowerCase() === user.toLowerCase() && !pinned && !continueOnDuplicate) {
        if (!lastDay) lastDay = getLastDateInDirectory(path.join(__media, userFolder));
        if (lastDay) {
            const lastDateObj = new Date(lastDay);
            const createdAtDateObj = new Date(createdAtTimestamp);

            if (createdAtDateObj < lastDateObj) {
                console.log(`Files already exist for day before ${lastDay}. Exiting process.`);
                duplicateDetected = true;
            }
        }
    }
};

// Function to download media
const downloadMedia = async (url, filename, createdAtTimestamp, userFolder, pinned) => {
    try {
        shouldExitForDuplicate(createdAtTimestamp, userFolder, pinned);

        if (duplicateDetected) return;

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

        if (!fs.existsSync(userDirectory)) {
            if (userFolder.toLowerCase().includes(user.toLowerCase())) lastDay = "2006-3-21";
            fs.mkdirSync(userDirectory, { recursive: true });
        }

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
const fetchPaginatedData = async (username) => {
    duplicateDetected = false;

    let nextPageUrl = `https://api.sotwe.com/v3/user/${username}/`;
    if (startingCursor) nextPageUrl += `?after=${startingCursor}`;

    const headers = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.8",
        "priority": "u=1, i"
    };

    const userDirPath = path.join(__extra, username.toLowerCase());
    if (fs.existsSync(userDirPath)) {
        fs.renameSync(userDirPath, path.join(__media, username.toLowerCase()));
        console.log(`Moved ${username} directory from _extra to main media folder.`);
    }

    while (nextPageUrl && !duplicateDetected) {
        try {
            console.log(nextPageUrl);
            const response = await fetch(nextPageUrl, { method: "GET", headers, mode: "cors", credentials: "include" });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            await processData(data, username);

            if (duplicateDetected) break;

            const nextCursor = data.after;
            if (nextCursor) {
                nextPageUrl = `https://api.sotwe.com/v3/user/${username}/?after=${nextCursor}`;
                console.log(`Next cursor found: ${nextCursor}`);
            } else {
                nextPageUrl = null;
                console.log("No more pages to fetch for this user.");
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

// Function to process update flag
const processUpdateFlag = async () => {
    const directories = fs.readdirSync(__media, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && dirent.name !== "_extra")
        .map(dirent => dirent.name);

    for (const dir of directories) {
        user = dir;
        lastDay = null;
        console.log(`Processing user: ${dir}`);
        await fetchPaginatedData(dir);
        if (duplicateDetected) continue;
    }

    console.log(`Downloaded latest media for ${directories.join(', ')}.`)
};

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
    } else if (arg.startsWith('--update') || arg.startsWith('--upd')) {
        update = true;
    }
});

if (update) {
    await processUpdateFlag();
} else {
    if (!user) {
        console.error('A user must be provided, try: npm run start -- --user:<username>\nOptionally, you can use:\n --cursor:<cursor> - start directly at a specific cursor.\n --noextra - exclude downloading media from reposts and conversations.\n --dupe - continue downloading media even if a duplicate post is skipped.\n --update - iterates through all users who have been downloaded and pull the latest media.');
        process.exit(1);
    }

    await fetchPaginatedData(user);
}