require('dotenv').config(); // Load env vars https://www.npmjs.com/package/dotenv
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const os = require("os");
const dirTree = require("directory-tree");
const DeferredPromise = require('./DeferredPromise.js');
const DirectoryTreePlus = require('./DirectoryTreePlus.js');
const QueueManager = require('./QueueManager.js');
const QueueConsumerGTLocal = require('./QueueConsumerGTLocal.js');
const _ = require('lodash');
// const server = require('server');
const express = require('express');
const morgan = require('morgan');
const app = express();
const basicAuth = require('express-basic-auth')
// const url = require('url');
// const querystring = require('querystring');


let uploadedFiles = [];
let status = {initialising: true}; // For a web server response
let startTime = new Date();
let fileCheckIntervalTimer;
let occasionalUpdatesIntervalTimer;
if (process.env.DEBUG && JSON.parse(process.env.DEBUG) !== true) {
    console.debug = function () {
    }; // Make it an empty function
}
console.log("Starting up Async Queue");

// console.log('memory usage: ', process.memoryUsage());
const getStats = () => {
    let currentStats = _.merge({}, stats, {totalFileSizeProcessed: directoryTreePlus.fileSizeReadable(stats.totalFileSizeProcessed)})
    // Based on https://www.valentinog.com/blog/node-usage/
    const memoryUsed = process.memoryUsage();
    /* Example used:
    memory usage:  {
  rss: 40411136,
  heapTotal: 18059264,
  heapUsed: 10919016,
  external: 738235,
  arrayBuffers: 67443
}
     */
    for (let key in memoryUsed) {
        currentStats[`memory${_.upperFirst(key)}`] = `${Math.round(memoryUsed[key] / 1024 / 1024 * 100) / 100} MB`;
    }
    return currentStats;
}

const args = process.argv.slice(2);

// FYI https://www.npmjs.com/package/pkg says that:
// >> in order to access real file system at run time (pick up a user's external javascript plugin, json configuration or even get a list of user's directory) you should take process.cwd() or path.dirname(process.execPath).
// path.dirname(process.execPath)


let localFolder = args[0] || process.env.LOCAL_FOLDER || __dirname;
localFolder = path.resolve(localFolder);


let ignoreSelf = JSON.parse(_.get(process, 'env.IGNORE_SELF', true));
let scriptPath = _.get(process, 'env.SCRIPT_PATH', null); // REQUIRED!! Checks it's a valid file
let scriptPathPre = _.get(process, 'env.SCRIPT_PATH_PRE', ''); // e.g If you need to trigger the script with "node " or "cmd.bat" or something
let scriptPathPost = _.get(process, 'env.SCRIPT_PATH_POST', ''); // e.g If you need to pass arguments to the script, like a User ID
let queueConsumerCount = JSON.parse(_.get(process, 'env.QUEUE_CONSUMER_COUNT', 2));
let singleRun = JSON.parse(_.get(process, 'env.SINGLE_RUN', false));
let fileChangePollingSeconds = JSON.parse(_.get(process, 'env.FILE_CHANGE_POLLING_TIME', 5)); // In seconds... e.g check every 5s to see if there's a new file in the submission folder
let statusUpdatesIntervalSeconds = _.get(process, 'env.STATUS_UPDATES_INTERVAL_SECONDS', false); // If 0, null, or something falsy then it won't output general status updates. This is really only useful if you want to actively watch updates via the CLI or by tailing the logs. Otherwise use the web interface
let runWebserver = JSON.parse(_.get(process, 'env.RUN_WEBSERVER', true));
let webserverAuthEnabled = JSON.parse(_.get(process, 'env.WEBSERVER_AUTH_ENABLE', true));
let recurseFolder = JSON.parse(_.get(process, 'env.RECURSE_FOLDER', false)); // The "1. Submission" folder
let webserverUser = _.get(process, 'env.WEBSERVER_AUTH_USER', 'gt');
let webserverPassword = _.get(process, 'env.WEBSERVER_AUTH_PASSWORD', 'Gather Together'); // The default is something that Chrome won't complain is already a hacked password.. Unless you go using this in other places, which is stupid
let submissionFolderName = _.get(process, 'env.SUBMISSION_FOLDER_NAME', '1. Submission'); // Defaults to
let queueFolderName = _.get(process, 'env.QUEUE_FOLDER_NAME', '2. Queue'); // Defaults to
let actuallyRun = JSON.parse(_.get(process, 'env.ACTUALLY_RUN', true)); // If we actually trigger the CLI script or not
let queueProcessingFilename = _.get(process, 'env.QUEUE_PROCESSING_FILENAME', 'asyncProcessing.status.txt'); // A quick way to know if the asyncQueue is running and what it's currently working on
const debug = JSON.parse(_.get(process, 'env.DEBUG', false));

