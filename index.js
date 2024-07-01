import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const __media = path.join(__dirname, 'media');
const __conversations = path.join(__media, "_conversations");

// Function to download media
async function downloadMedia(url, filename, createdAtTimestamp, userFolder) {
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const date = new Date(createdAtTimestamp);
        const dateString = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
        const finalFilename = `${dateString}_${filename}`;
        const userDirectory = path.join(__media, userFolder);

        if (!fs.existsSync(userDirectory)) fs.mkdirSync(userDirectory, { recursive: true });
        if (!fs.readdirSync(userDirectory).some(file => file.includes(filename))) {
            fs.writeFileSync(path.join(userDirectory, finalFilename), buffer);
            console.log(`Downloaded media for ${userFolder}: ${finalFilename}`);
        } else {
            console.log(`Skipped download for ${userFolder}: ${finalFilename}`);
        }
    } catch (error) {
        console.error(`Error downloading media ${filename} for ${userFolder}:`, error);
    }
}

// Function to introduce delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to get random delay
function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Main function to fetch paginated data
async function fetchPaginatedData() {
    const args = process.argv.slice(2);
    let user = null;
    let startingCursor = null;

    // Parse arguments
    args.forEach(arg => {
        if (arg.startsWith('--user:') || arg.startsWith('--u:')) {
            user = arg.split(':')[1];
        } else if (arg.startsWith('--cursor:') || arg.startsWith('--c:')) {
            startingCursor = arg.split(':')[1];
        }
    });

    if (!user) return console.error('A user must be provided, try: npm run start -- --user:<username>\nOptionally, add --cursor:<cursor> if you want to start directly at a specific cursor.');

    let nextPageUrl = `https://api.sotwe.com/v3/user/${user}/`;
    if (startingCursor) nextPageUrl += `?after=${startingCursor}`;

    const headers = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.8",
        "priority": "u=1, i"
    };

    if (fs.existsSync(path.join(__conversations, user.toLowerCase()))) {
        fs.renameSync(path.join(__conversations, user.toLowerCase()), path.join(__media, user.toLowerCase()));
        console.log(`Moved ${user} directory from _conversations to main media folder.`);
    }

    while (nextPageUrl) {
        console.log(nextPageUrl);
        try {
            const response = await fetch(nextPageUrl, {
                method: "GET",
                headers: headers,
                referrer: "https://www.sotwe.com/",
                referrerPolicy: "strict-origin-when-cross-origin",
                mode: "cors",
                credentials: "include",
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Process main data
            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
                for (let item of data.data) {
                    if (item.retweetedStatus && item.retweetedStatus.user.screenName.toLowerCase() != user.toLowerCase()) {
                        await processMediaEntities(item.mediaEntities, item.createdAt, path.join('_conversations', item.retweetedStatus.user.screenName.toLowerCase()));
                    } else {
                        await processMediaEntities(item.mediaEntities, item.createdAt, user.toLowerCase());
                    }

                    if (item.conversation && Array.isArray(item.conversation)) {
                        for (let convoItem of item.conversation) {
                            if (convoItem.user && convoItem.user.screenName) {
                                const convoUserFolder = convoItem.user.screenName.toLowerCase() == user.toLowerCase() ? user.toLowerCase() : path.join('_conversations', convoItem.user.screenName.toLowerCase());
                                await processMediaEntities(convoItem.mediaEntities, convoItem.createdAt, convoUserFolder);
                            }
                        }
                    }
                }
            }

            const nextCursor = data.after;
            if (nextCursor) {
                nextPageUrl = `https://api.sotwe.com/v3/user/${user}/?after=${nextCursor}`;
                console.log(`Next cursor found.`, nextCursor);
            } else {
                nextPageUrl = null;
                console.log("Next cursor wasn't found, exisitng.");
                process.exit(0);
            }

            // Introduce a random delay between requests
            const delay = getRandomDelay(3000, 7000); // 3 to 7 seconds
            console.log(`Waiting for ${delay} milliseconds before next request...`);
            await sleep(delay);
        } catch (error) {
            console.error('Error fetching data:', error);
            nextPageUrl = null;
        }
    }
}

// Function to process media entities
async function processMediaEntities(mediaEntities, createdAtTimestamp, userFolder) {
    if (mediaEntities && Array.isArray(mediaEntities)) {
        for (let media of mediaEntities) {
            if (media.videoInfo && media.videoInfo.variants && Array.isArray(media.videoInfo.variants)) {
                // Find highest bitrate video variant
                let highestBitrateVariant = media.videoInfo.variants.reduce((prev, current) => {
                    return (prev.bitrate > current.bitrate) ? prev : current;
                });

                if (highestBitrateVariant.url) {
                    const filename = path.basename(new URL(highestBitrateVariant.url).pathname);
                    await downloadMedia(highestBitrateVariant.url, filename, createdAtTimestamp, userFolder);
                }
            } else if (media.imageSize && media.mediaURL) {
                // Download image
                const filename = path.basename(new URL(media.mediaURL).pathname);
                await downloadMedia(media.mediaURL, filename, createdAtTimestamp, userFolder);
            }
        }
    }
}

// Start fetching data
fetchPaginatedData();
