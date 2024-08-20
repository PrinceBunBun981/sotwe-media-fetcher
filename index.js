import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

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
const fileExistsInDirectory = (directory, filename) => fs.existsSync(directory) && fs.readdirSync(directory).some(file => file.includes(filename));

const filesAreInDirectory = (directory) => fs.readdirSync(directory).length > 0;

const getLastDateInDirectory = (directory) => {
    if (!fs.existsSync(directory)) return null;
    const dates = [...new Set(
        fs.readdirSync(directory)
            .map(file => file.split('_')[0])
            .filter(datePart => !isNaN(new Date(datePart).getTime()))
    )];
    return dates.sort((a, b) => new Date(b) - new Date(a))[0] || null;
};

const saveBufferToFile = (filePath, buffer) => fs.writeFileSync(filePath, buffer);

const getFormattedDate = (timestamp) => new Date(timestamp).toISOString().split('T')[0];

const sleep = (ms) => {
    console.log(`Waiting ${ms} milliseconds before next request...`)
    return new Promise(resolve => setTimeout(resolve, ms));
}

const getRandomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const shouldExitForDuplicate = (createdAtTimestamp, userFolder, pinned) => {
    if (duplicateDetected || pinned || continueOnDuplicate || userFolder.toLowerCase() !== user.toLowerCase()) return;
    if (!lastDay) lastDay = getLastDateInDirectory(path.join(__media, userFolder));
    if (lastDay && new Date(createdAtTimestamp) < new Date(lastDay)) {
        console.log(`Files already exist for day before ${lastDay}. Exiting process.`);
        duplicateDetected = true;
    }
};

// Function to download media
const downloadMedia = async (url, filename, createdAtTimestamp, userFolder, pinned) => {
    shouldExitForDuplicate(createdAtTimestamp, userFolder, pinned);
    if (duplicateDetected) return;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch media: ${response.statusText}`);
        
        const buffer = Buffer.from(await response.arrayBuffer());
        const finalFilename = `${getFormattedDate(createdAtTimestamp)}_${filename}`;
        const userDirectory = path.join(__media, userFolder);

        if (noExtra && !userFolder.toLowerCase().includes(user.toLowerCase())) {
            console.log(`Skipped extra download for ${userFolder}: ${finalFilename}`);
            return;
        }

        if (!fs.existsSync(userDirectory) || !filesAreInDirectory(userDirectory)) {
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
        const { videoInfo, mediaURL, expandedURL } = media;
        let url = null;

        if (videoInfo?.variants) {
            url = videoInfo.variants.reduce((prev, curr) => (prev.bitrate > curr.bitrate ? prev : curr)).url;
        } else if (mediaURL) {
            url = mediaURL;
        }

        if (url) {
            const filename = path.basename(new URL(url).pathname);
            if (noExtra && !expandedURL.toLowerCase().includes(user.toLowerCase())) {
                console.info(`Skipped extra download for ${userFolder}: ${filename}`);
                continue;
            }
            await downloadMedia(url, filename, createdAtTimestamp, userFolder, pinned);
        }
    }
};

// Function to process paginated data
const processData = async (data, username) => {
    if (!Array.isArray(data.data)) return;

    for (const item of data.data) {
        const userFolder = item.retweetedStatus && item.retweetedStatus.user.screenName.toLowerCase() !== username.toLowerCase()
            ? path.join('_extra', item.retweetedStatus.user.screenName.toLowerCase())
            : username.toLowerCase();

        await processMediaEntities(item.mediaEntities, item.createdAt, userFolder, item.pinned);

        for (const convoItem of item.conversation || []) {
            const convoUserFolder = convoItem.user?.screenName.toLowerCase() === username.toLowerCase()
                ? username.toLowerCase()
                : path.join('_extra', convoItem.user.screenName.toLowerCase());

            await processMediaEntities(convoItem.mediaEntities, convoItem.createdAt, convoUserFolder, item.pinned);
        }
    }
};

// Main function to fetch paginated data
const fetchPaginatedData = async (username) => {
    duplicateDetected = false;

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    let nextPageUrl = `https://api.sotwe.com/v3/user/${username}/`;
    if (startingCursor) nextPageUrl += `?after=${startingCursor}`;

    const userDirPath = path.join(__extra, username.toLowerCase());
    if (fs.existsSync(userDirPath)) {
        fs.renameSync(userDirPath, path.join(__media, username.toLowerCase()));
        console.log(`Moved ${username} directory from _extra to main media folder.`);
    }

    while (nextPageUrl && !duplicateDetected) {
        try {
            console.log(nextPageUrl);
            await page.goto(nextPageUrl, { waitUntil: 'networkidle2' });

            const data = await page.evaluate(() => {
                const responseElement = document.querySelector('pre');
                return responseElement ? JSON.parse(responseElement.textContent) : null;
            });

            if (!data) throw new Error('No data found on page.');

            await processData(data, username);

            if (duplicateDetected) break;

            const nextCursor = data.after;
            nextPageUrl = nextCursor ? `https://api.sotwe.com/v3/user/${username}/?after=${nextCursor}` : null;
            if (nextCursor) {
                console.log(`Next cursor found: ${nextCursor}`);
                await sleep(getRandomDelay(3000, 7000));
            } else {
                console.log(`No more media to fetch for ${username}.`);
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            nextPageUrl = null;
        }
    }

    await browser.close();
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
        await sleep(getRandomDelay(3000, 7000));
    }

    console.log(`Downloaded latest media for ${directories.join(', ')}.`);
};

// Parse command line arguments
const args = process.argv.slice(2);
args.forEach(arg => {
    const [key, value] = arg.split(':');
    switch (key) {
        case '--user':
        case '--u':
            user = value;
            break;
        case '--cursor':
        case '--c':
            startingCursor = value;
            break;
        case '--noextra':
        case '--ne':
            noExtra = true;
            break;
        case '--dupe':
        case '--d':
            continueOnDuplicate = true;
            break;
        case '--update':
        case '--upd':
            update = true;
            break;
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