if (null === scriptPath) {
    throw new Error('No Script Path set. Check the .env file and set the SCRIPT_PATH');
}

const SUBMISSION_FOLDER_PATH = path.join(localFolder, submissionFolderName);
const QUEUE_FOLDER_PATH = path.join(localFolder, queueFolderName);
const QUEUE_PROCESSING_FILE = path.join(QUEUE_FOLDER_PATH, queueProcessingFilename);

let config = {
    localFolder,
    ignoreSelf,
    scriptPathPre,
    scriptPath,
    scriptPathPost,
    queueConsumerCount,
    singleRun,
    fileChangePollingSeconds,
    statusUpdatesIntervalSeconds,
    runWebserver,
    webserverAuthEnabled,
    webserverUser,
    webserverPassword,
    debug
};

console.debug(config);
// -- The local excludes are a csv string that gets turned into an array of regex entries
let localExclude = [];
if (process.env.LOCAL_EXCLUDE) {
    // e.g convert "node_modules,stuff,things and whatnot,.hidden" into an array of regex entries [/node_modules/, /stuff/, /things and whatnot/, /.hidden/]
    let folders = process.env.LOCAL_EXCLUDE.split(',');
    if (folders) {
        folders.forEach(folder => {
            localExclude.push(new RegExp(folder));
        })
    }
} else {
    localExclude.push(/node_modules/);
}

let stats = {
    fileChecksCompleted: 0,
    filesQueued: 0,
    filesProcessed: 0,
    filesSkipped: 0,
    filesErrored: 0,
    totalFileSizeProcessed: 0, // Only updated when a file has been uploaded
    unexpectedErrors: 0,
}

let errors = [];
const addError = function (contextMessage, error) {
    console.error('ERROR: ' + contextMessage, error);
    errors.push({contextMessage, error, date: new Date()});
}
if (false === debug) {
    // Don't debug anything
    console.debug = () => {
    };
}


console.log("===============================\n", {
    LOCAL_FOLDER: localFolder,
    FILE_EXTENSIONS: process.env.FILE_EXTENSIONS,
    // MIME_TYPES: process.env.MIME_TYPES,
    DEBUG: JSON.parse(_.get(process, 'env.DEBUG', true)),
    IGNORE_SELF: ignoreSelf,
    LOCAL_EXCLUDE: localExclude,
    args,
});

// @todo: Don't upload self files
let selfFiles = [__filename, '.env', 'QueueConsumer.js'];

// @todo: If IGNORE_SELF then add to the excludeFiles
// @todo: If ignoreHiddenFiles then add ^\..+ to the excludeFiles
// @todo: If process.env.FILE_EXTENSIONS then add to the excludeFiles ?


let gtFileConsumerConfig = {
    scriptPath: scriptPathPre + scriptPath + scriptPathPost,
};

// --------------------------------
//   Workout Dir Tree Options
// --------------------------------
let dirTreeOptions = {
    attributes: ['mode', 'mtime', 'mtimeMs'], // Should be the default anyway in DirectoryTreePlus
    normalizePath: true, // So we can use the same paths for S3
};

