const AWS = require('aws-sdk');
require('dotenv').config(); // Load env vars https://www.npmjs.com/package/dotenv
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const dirTree = require("directory-tree");
const DeferredPromise = require('./DeferredPromise.js');
const QueueManager = require('./QueueManager.js');
const QueueConsumerS3 = require('./QueueConsumerS3.js');
const _ = require('lodash');


let uploadedFiles = [];
let status = {}; // For a web server response
let startTime = new Date();
if (process.env.DEBUG && JSON.parse(process.env.DEBUG) !== true) {
    console.debug = function () {
    }; // Make it an empty function
}
console.log("Starting up s3 Uploader");

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
        OVERWRITE_EXISTING_IF_DIFFERENT: checkAwsBucketAtStartup,
        args,
        s3ConsumerConfig
    });

// @todo: Don't upload self files
let selfFiles = [__filename, '.env', 'QueueConsumer.js'];

// @todo: Setup a file hash setup with the filepath and contain a list of promises, etc..

let filesHash = {}; //

// Based on https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/s3-example-creating-buckets.html#s3-example-creating-buckets-upload-file
AWS.config.update({region: process.env.AWS_REGION}); // Likely to be 'us-east-2' Ohio
// -- Create S3 service object
let s3 = new AWS.S3({apiVersion: '2006-03-01'});


// ======================================================================
//                           Setup  Checks
// ======================================================================

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
        process.exit(3); // We don't reject it we instead just straight exit, but with a different error code
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

const filterOutRecursiveDirectoriesIfNeeded = function (filteredTree) {

    if (recurseFolder === false && filteredTree && filteredTree.children && filteredTree.children.length > 0) {

        filteredTree.children = _.filter(filteredTree.children, treeEntry => {
            return treeEntry.type !== 'directory';
        });
    }

    if (!Array.isArray(filteredTree)) {
        filteredTree = [filteredTree];
    }
    return filteredTree;
}

const treeOutput = function (filteredTree, indents = '') {
    let output = '';

    _.each(filteredTree, treeEntry => {
        // console.debug(treeEntry);
        output += indents + (treeEntry.type === 'file' ? treeEntry.name : `[ ${treeEntry.name} ]`) + ' ' + fileSizeReadable(treeEntry.size) + "\n"
        if (treeEntry.type === 'directory' && _.get(treeEntry, 'children.length') > 0) {
            output += treeOutput(treeEntry.children, `${indents} - `); // Recursive call
        }
    });
    return output;
}

const fileSizeReadable = function (sizeBytes) {
    if (null === sizeBytes || isNaN(sizeBytes)) {
        return sizeBytes;
    }
    let decimals = (Math.round((sizeBytes / 1048576) * 100) / 100).toFixed(2);
    if (decimals.toString().length > 3) {
        decimals = decimals.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    }
    return decimals + "MB";

}


