const QueueConsumerBase = require('./QueueConsumerBase.js');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const DeferredPromise = require('./DeferredPromise.js');
const _ = require('lodash');
// const sha256File = require('sha256-file');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

/**
 * Queue Consumer GT Local
 *
 * For processing video (and photo) files with the Gather Together CLI
 */
class QueueConsumerGTLocal extends QueueConsumerBase {

    /**
     * You need to specify the constructor in the extended Queue Consumer
     * and do your own merge if you want to have the defaultConfig get applied as intended
     * @param queueManager
     * @param consumerConfig
     * @param settings
     */
    constructor(queueManager, consumerConfig = {}, settings = {}) {
        super(queueManager, consumerConfig, settings);
        this.config = _.merge(this.config, this.defaultConfig, consumerConfig);
    }

    // The default configuration is added to the config in the constructor
    defaultConfig = {
        FILEPATH_CLI_ARG: '--filepath=', // Added before the filename, you could have it with a space without anything, whatever is needed. e.g '/usr/kublermdk/gt/script/cli.js --filepath="/usr/kublermdk/gt/2. Queue/2021-08-23rd-video of some cool stuff.mp4"'
        child_process_options: {
            encoding: 'utf8',
            timeout: 0, // No timeout if 0 otherwise then in milliseconds
            maxBuffer: 2000 * 1024, // Allow lots of console.log output if needed
            killSignal: 'SIGTERM',
            cwd: null, // @todo: Probably needs to be set to the working directory of the GT script or the Queue folder?
            // env: null // setting it means it probably doesn't send the usual process.env
        }
    }

    processQueueEntry = async (queueEntry) => {

        /*
        Example queueEntry is:
        {
          "path": "/usr/kublermdk/gt/2. Queue/2021-08-23rd-video of some cool stuff.mp4",
          "name": "2021-08-23rd-video of some cool stuff.mp4",
          "size": 1312736761, // (1,312,736,761 = 1.22 GB)
          "extension": ".mp4",
          "type": "file",
          "mode": 33206,
          "mtime": "2021-08-23T02:47:30.290Z",
          "mtimeMs": 1610160450289.9504,
          "basePath": "/usr/kublermdk/gt/2. Queue/2021-08-23rd-video of some cool stuff.mp4", // added in from the dirTree root entry, not there by default in dirTree for a child entry
          "__completedQueueTaskPromise": {
            "_promise": {}
          }
        }
         */
        return new Promise((resolve, reject) => {
                let processingTimeStarted = new Date();
                let cliOptions = this.config.child_process_options;
                const basePath = queueEntry.basePath;
                let localFilePath = path.join(queueEntry.path); // Convert to a local filepath that fs can read

                // let sha256FilePromise = new DeferredPromise();
                // let fsStatPromise = fsPromises.stat(localFilePath);
                let processingPromise = new DeferredPromise();
                let processingCliCall = exec(`ls -aslch`, `"${localFilePath}"`, cliOptions).then(results => {
                    const {stdout, stderr} = results;
                    console.log(`ls results for: ${localFilePath}:\n`, results, "\n\n");
                    // console.log("StdOut: ", stdout);
                    // console.log("StdErr: ", stderr);
                    resolve(results);
                });

                // Example fsStat:
                // {
                //     dev: 1733172691,
                //     mode: 33206,
                //     nlink: 1,
                //     uid: 0,
                //     gid: 0,
                //     rdev: 0,
                //     blksize: 4096,
                //     ino: 50665495808138510,
                //     size: 43,
                //     blocks: 0,
                //     atimeMs: 1612086167975.0261,
                //     mtimeMs: 1610160450289.9504,
                //     ctimeMs: 1610160450289.9504,
                //     birthtimeMs: 1610160449423.793,
                //     atime: 2021-01-31T09:42:47.975Z,
                //     mtime: 2021-01-09T02:47:30.290Z,
                //     ctime: 2021-01-09T02:47:30.290Z,
                //     birthtime: 2021-01-09T02:47:29.424Z
                // }
                // fsStatPromise.catch(err => {
                //     this.addError(err, `invalid local file '${localFilePath} 's3 uploader can't upload it`);
                //     reject(err);
                // });


                // -- This could take a few moments to sha a full file
                // Would it be useful to have a SHA256 of the file? Prevent processing duplicates?
                // sha256File(localFilePath, (err, sha256) => {
                //     if (err) {
                //         this.addError(err, `Error getting the SHA256 for the file ${localFilePath}`, err);
                //         reject(err);
                //     }
                //     sha256FilePromise.resolve(sha256);
                // });


                /*
                    try {

                        Promise.all([fsStatPromise]).then(async resolved => {
                            let fsStat = resolved[0];


                            this.addActivity(`Triggering the Gather Together Script for ${localFilePath} which is ${fsStat['size']} bytes in size`, {
                                localFilePath,
                                queueEntry,
                                fsStat
                            });

                            let processingStartTime = new Date();

                            // ===============================================================
                            //    Actually Trigger the processing of the file
                            // ===============================================================
                            // s3.upload(uploadParams, uploadOptions, (err, data) => {

                            if (err) {
                                this.addError(err, 'S3 Upload Error');
                                reject(err);
                            } else if (data) {

                                let fileProcessingTimeMs = new Date().getTime() - processingStartTime.getTime(); // in ms
                                let processingTime = (new Date().getTime() - processingTimeStarted.getTime()) / 1000 + 's';
                                this.addActivity("Processed file locally with Gather Together: " + JSON.stringify({
                                    localFilePath,
                                    fileProcessingTimeMs, // in ms
                                }));
                                // console.log("S3 Upload Success", data.Location);
                                resolve({
                                    processed: true,
                                    localFilePath,
                                    fileProcessingTimeMs,
                                    processingTime,
                                    queueEntry,
                                });
                            }
                        });

                    } catch (err) {
                        this.addError(err, 'whilst getting all the promises to resolve for file stat, listing the object and tags, etc..');
                        reject(err);
                    } // The main processing Promise that's being returned
                    */
            }
        );
    }