if (process.env.FILE_EXTENSIONS) {
    dirTreeOptions.extensions = new RegExp('\\.(' + process.env.FILE_EXTENSIONS + ')$');
}

if (ignoreSelf) {
    // @todo: Add ignore for the local files
}

if (localExclude) {
    dirTreeOptions.exclude = localExclude;
}

console.debug('dirTreeOptions: ', dirTreeOptions);

let directoryTreePlus = null;


gtFileConsumerConfig.directoryTreePlus = directoryTreePlus; // Add in the directoryTreePlus instance to the s3 consumers

// ======================================================================
//                           Setup  Checks
// ======================================================================
status = {initialising: true, setupChecks: 'started'};
let canAccessLocalFolderPromise = new DeferredPromise();
let submissionFolderPromise = new DeferredPromise();
let queueFolderPromise = new DeferredPromise();
let canAccessScriptPromise = new DeferredPromise();
let startupCompletedPromise = new DeferredPromise();

// For later
let queueManagerSettings = {
    consumerCount: queueConsumerCount,
    consumerClass: QueueConsumerGTLocal, // @todo: CREATE THIS AS THE GT LOCAL CONSUMER. I deleted the instanciation somewhere!!!
    consumerConfig: gtFileConsumerConfig,
};
let queueManager = new QueueManager(queueManagerSettings);


// --------------------------------
//   Local Folder check
// --------------------------------
fsPromises.stat(localFolder).then(folderStat => {
    console.debug(`local folder ${localFolder} stat: `, folderStat);
    if (false === folderStat.isDirectory()) {
        throw new Error(`Local Folder ${localFolder} isn't actually a folder`);
    }
    canAccessLocalFolderPromise.resolve(true);
}).catch(err => {
    canAccessLocalFolderPromise.reject(`Error listing local folder "${localFolder}"`, err);
});

// ---------------------------------------------
//   Create Submission / Queue Folders
// ---------------------------------------------

console.debug("Creating the Submission and queue folders");


// -- "1. Submission" Folder
fsPromises.stat(SUBMISSION_FOLDER_PATH).then(async folderStat => {
    if (false === folderStat.isDirectory()) {
        throw new Error(`Unable to create the Submission Folder "${SUBMISSION_FOLDER_PATH}" as it is a file or something else and invalid `)
    } else {
        submissionFolderPromise.resolve(null); // Already exists
    }
}).catch(async err => {
    try {
        let submissionFolderCreation = await fsPromises.mkdir(SUBMISSION_FOLDER_PATH, {recursive: false, mode: 0o777});
        console.log(`Submission folder created ${SUBMISSION_FOLDER_PATH}: `, submissionFolderCreation);
        submissionFolderPromise.resolve(true); // Created it
    } catch (exception) {
        console.log("Error: ", exception);
        throw new Error(`Unable to create the Submission Folder "${SUBMISSION_FOLDER_PATH}"`)
    }
});

// -- 2. Queue Folder
fsPromises.stat(QUEUE_FOLDER_PATH).then(async folderStat => {
    if (false === folderStat.isDirectory()) {
        throw new Error(`Unable to create the Queue Folder "${QUEUE_FOLDER_PATH}" as it is a file or something else and invalid `,)
    } else {
        queueFolderPromise.resolve(null); // Already exists
    }
}).catch(async err => {
    try {
        let queueFolderCreation = await fsPromises.mkdir(QUEUE_FOLDER_PATH, {recursive: false, mode: 0o777});
        console.log(`Queue folder created ${QUEUE_FOLDER_PATH}: `, queueFolderCreation);
        queueFolderPromise.resolve(true);
    } catch (exception) {
        console.log("Error: ", exception);
        throw new Error(`Unable to create the Queue Folder "${QUEUE_FOLDER_PATH}"`)
    }
});


fsPromises.stat(scriptPath).then(async fileStat => {
    if (false === fileStat.isFile()) {
        canAccessScriptPromise.reject(`SCRIPT_PATH is not a valid path, can't access it: "${scriptPath}"`);
    } else {
        canAccessScriptPromise.resolve(true); // Exists, yay
    }
});