const occasionalQueueProcessingStatusUpdates = (updateTimeInMs = 10000) => {

    return setInterval(() => {
        console.log('Update: ', {
            secondsSinceStarted: (new Date().getTime() - startTime) / 1000 + 's',
            // queueManagerStats: JSON.stringify(queueManager.getStatistics(true), null, 2),
            queueManagerStats: queueManager.getStatistics(true),
        });
    }, updateTimeInMs);
}
//
const addUploadFilesToQueue = async (queueManager, filteredTree, basePath = localFolder) => {
    if (!filteredTree) {
        console.debug("No files to upload");
        return null;
    }

    _.each(filteredTree, treeEntry => {
        if (treeEntry.type === 'file') {
            // console.debug("Sending file to be uploaded", {treeEntry, basePath});
            treeEntry.basePath = basePath;


            filesHash[treeEntry.path] = {treeEntry, uploadPromise: queueManager.addToQueue(treeEntry)};
            filesHash[treeEntry.path].uploadPromise.then(processingResponse => {
                const fileHashKey = _.get(processingResponse, 'treeEntry.path', treeEntry.path);
                let fileHasEntry = filesHash[fileHashKey];
                filesHash[fileHashKey] = _.merge(fileHasEntry, processingResponse);

                if (debug) {
                    console.debug("Processed file: ", processingResponse);
                } else {
                    console.log(`Processed File: \n`, {
                            file: _.get(processingResponse, 'treeEntry.path', 'N/A'),
                            processingTime: _.get(processingResponse, 'processingTime', 'N/A'),
                            uploadProcessingTime: _.get(processingResponse, 'uploadProcessingTime', 'Not Uploaded'),
                            uploaded: _.get(processingResponse, 'uploaded', 'N/A'),
                            // shouldUploadFile: _.get(processingResponse, 'shouldUploadFile', 'N/A'),
                            sha256: _.get(processingResponse, 'sha256OfLocalFile', 'N/A'),
                            s3Location: _.get(processingResponse, 's3ListObject.Contents.0.Key', 'N/A'),
                            size: fileSizeReadable(_.get(processingResponse, 'treeEntry.size', null)),
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
                  data: {
                    ETag: '"7dea58fd061e30c2b5ad52273fa6cda4"',
                    ServerSideEncryption: 'AES256',
                    Location: 'https://testing-s3uploader.s3.us-east-2.amazonaws.com/stuff/2019-07-20Th%20Timelapse%20-%20Post%20Sunset%20Stabilised-47.mp4',
                    key: 'stuff/2019-07-20Th Timelapse - Post Sunset Stabilised-47.mp4',
                    Key: 'stuff/2019-07-20Th Timelapse - Post Sunset Stabilised-47.mp4',
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
                  treeEntry: {
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
                console.log(`Error processing file ${treeEntry.path}: `, err);
            });
            // console.debug("Added file to queue: ", treeEntry.path);
        }
        if (_.get(treeEntry, 'children.length') > 0) {
            addUploadFilesToQueue(queueManager, treeEntry.children, basePath);
        }
    });

    return uploadedFiles;
};


// --------------------------------
//   Workout Dir Tree Options
// --------------------------------
let dirTreeOptions = {
    attributes: ['mode', 'mtime', 'mtimeMs'],
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


// =============================================
//   Add Initial Files to Queue
// =============================================
startupCompletedPromise.then((values) => {
    console.debug("--------------------------\n  Startup Completed\n--------------------------\n", values);
    console.debug(localFolder);
    let filteredTree = filterOutRecursiveDirectoriesIfNeeded(dirTree(localFolder, dirTreeOptions));
    console.debug("Checking files:");
    // console.debug("The filteredTree is: ", filteredTree);
    console.log("\nThe filteredTree as nicer output is: \n", treeOutput(filteredTree));
    // e.g: The filteredTree is:  {
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
    return filteredTree;

}).then(async filteredTree => {
    if (!filteredTree || _.get(filteredTree, 'path')) {
        // Ignoring empty tree or ACTUALLY_UPLOAD is set to false
        console.log("Invalid empty or disabled filteredTree, nothing to upload", filteredTree);
        return null;
    }
    queueManager.start(); // Start processing as soon as we add entries to the queue

    // ====================================
    //   Add Files to Processing Queue
    // ====================================

    // @todo: Default upload type (e.g x-amz-storage-class able to be set to DEEP_ARCHIVE)
    // @todo: MIME_TYPES ?? Not right now
    // @todo: IGNORE_SELF (__file and also .env, assumes it's been compiled to a single file)
    // @todo: Have a local webserver
    // @todo: Regular checking
    // @todo: Add a single filesystem checker - Can scan regularly or add a filewatch
    // @todo: Work out how to NOT upload a file until it's been fully uploaded by Rsync (even if it gets only partly rsync'd)

    let basePath = _.get(filteredTree, '0.path');
    await addUploadFilesToQueue(queueManager, filteredTree, basePath);
    return null;
}).then(async () => {
    console.log("Initial Uploading being processed for: ", _.keys(filesHash));

    let occasionalUpdatesTimer = occasionalQueueProcessingStatusUpdates();

    // console.log('queueManager Stats',
    //     queueManager.getStatistics(true)
    // );
    await queueManager.drained();
    clearInterval(occasionalUpdatesTimer);
    // console.debug("Completed initial uploading: ", uploadedFiles);
    console.log("Completed initial processing in : " + (new Date().getTime() - startTime) / 1000 + 's');
    return uploadedFiles;
}).then(async () => {
    // @todo: Check for any new files
    console.log("@todo: Check for new files");
    console.log("-------");
}).catch(err => {
    console.err("Error when uploading files: ", err);
});


// ==== For running a webserver
//
// var port = normalizePort(process.env.PORT || '5081');
//
//
// /**
//  * Normalize a port into a number, string, or false.
//  */
//
// function normalizePort(val) {
//     var port = parseInt(val, 10);
//
//     if (isNaN(port)) {
//         // named pipe
//         return val;
//     }
//
//     if (port >= 0) {
//         // port number
//         return port;
//     }
//
//     return false;
// }
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