    /**
     * Should return the queueEntry
     *
     * @param queueEntry
     * @param processQueueResponse
     * @param error
     * @returns {Promise<boolean|*>}
     */
    postProcessEntry = (queueEntry, processQueueResponse, error) => {
        return new Promise((resolve, reject) => {

            if (!_.isEmpty(error)) {
                // There was a pre or main processing error
                // You likely don't want to do anything important like deleting files if that's the case
                this.addActivity('As there was an error in previous processing, not postProcessing the ' + this.identQueueEntry(queueEntry));
                // console.warn('As there was an error, not postProcessing the ' + this.identQueueEntry(queueEntry));
                queueEntry.postProcessingCompleted = false;
                resolve(queueEntry);
            }

            let localFilePath = _.get(processQueueResponse, 'localFilePath', path.join(queueEntry.path)); // Convert to a local filepath that fs can read
            if (true === _.get(this.config, 'DELETE_ON_PROCESSED', false)) {
                // console.log('Going to delete the file ' + this.identQueueEntry(queueEntry));
                fs.promises.unlink(localFilePath).then(() => {
                    queueEntry.deleted = true;
                    queueEntry.postProcessingCompleted = true;
                    this.addActivity('Deleted the file ' + this.identQueueEntry(queueEntry));
                    // console.warn('Deleted the file ' + this.identQueueEntry(queueEntry));
                    resolve(queueEntry);
                }).catch((err) => {
                    this.addError(err, 'Issue when trying to post process delete the file ' + this.identQueueEntry(queueEntry));
                    queueEntry.deleted = false;
                    queueEntry.postProcessingCompleted = false;
                    // return queueEntry;
                    reject(err);
                });

            } else {
                queueEntry.postProcessingCompleted = true;
                resolve(queueEntry);
            }

        });
    }

    identQueueEntry(queueEntry) {
        if (_.isEmpty(queueEntry)) {
            return 'Empty Queue Entry';
        }

        let queueEntryIdent = 'Queue Entry ';
        if (_.get(queueEntry, 'path')) {
            return queueEntryIdent + _.get(queueEntry, 'path');
        }

    }