// =============================================
//   Check initialisation
// =============================================
Promise.all([canAccessLocalFolderPromise, submissionFolderPromise, queueFolderPromise, canAccessScriptPromise]).then((values) => {

    status = {
        initialising: 'complete',
        setupChecks: 'complete',
        startup: 'completing'
    }
    let isTrue = '✓ true';
    console.log(`-----------------------------\n  Startup Complete\n-----------------------------\n` +
        `Can Access Folder "${localFolder}": ${isTrue}\n` +
        `Submission folder "${SUBMISSION_FOLDER_PATH}": ${values[1] === true ? 'Created' : 'Already Existed'} ${isTrue}\n` +
        `Queue folder "${QUEUE_FOLDER_PATH}": ${values[2] === true ? 'Created' : 'Already Existed'} ${isTrue}\n` +
        `Script File "${scriptPath}" exists: ${isTrue}\n`
    );


    directoryTreePlus = new DirectoryTreePlus(SUBMISSION_FOLDER_PATH, {
        recurseFolder,
        excludeFiles: localExclude,
        extensions: process.env.FILE_EXTENSIONS, // e.g new RegExp('\\.(' + process.env.FILE_EXTENSIONS + ')$');
        ignoreHiddenFiles: true, // Especially useful for checking folders that have Rsync files being received
        dirTreeOptions
    });

    startupCompletedPromise.resolve(values);

}).catch(err => {
    console.error("Unable to start ", err);
    process.exit(2);
});


// =============================================
//   F U N C T I O N S
// =============================================


const occasionalQueueProcessingStatusUpdates = () => {

    if (_.isEmpty(statusUpdatesIntervalSeconds) || _.isNaN(statusUpdatesIntervalSeconds) || statusUpdatesIntervalSeconds < 1) {
        return false;
    }
    return setInterval(() => {
        updateProcessingFile();
        console.log('Update: ', {
            secondsSinceStarted: (new Date().getTime() - startTime) / 1000 + 's',
            status,
            stats: getStats(),
            // queueManagerStats: JSON.stringify(queueManager.getStatistics(true), null, 2),
            queueManagerStats: queueManager.getStatistics(true),
            errors,
        });
    }, statusUpdatesIntervalSeconds * 1000);
}


const updateProcessingFile = () => {

    // NB: Don't want to write to the file if we are still writing to it
    // {
    //     secondsSinceStarted: (new Date().getTime() - startTime) / 1000 + 's',
    //         status,
    //         stats: getStats(),
    //     // queueManagerStats: JSON.stringify(queueManager.getStatistics(true), null, 2),
    //     queueManagerStats: queueManager.getStatistics(true),
    //     errors,
    // }
    const contents = `---- Async Processing ----\n` +
        `Last Updated: ${new Date()}\n` +
        `Seconds Since Started: ${(new Date().getTime() - startTime) / 1000}s\n` +
        `Status: ${JSON.stringify(stats, null, 2)}\n` +
        `---- Stats ----\n${JSON.stringify(getStats(), null, 2)}\n` +
        `---- Queue Manager Stats ----\n${JSON.stringify(queueManager.getStatistics(true), null, 2)}\n`;
    // console.log(`updateProcessingFile: Saving to ${QUEUE_PROCESSING_FILE} the contents:\n`, contents);
    return fsPromises.writeFile(QUEUE_PROCESSING_FILE, contents); // As per https://nodejs.org/api/fs.html#fs_fs_writefile_file_data_options_callback
}

