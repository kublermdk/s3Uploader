const AWS = require('aws-sdk');
require('dotenv').config(); // Load env vars https://www.npmjs.com/package/dotenv
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const dirTree = require("directory-tree");
const DeferredPromise = require('./DeferredPromise.js');
const DirectoryTreePlus = require('./DirectoryTreePlus.js');
const QueueManager = require('./QueueManager.js');
const QueueConsumerS3 = require('./QueueConsumerS3.js');
const _ = require('lodash');
// const server = require('server');

let uploadedFiles = [];
let status = {initialising: true}; // For a web server response
let startTime = new Date();
let fileCheckIntervalTimer;
let occasionalUpdatesIntervalTimer;
if (process.env.DEBUG && JSON.parse(process.env.DEBUG) !== true) {
    console.debug = function () {
    }; // Make it an empty function
}
console.log("Starting up s3 Uploader");

console.log('memory usage: ', process.memoryUsage());
const getStats = () => {
    let currentStats = _.merge({}, stats, {mbUploaded: directoryTreePlus.fileSizeReadable(stats.bytesSuccessfullyUploaded)})
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

const s3BucketName = process.env.AWS_S3_BUCKET;
let s3BucketFolder = _.get(process, 'env.AWS_S3_BUCKET_FOLDER', '');
if (s3BucketFolder === '/') {
    s3BucketFolder = ''; // We don't need a starting /
}
let ignoreSelf = JSON.parse(_.get(process, 'env.IGNORE_SELF', true));
let recurseFolder = JSON.parse(_.get(process, 'env.RECURSE_FOLDER', false));
let checkAwsBucketAtStartup = JSON.parse(_.get(process, 'env.CHECK_AWS_BUCKET_AT_STARTUP', true)); // parse it from a string to bool. Using _.get instead of || as it'll only return true even if set to false
let actuallyUpload = JSON.parse(_.get(process, 'env.ACTUALLY_UPLOAD', true));
let overwriteExisting = JSON.parse(_.get(process, 'env.OVERWRITE_EXISTING_IF_DIFFERENT', true));
let overwriteAll = JSON.parse(_.get(process, 'env.OVERWRITE', false));
let queueConsumerCount = JSON.parse(_.get(process, 'env.QUEUE_CONSUMER_COUNT', 2));
let singleUploadRun = JSON.parse(_.get(process, 'env.SINGLE_UPLOAD_RUN', false));
let fileChangePollingSeconds = JSON.parse(_.get(process, 'env.FILE_CHANGE_POLLING_TIME', 20)); // In seconds
let fileChangedOrJustNew = _.get(process, 'env.FILES_THAT_HAVE_CHANGED_OR_JUST_NEW', 'CHANGED').toUpperCase(); // if 'NEW' only process the files that have been newly uploaded and ignore those which have had their size or modified time changed.
let statusUpdatesIntervalSeconds = _.get(process, 'env.STATUS_UPDATES_INTERVAL_SECONDS', false); // If 0, null, or something falsy then it won't output general status updates. This is really only useful if you want to actively watch updates via the CLI or by tailing the logs. Otherwise use the web interface
const debug = JSON.parse(_.get(process, 'env.DEBUG', false));

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
    filesQueued: 0,
    filesUploaded: 0,
    filesSkipped: 0,
    filesErrored: 0,
    bytesSuccessfullyUploaded: 0, // Only updated when a file has been uploaded
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

let s3ConsumerConfig = {
    AWS_REGION: process.env.AWS_REGION,
    AWS_S3_BUCKET: s3BucketName,
    AWS_S3_BUCKET_FOLDER: s3BucketFolder,
    AWS_CONFIG_FILE: process.env.AWS_CONFIG_FILE,
    AWS_PROFILE: process.env.AWS_PROFILE,
    OVERWRITE_EXISTING_IF_DIFFERENT: overwriteExisting,
    OVERWRITE: overwriteAll,
}


console.log("===============================\n",
    {
        LOCAL_FOLDER: localFolder,
        FILE_EXTENSIONS: process.env.FILE_EXTENSIONS,
        // MIME_TYPES: process.env.MIME_TYPES,
        DEBUG: JSON.parse(_.get(process, 'env.DEBUG', true)),
        IGNORE_SELF: ignoreSelf,
        LOCAL_EXCLUDE: localExclude,
        RECURSE_FOLDER: recurseFolder,
        CHECK_AWS_BUCKET_AT_STARTUP: checkAwsBucketAtStartup,
        OVERWRITE_EXISTING_IF_DIFFERENT: overwriteExisting,
        args,
        s3ConsumerConfig
    });

// @todo: Don't upload self files
let selfFiles = [__filename, '.env', 'QueueConsumer.js'];

// @todo: If IGNORE_SELF then add to the excludeFiles
// @todo: If ignoreHiddenFiles then add ^\..+ to the excludeFiles
// @todo: If process.env.FILE_EXTENSIONS then add to the excludeFiles ?

// Based on https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/s3-example-creating-buckets.html#s3-example-creating-buckets-upload-file
AWS.config.update({region: process.env.AWS_REGION}); // Likely to be 'us-east-2' Ohio
// -- Create S3 service object
let s3 = new AWS.S3({apiVersion: '2006-03-01'});


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

let directoryTreePlus = new DirectoryTreePlus(localFolder, {
    recurseFolder: recurseFolder,
    excludeFiles: localExclude,
    extensions: process.env.FILE_EXTENSIONS, // e.g new RegExp('\\.(' + process.env.FILE_EXTENSIONS + ')$');
    ignoreHiddenFiles: true, // Especially useful for checking folders that have Rsync files being received
    dirTreeOptions
});

s3ConsumerConfig.directoryTreePlus = directoryTreePlus; // Add in the directoryTreePlus instance to the s3 consumers

// ======================================================================
//                           Setup  Checks
// ======================================================================
status = {initialising: true, setupChecks: 'started'};
let canAccessLocalFolderPromise = new DeferredPromise();
let checkAwsCredentialsPromise = new DeferredPromise();
let checkAwsBucketPromise = new DeferredPromise();
let startupCompletedPromise = new DeferredPromise();

// For later
let queueManagerSettings = {
    consumerCount: queueConsumerCount,
    consumerClass: QueueConsumerS3,
    consumerConfig: s3ConsumerConfig,
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

    canAccessLocalFolderPromise.reject(`Error listing local folder ${localFolder}: `, err);
});