    /**
     * Should Replace Existing File
     *
     * @param s3ListObject {Object} e.g {"IsTruncated":false,"Contents":[{ "Key":"testing/1x1.gif", "Size":64, "LastModified":"2021-01-31T06:44:53.000Z", "ETag":"\\"d41d8cd98f00b204e9999999fff8427e\\"",  "StorageClass":"STANDARD" }],"Name":"testing-s3uploader","Prefix":"testing/1x1.gif","MaxKeys":2,"CommonPrefixes":[],"KeyCount":1}
     * @param fsStat {Object} e.g {size: 43, mtimeMs: 1610160450289.9504, mtime: new Date('2021-01-09T02:47:30.290Z'), ...}
     * @param sha256OfLocalFile {String} e.g '3331a0486cb3e8a75c8c2fdf02bf80fd8fe2b811dfe5c7b4aa892d38bfcf604a'
     * @param s3ObjectTags {Object} e.g { TagSet: [] } if empty or hopefully {"TagSet":[{"Key":"s3UploaderSHA256","Value":"3331a0486cb3e8a75c8c2fdf02bf80fd8fe2b811dfe5c7b4aa892d38bfcf604a"}]}
     * @returns {boolean}
     *
     */
    shouldUploadFile = async (s3ListObject, fsStat, sha256OfLocalFile, s3ObjectTags) => {
        let fileEntryS3 = _.get(s3ListObject, 'Contents.0');

        // -- Is it a new file upload?
        if (!fileEntryS3) {
            this.addActivity(`shouldUploadFile() fileEntryS3 is empty, the file ${s3ListObject.Prefix} hasn't been uploaded yet so uploading it`, fileEntryS3);
            return true;
        }

        // -- Overwrite no matter what?
        if (true === _.get(this.config, 'OVERWRITE', false)) {
            this.addActivity(`shouldUploadFile() OVERWRITE config is true, so overwriting ${s3ListObject.Prefix}`, this.config.OVERWRITE);
            return true;
        }

        // -- Check if different (filesize, SHA256 or modified time are different)
        if (true === _.get(this.config, 'OVERWRITE_EXISTING_IF_DIFFERENT', false)) {


            // -- Check if the filesize is different
            if (fileEntryS3.Size !== fsStat.size) {
                this.addActivity(`shouldUploadFile() You should replace the existing file upload because OVERWRITE_EXISTING_IF_DIFFERENT is true and the filesize on S3 is ${fileEntryS3.Size} but on the local filesystem it is ${fsStat.size}`);
                return true;
            }

            let s3ShaTagSet = _.find(s3ObjectTags.TagSet, tagSet => {
                return tagSet && tagSet.Key && tagSet.Key === 's3UploaderSHA256';
            });
            if (s3ShaTagSet && s3ShaTagSet.Value && sha256OfLocalFile) {
                // -- Using the SHA256 hashes
                if (s3ShaTagSet.Value !== sha256OfLocalFile) {
                    this.addActivity(`shouldUploadFile() replacing the existing file upload because OVERWRITE_EXISTING_IF_DIFFERENT is true and the SHA of the files is different. The s3 Sha256 is ${s3ShaTagSet.Value} but on the local filesystem it is ${sha256OfLocalFile}`);
                    return true;
                } else {
                    this.addActivity(`shouldUploadFile() NOT replacing the existing file upload because OVERWRITE_EXISTING_IF_DIFFERENT is true but the the SHA of the files is the same ${sha256OfLocalFile}`);
                    // NB: Falls through to the return false at the end, in case there's any other logic to be added later
                }
            } else {
                // -- Using the modified dates (as the SHA hashes aren't available)
                let lastModifiedS3Date = new Date(fileEntryS3.LastModified); // Should parse into a Date object pretty easily
                let lastModifiedLocalDate = fsStat.mtime; // Should already be a Date object
                // console.log('The lastModifiedDates are: ', {lastModifiedS3Date, lastModifiedLocalDate});

                if (lastModifiedLocalDate.getTime() > lastModifiedS3Date.getTime()) {
                    this.addActivity(`shouldUploadFile() You should replace the existing file upload because OVERWRITE_EXISTING_IF_DIFFERENT is true and the local file was modified more recently then that file on S3`, {
                        lastModifiedLocalDate,
                        lastModifiedS3Date
                    });
                    return true;
                } else {
                    let now = new Date();
                    this.addActivity(`shouldUploadFile() OVERWRITE_EXISTING_IF_DIFFERENT is true but there's no SHA but the s3 file is up to date with local according to the modified timestamp`, {
                        lastModifiedLocalDate,
                        lastModifiedS3Date,
                        localModifiedTimeAgo: now.getTime() - lastModifiedLocalDate.getTime() + 'ms',
                        s3ModifiedTimeAgo: now.getTime() - lastModifiedS3Date.getTime() + 'ms',
                    });
                }
            }
        }
        return false; // It's expected that if we haven't explicitly returned true before, then we'll return false now and not overwrite the file
    }

    /**
     *
     * Can't have more than 10k parts
     * For the default of 5MB that's a max of ~50GB
     *
     * We default to 10MB, but this works it out if more than than
     *
     * @param fsStat
     */
    workOutS3PartSize(fsStat) {

        if ((fsStat.size / this.config.S3_UPLOAD_OPTIONS_PART_SIZE) < 10000) {
            return this.config.S3_UPLOAD_OPTIONS_PART_SIZE; // Use the default part size of 10MB
        }
        let partSize = Math.ceil(fsStat.size / 9998); // Work out how many parts (file chunks) will be needed, with some accounting for rounding errors
        this.addActivity(`The file is large it's ${fsStat.size / 1073741824} GB so setting the partSize to ${partSize}`);
        return partSize;
    }
}


module.exports = QueueConsumerGTLocal;

/*
Example dirTree that is used to create the queue entries is:
{
    "path": "C:/s3uploader/tests/resources",
    "name": "resources",
    "mode": 16822,
    "mtime": "2021-01-28T14:38:38.045Z",
    "mtimeMs": 1611844718044.9944,
    "children": [
    {
        "path": "C:/s3uploader/tests/resources/1x1.gif",
        "name": "1x1.gif",
        "size": 43,
        "extension": ".gif",
        "type": "file",
        "mode": 33206,
        "mtime": "2021-01-09T02:47:30.290Z",
        "mtimeMs": 1610160450289.9504,
    }
],
    "size": 43,
    "type": "directory"
}

 */