const checkForFileChanges = () => {
    let fileChecksCompleted = stats.fileChecksCompleted;
    fileChecksCompleted++;
    if (true === singleRun) {
        return false; // Don't keep checking for file changes
    }

    return setInterval(() => {

        stats.fileCheckingRightNow = true;
        let fileChanges = directoryTreePlus.getFlattenedEntriesOfOnlyNewFiles();

        let skippedAsNotYetUploaded = 0;
        _.forEach(fileChanges, (treeEntry, treeEntryIndex) => {


            //treeEntry.path

            // We ignore file changes if the file is still in the queue and not yet being processed
            let fileHashTreeEntry = directoryTreePlus.filesHash[treeEntry.path] || null;
            if (fileHashTreeEntry === null || fileHashTreeEntry.processed || !fileHashTreeEntry.processingPromise) {
                // Adding it to the processing Queue
                addFileToQueue(queueManager, treeEntry);
            } else {
                console.log(`Ignoring change to file ${treeEntry.path} as it is in the queue but not yet uploaded`);
                skippedAsNotYetUploaded++;
            }
        });
        fileChecksCompleted++;
        stats.fileChecksCompleted = fileChecksCompleted;
        if (fileChanges.length > 0) {
            console.log(`File update check #${fileChecksCompleted} for the ${fileChanges.length} files`);
        } else {
            console.log(`File update check #${fileChecksCompleted} - Nothing new at `, new Date());
        }
        updateProcessingFile();
        status.fileCheckingRightNow = false;
    }, fileChangePollingSeconds * 1000);
}