// --------------------------------
//   S3 Check
// --------------------------------
console.debug("Checking if you can access the S3 bucket");

AWS.config.getCredentials((err) => {
    if (err) {
        console.error("Unable to access AWS credentials. Check you have a valid ~/.aws/credentials ( or on Windows C:\\Users\\USER_NAME\\.aws\\credentials ) file ", err);
        checkAwsCredentialsPromise.reject('Unable to access credentials'); // Stop the other promises;
        process.exit(3); // Straight exit, and with a specific error code
    } else {
        console.debug("AWS Access key:", AWS.config.credentials.accessKeyId);
        checkAwsCredentialsPromise.resolve(true);
    }
});

if (!checkAwsBucketAtStartup) {
    checkAwsBucketPromise.resolve(null);
} else {
    s3.listBuckets(function (err, bucketListingData) {
        if (err) {
            console.error("Error listing AWS buckets", err);
            checkAwsBucketPromise.reject('Unable to access AWS Buckets');
        } else {
            // e.g bucketListingData.Buckets: [{
            //     Name: 's3-uploader',
            //     CreationDate: 2020-10-27T05:51:28.000Z
            // }]
            console.debug("AWS Buckets available: ", bucketListingData);
            if (!bucketListingData || !bucketListingData.Buckets || 0 === bucketListingData.Buckets.length) {
                throw new Error("Invalid AWS S3 Bucket Listing response");
            }

            let canSeeBucket = false;
            bucketListingData.Buckets.forEach(bucket => {
                if (bucket.Name === s3BucketName) {
                    canSeeBucket = true;
                }
            });
            if (canSeeBucket !== true) {
                checkAwsBucketPromise.reject("Unable to list the S3 Bucket " + s3BucketName + " check AWS_S3_BUCKET is correct and the IAM has access");
            }

            // console.log("AWS Buckets available: ", data.Buckets);
            checkAwsBucketPromise.resolve(bucketListingData);
        }
    });
}