const addFileToQueue = async (queueManager, treeEntry) => {


    let queuePromise = new DeferredPromise();
    // @todo: MOVE TO THE QUEUE FOLDER!
    console.log("Tree Entry: ", treeEntry);
    /* Example treeEntry = {
      path: 'C:/Temp/Gather Together Processing/1. Submission/2019-05-16Th Oasis One Flight #2 - 11 Static Of Sunset And --11.mp4',
      name: '2019-05-16Th Oasis One Flight #2 - 11 Static Of Sunset And --11.mp4',
      size: 1057358,
      extension: '.mp4',
      type: 'file',
      mode: 33206,
      mtime: 2019-07-30T15:33:29.000Z,
      mtimeMs: 1564500809000,
      basePath: 'C:/Temp/Gather Together Processing/1. Submission'
    }
     */
    if (!treeEntry || treeEntry.type !== 'file' || treeEntry.size < 1) {
        console.log("Ignoring invalid tree entry: ", treeEntry);
    }
    let fileQueueFolderPath = path.join(QUEUE_FOLDER_PATH, treeEntry.name);

    fsPromises.rename(treeEntry.path, fileQueueFolderPath).then(completed => {
        treeEntry.path = fileQueueFolderPath;
        // @todo: Add to the queue manager
        treeEntry.processingPromise = queueManager.addToQueue(treeEntry);
        queuePromise.resolve(true);
    }).catch(error => {
        console.error(`Unable to move the file ${treeEntry.path} to ${fileQueueFolderPath}\n`, error);
        queuePromise.reject(error);
    });


    return queuePromise;

    stats.filesQueued++;
    treeEntry.processingPromise.then(processingResponse => {
        if (_.get(processingResponse, 'queueEntry.path')) {
            // Merge in the processing Response, assuming it didn't completely error
            directoryTreePlus.addTreeEntryToHash(processingResponse, directoryTreePlus.MERGE_TYPE_MERGE);
            if (processingResponse.uploaded) {
                stats.filesProcessed++;
                // stats.bytesSuccessfullyUploaded += _.get(processingResponse, 'queueEntry.size', 0);
            } else {
                stats.filesSkipped++;
            }
        } else {
            stats.filesErrored++;
            addError("Upload Processing failed: ", {processingResponse, treeEntry});
        }
        if (debug) {
            // return everything
            console.debug("Processed file: ", processingResponse);
        } else {
            console.log(`Processed File: \n`, {
                    file: _.get(processingResponse, 'queueEntry.path', processingResponse.localFilePath),
                    processingTime: _.get(processingResponse, 'processingTime', 'N/A'),
                    uploadProcessingTime: _.get(processingResponse, 'uploadProcessingTime', 'Not Uploaded'),
                    uploaded: _.get(processingResponse, 'uploaded', 'N/A'),
                    // shouldUploadFile: _.get(processingResponse, 'shouldUploadFile', 'N/A'),
                    sha256: _.get(processingResponse, 'sha256OfLocalFile', 'N/A'),
                    s3Location: _.get(processingResponse, 's3ListObject.Contents.0.Key', 'N/A'),
                    size: directoryTreePlus.fileSizeReadable(_.get(processingResponse, 'queueEntry.size', null)),
                }
            )
        }
        /* e.g
        processingResponse:
        {
          uploaded: true,
          shouldUploadFile: true,
          localFilePath: 'C:\\s3UploadExample\\2019-03-16th Trip\\2019-03-16th Trip_V1-0052.mp4',
          sha256OfLocalFile: 'fddb63e4ef19227abf6e5f4719c1fe7c91f2d11b2b4a5a8ae8a6d5436db795c6',
          s3ObjectTags: { TagSet: [ [Object] ] }
          uploadProcessingTime: 2817,
          data: { // The data isn't provided is uploaded === true
            ETag: '"7dea58fd061e30c2b5ad52273fa6cda4"',
            ServerSideEncryption: 'AES256',
            Location: 'https://testing-s3uploader.s3.us-east-2.amazonaws.com/stuff/2019-07-20Th%20Timelapse%20-%20Post%20Sunset%20Stabilised-47.mp4',
            key: 'stuff/2019-07-20Th Timelapse - Post Sunset Stabilised-47.mp4',
            Bucket: 'testing-s3uploader'
          },
          s3ListObject: {
            IsTruncated: false,
            Contents: [{ "Key":"2019-03-16th Trip_V1-0052.mp4", "Size":1082374, "LastModified":"2021-01-31T06:44:53.000Z", "ETag":"\\"d41d8cd98f00b204e9999999fff8427e\\"",  "StorageClass":"STANDARD" } ],
            Name: 'testing-s3uploader',
            Prefix: 'stuff/2019-03-16th Trip_V1-0052.mp4',
            MaxKeys: 1,
            CommonPrefixes: [],
            KeyCount: 1
          },
          queueEntry: {
            path: 'C:/s3UploadExample/2019-03-16th Trip/2019-03-16th Trip_V1-0052.mp4',
            name: '2019-03-16th Trip_V1-0052.mp4',
            size: 1082374,
            extension: '.mp4',
            type: 'file',
            mode: 33206,
            mtime: 2020-08-15T18:34:43.000Z,
            mtimeMs: 1597516483000,
            basePath: 'C:/s3UploadExample',
            __completedQueueTaskPromise: DeferredPromise {
              resolve: [Function (anonymous)],
              reject: [Function (anonymous)],
              then: [Function: bound then],
              catch: [Function: bound catch],
              _promise: [Promise],
              [Symbol(Symbol.toStringTag)]: 'Promise'
            }
          }
        }

         */
    }).catch(err => {
        stats.filesErrored++;
        addError(`Error processing file ${treeEntry.path}: `, err);
    });

    directoryTreePlus.addTreeEntryToHash(treeEntry, directoryTreePlus.MERGE_TYPE_MERGE); // Add in the promise
    return treeEntry; // It should now have an uploadPromise
    // console.debug("Added file to queue: ", treeEntry.path);
}