// =============================================
//   Check initialisation
// =============================================
Promise.all([canAccessLocalFolderPromise, checkAwsCredentialsPromise, checkAwsBucketPromise]).then((values) => {

    status = {
        initialising: 'complete',
        setupChecks: 'complete',
        startup: 'completing'
    }
    let isTrue = '✓ true';
    let awsBucket = isTrue;
    if (values[2] === null) {
        awsBucket = '- unchecked';
    }
    console.log(`Can Access LocalFolder: ${isTrue}\n` +
        `AWS Credentials Valid: ${isTrue}\n` +
        `Can Access S3 Bucket: ${awsBucket}\n`
    );

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


const checkForFileChanges = () => {

    if (true === singleUploadRun) {
        return false; // Don't keep checking for file changes
    }
    let fileChecksCompleted = 0;
    status.fileChecksCompleted = fileChecksCompleted;
    return setInterval(() => {
        status.fileChecking = true;
        let fileChanges = [];
        if ('NEW' === fileChangedOrJustNew) {
            fileChanges = directoryTreePlus.getFlattenedEntriesOfOnlyNewFiles();

        } else {
            // Check for changed AND new
            fileChanges = directoryTreePlus.getFlattenedEntriesOfNewOrChangedFiles();
        }

        let skippedAsNotYetUploaded = 0;
        _.forEach(fileChanges, (treeEntry, treeEntryIndex) => {
            // We ignore file changes if the file is still in the queue and not yet being processed
            let fileHashTreeEntry = directoryTreePlus.filesHash[treeEntry.path] || null;

            // @todo: CONFIRM LOGIC
            // @todo: CONFIRM LOGIC
            // @todo: CONFIRM LOGIC
            if (fileHashTreeEntry === null || fileHashTreeEntry.uploaded || !fileHashTreeEntry.uploadPromise) {
                // New file, or already previously uploaded, add it to the processing Queue
                addFileToQueue(queueManager, treeEntry);
            } else {
                console.log(`Ignoring change to file ${treeEntry.path} as it is in the queue but not yet uploaded`);
                skippedAsNotYetUploaded++;
            }
        });
        fileChecksCompleted++;
        stats.fileChecksCompleted = fileChecksCompleted;
        if (fileChanges.length > 0) {
            console.log(`File update check #${fileChecksCompleted} for the ${fileChanges.length} files which are new ` + ('NEW' === fileChangedOrJustNew ? '' : 'or changed') + ` and there was ${skippedAsNotYetUploaded} skipped as they are already in the queue and have not yet been uploaded`);
        } else {
            console.log(`File update check #${fileChecksCompleted} - Nothing ` + ('NEW' === fileChangedOrJustNew ? 'new' : 'changed') + ' at ', new Date());
        }

        status.fileChecking = false;
    }, fileChangePollingSeconds * 1000);
}

const addFileToQueue = async (queueManager, treeEntry) => {
    treeEntry.uploadPromise = queueManager.addToQueue(treeEntry);
    stats.filesQueued++;
    treeEntry.uploadPromise.then(processingResponse => {
        if (_.get(processingResponse, 'queueEntry.path')) {
            // Merge in the processing Response, assuming it didn't completely error
            directoryTreePlus.addTreeEntryToHash(processingResponse, directoryTreePlus.MERGE_TYPE_MERGE);
            if (processingResponse.uploaded) {
                stats.filesUploaded++;
                stats.bytesSuccessfullyUploaded += _.get(processingResponse, 'queueEntry.size', 0);
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
    console.debug("--------------------------\n  Startup Completed\n--------------------------\n", values);
    console.debug(localFolder);
    let flattenedTree = directoryTreePlus.getFlattenedTreeEntries(); // Initially get all the files
    // let flattenedTree = filterOutRecursiveDirectoriesIfNeeded(dirTree(localFolder, dirTreeOptions));
    console.debug("Checking files:");
    // console.debug("The flattenedTree is: ", flattenedTree);
    console.log("\nThe flattenedTree as nicer output is: \n", directoryTreePlus.treeOutput(flattenedTree));
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


    if (!actuallyUpload) {
        console.log("Not uploading any files as ACTUALLY_UPLOAD is set to false");
        return null;
    }
    return flattenedTree;

}).then(async filteredTree => {
    if (!filteredTree || _.get(filteredTree, 'path')) {
        // Ignoring empty tree or ACTUALLY_UPLOAD is set to false
        console.log("Invalid empty or disabled filteredTree, nothing to upload", filteredTree);
        return null;
    }
    status.queue = 'starting 1st queue run';
    queueManager.start(); // Start processing as soon as we add entries to the queue

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
    if (false === singleUploadRun) {
        fileCheckIntervalTimer = checkForFileChanges();
    }
    occasionalUpdatesIntervalTimer = occasionalQueueProcessingStatusUpdates();
    status.queue = '1st queue run processing';
    await queueManager.drained();
    status.queue = '1st queue run processed';
    // console.debug("Completed initial uploading: ", uploadedFiles);
    console.log("Completed the initial processing in : " + (new Date().getTime() - startTime) / 1000 + `s\nStats: `, getStats());
    return uploadedFiles;
}).then(async () => {
    if (true === singleUploadRun) {
        clearInterval(occasionalUpdatesIntervalTimer);
        clearInterval(fileCheckIntervalTimer); // Although this shouldn't be set anyway
        console.log("Only doing a single run, so not checking for new files");
        console.log("stats: ", stats);
        console.log("=== COMPLETED ===");
        exit(0); // Completed successfully
    }
    status.queue = 'general processing';
    // If not a singleUploadRun then the checkForFileChanges should continue running until the program is shut down
    console.log("-------");
}).catch(err => {
    addError("Caught a processing promise which failed after startup completed", err);
});


// ==== For running a webserver
//

//
// /**
//  * Normalize a port into a number, string, or false.
//  */
//
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
//
//
//
// /**
//  * Event listener for HTTP server "listening" event.
//  */
//
// function onListening() {
//     var addr = server.address();
//     var bind = typeof addr === 'string'
//         ? 'pipe ' + addr
//         : 'port ' + addr.port;
//     debug('Listening on ' + bind);
// }