const addUploadFilesToQueue = async (queueManager, flattenedTree) => {
    if (_.isEmpty(flattenedTree)) {
        console.debug("No files to upload");
        return null;
    }

    _.forEach(flattenedTree, treeEntry => {
        // In case we aren't getting a filtered list, we just want to process files not directories
        if (treeEntry.type === directoryTreePlus.TYPE_FILE) {
            addFileToQueue(queueManager, treeEntry);
        }
    });

    return flattenedTree;
};
// =============================================
//   Add Initial Files to Queue
// =============================================
startupCompletedPromise.then((values) => {
    status = {startup: 'Completed'};
    // console.debug("--------------------------\n  Startup Completed\n--------------------------\n", values);
    // console.debug(localFolder);
    let flattenedTree = directoryTreePlus.getFlattenedTreeEntries(); // Initially get all the files
    // let flattenedTree = filterOutRecursiveDirectoriesIfNeeded(dirTree(localFolder, dirTreeOptions));
    // console.debug("Checking files:");
    // console.debug("The flattenedTree is: ", flattenedTree);
    // console.log("\nExisting Files: \n", directoryTreePlus.treeOutput(flattenedTree));
    // e.g: The flattenedTree is:  {
    //   path: 'C:/Images/2020-12-31st New Years Eve',
    //   name: '2020-12-31st New Years Eve',
    //   mode: 16822,
    //   mtime: 2021-01-03T15:25:35.383Z,
    //   children: [
    //     {
    //       path: 'C:/Images/2020-12-31st New Years Eve/Exported',
    //       name: 'Exported',
    //       mode: 16822,
    //       mtime: 2021-01-03T15:28:18.868Z,
    //       children: [Array],
    //       size: 12016525345,
    //       type: 'directory'
    //     },
    //     {
    //       path: "C:/Images/2020-12-31st New Years Eve/v1-0005.mp4",
    //       name: 'v1-0005.mp4',
    //       size: 2875052099,
    //       extension: '.mp4',
    //       type: 'file',
    //       mode: 33206,
    //       mtime: 2021-01-03T15:20:19.868Z
    //     }
    //   ],
    //   size: 12016525345,
    //   type: 'directory'
    // }


    if (!actuallyRun) {
        console.log("Not actually processing any files");
        return null;
    }
    return flattenedTree;

}).then(async filteredTree => {
    queueManager.start(); // Start processing as soon as we add entries to the queue
    if (!filteredTree || _.get(filteredTree, 'path')) {
        // Ignoring empty tree or ACTUALLY_UPLOAD is set to false
        status.queue = `Nothing in 1st Queue run ( ACTUALLY_RUN is ${JSON.stringify(actuallyRun)} )`;
        console.log("Invalid empty or disabled filteredTree, nothing to upload", filteredTree);
        return null;
    }
    status.queue = 'Starting 1st queue run';

    // ====================================
    //   Add Files to Processing Queue
    // ====================================

    // @todo: Default upload type (e.g x-amz-storage-class able to be set to DEEP_ARCHIVE)
    // @todo: MIME_TYPES ?? Not right now
    // @todo: IGNORE_SELF (__file and also .env, assumes it's been compiled to a single file)
    // @todo: Have a local webserver
    // @todo: Work out how to NOT upload a file until it's been fully uploaded by Rsync (even if it gets only partly rsync'd)

    // let basePath = _.get(filteredTree, '0.path');
    await addUploadFilesToQueue(queueManager, filteredTree);
    return null;
}).then(async () => {
    console.log("Initial Uploading being processed for: ", _.keys(directoryTreePlus.filesHash));
    if (false === singleRun) {
        fileCheckIntervalTimer = checkForFileChanges();
    }
    occasionalUpdatesIntervalTimer = occasionalQueueProcessingStatusUpdates();
    status.queue = '1st queue run processing';
    await queueManager.drained();
    status.queue = '1st queue run processed';
    updateProcessingFile();
    // console.debug("Completed initial uploading: ", uploadedFiles);
    console.log("Completed the initial processing in : " + (new Date().getTime() - startTime) / 1000 + `s\nStats: `, getStats());
    return uploadedFiles;
}).then(async () => {
    if (true === singleRun) {
        status.queue = '1st queue run complete and SINGLE_UPLOAD_RUN is true';
        status.completed = true;
        clearInterval(occasionalUpdatesIntervalTimer);
        clearInterval(fileCheckIntervalTimer); // Although this shouldn't be set anyway
        console.log("Only doing a single run, so not checking for new files");
        console.log("stats: ", stats);
        console.log("=== COMPLETED ===");
        process.exit(0); // Completed successfully
    }
    status.firstQueueRunCompleted = true;
    status.queue = 'Waiting for file changes';
    // If not a singleUploadRun then the checkForFileChanges should continue running until the program is shut down
    console.log("-------");
}).catch(err => {
    addError("Caught a processing promise which failed after startup completed", err);
});


// ==== For running a webserver
const objectToHtml = function (object) {
    // e.g status  = {"startup":"Completed","queue":"general processing","fileChecksCompleted":0}
    // Should return as:
    // <p>startup: "Completed"</br />
    let response = '';

    // -- If it's an array
    if (_.isArray(object)) {
        response += `<ol>`;
        _.forEach(object, (value) => {
            response += `<li>${valueResponse(value)}</li>`;
        });
        response += `</ol>`;
        return response;
    }

    response += '<p>';
    _.forEach(object, (value, key) => {
        response += `<strong>${key}</strong>: ${valueResponse(value)}<br />\n`;
    });
    response += `</p>`;
    return response;
}

const valueResponse = function (value) {
    if (_.isObject(value)) {
        return '<pre>' + JSON.stringify(value, null, 2) + '</pre>';
    } else if (_.isString(value)) {
        return `"${value}"`;
    } else if (_.isBoolean(value)) {
        return (true === value ? `<span class="bool-true" style="color: darkgreen;">✓ ` : `<span class="bool-false" style="color: darkred;">✗ `) + JSON.stringify(value) + `</span>`;

        // @todo: Deal with Dates
    } else {
        // e.g Number
        return value;
    }
}
if (true === runWebserver) {


    function normalizePort(val) {
        let port = parseInt(val, 10);

        if (isNaN(port)) {
            // named pipe
            return val;
        }
        if (port >= 0) {
            // port number
            return port;
        }
        return false;
    }

    let port = normalizePort(process.env.PORT || '5081');
    config.port = port;
    app.use(morgan('combined'));
    if (true === webserverAuthEnabled) {
        app.use(basicAuth({
            users: {[webserverUser]: webserverPassword},
            challenge: true,
            realm: 's3Uploader ' + os.hostname(),
        }));
    }

    app.route('/').get(function (req, res) {
        res.send("<h1>S3 Uploader</h1>\n" +
            "<ul><li><a href='/ping'>Ping</a></li>\n" +
            "<li><a href='/status'>Status</a></li>\n" +
            "<li><a href='/status?verbose=true'>Status - Fully Verbose</a></li>\n" +
            "<li><a href='/status?html=true'>Status - Human Readable</a></li>\n" +
            "</ul>\n" +
            "");
    });
    app.route('/ping').get(function (req, res) {
        res.send({running: true});
    });


    app.get('/status', function (req, res) {
        let verbose = _.get(req.query, 'verbose', false); // default to false

        // -- Human Readable HTML version
        if (true === JSON.parse(_.get(req.query, 'html', false))) {
            // @todo: Make this look nicer, maybe have a default template and use Twig?
            res.send(
                "<h1>S3 Uploader Status</h1>\n" +
                `Hostname: ${os.hostname()}<strong></strong><br />\n` +
                "<h2>Status</h2>" +
                objectToHtml(status) + '<br /><hr />\n' +
                "<h2>Stats</h2>" +
                objectToHtml(getStats()) + '<br /><hr />\n' +
                "<h2>Configuration</h2>" +
                objectToHtml(config) + '<br /><hr />\n' +
                "<h2>Queue Status</h2>" +
                objectToHtml(queueManager.getStatistics(verbose)) + '<br /><hr />\n' +
                "<h2>Files</h2>" +
                objectToHtml(_.keys(directoryTreePlus.filesHash)) + '<br /><hr />\n' +

                "");
        } else {
            // -- JSON
            res.send({
                status,
                stats: getStats(),
                config,
                queueStatus: queueManager.getStatistics(verbose),
                filesHash: _.keys(directoryTreePlus.filesHash)
            });
        }
    });

    function onListening() {
        var addr = server.address();
        var bind = typeof addr === 'string'
            ? 'pipe ' + addr
            : 'port ' + addr.port;
        console.log('Listening on ' + bind);
    }


    const server = app.listen(port, onListening);

}