const QueueConsumerBase = require('./QueueConsumerBase.js');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const AWS = require('aws-sdk');
const DeferredPromise = require('./DeferredPromise.js');
const _ = require('lodash');
const sha256File = require('sha256-file');

/**
 * S3 Upload file Queue Consumer
 *
 * For uploading files
 */
class QueueConsumerS3 extends QueueConsumerBase {

    // Expect the info to look something like:
    // config: {
    //     AWS_PROFILE: 'default',
    //     AWS_S3_BUCKET: 'myBucket',
    //     AWS_S3_BUCKET_FOLDER: 's3uploaderFiles',
    //     OVERWRITE_EXISTING_IF_DIFFERENT:
    // },

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
        OVERWRITE_EXISTING_IF_DIFFERENT: true, // If the file is different (modified more recently or filesize different) then upload the new version
        OVERWRITE: false, // Overwrite no matter what
        S3_UPLOAD_STORAGE_CLASS: 'STANDARD', // The S3 upload StorageClass Possible values include: "STANDARD" "REDUCED_REDUNDANCY" "GLACIER" "STANDARD_IA" "ONEZONE_IA" "INTELLIGENT_TIERING" "DEEP_ARCHIVE" "OUTPOSTS" as per https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property
        S3_UPLOAD_OPTIONS_PART_SIZE: 10 * 1024 * 1024, // Default of 10MB or fine for files up to 100GB shouldn't be less than 5MB as per https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property but can't be more than 10,000 chunks so we adjust it for larger files
        S3_UPLOAD_OPTIONS_QUEUE_SIZE: 4, // The default number of threads to upload each part, as per https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3/ManagedUpload.html
        S3_UPLOAD_OPTIONS_TAGS: [], // e.g [{Key: 'tag1', Value: 'value1'}] this is expected to be an array
        S3_UPLOAD_ACL: 'bucket-owner-full-control' // The canned ACL to apply to the upload. Possible values include: "private" "public-read" "public-read-write" "authenticated-read" "aws-exec-read" "bucket-owner-read" "bucket-owner-full-control"
    }

    processQueueEntry = async (queueEntry) => {

        /*
        Example queueEntry is:
        {
          "path": "C:/s3uploader/tests/resources/1x1.gif",
          "name": "1x1.gif",
          "size": 43,
          "extension": ".gif",
          "type": "file",
          "mode": 33206,
          "mtime": "2021-01-09T02:47:30.290Z",
          "mtimeMs": 1610160450289.9504,
          "basePath": "C:/s3uploader/tests/resources", // added in from the dirTree root entry, not there by default in dirTree for a child entry
          "__completedQueueTaskPromise": {
            "_promise": {}
          }
        }
         */

        return new Promise((resolve, reject) => {
            let processingTimeStarted = new Date();
            const basePath = queueEntry.basePath;


            let s3BucketFolder = this.config.AWS_S3_BUCKET_FOLDER;
            let s3BucketName = this.config.AWS_S3_BUCKET;
            let uploadLocationKey = s3BucketFolder + queueEntry.path.replace(basePath, ''); // @todo: remove basePath from the queueEntry ( treeEntry )
            let localFilePath = path.join(queueEntry.path); // Convert to a local filepath that fs can read


            let sha256FilePromise = new DeferredPromise();
            let s3ListObjectPromise = new DeferredPromise();
            let s3ObjectTaggingPromise = new DeferredPromise();
            let fsStatPromise = fsPromises.stat(localFilePath);

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
            sha256File(localFilePath, (err, sha256) => {
                if (err) {
                    this.addError(err, `Error getting the SHA256 for the file ${localFilePath}`, err);
                    reject(err);
                }
                sha256FilePromise.resolve(sha256);
            });

            // -- Create S3 service object
            let s3;
            if (this.config.s3) {
                s3 = this.config.s3;
            } else {
                AWS.config.update({region: this.config.AWS_REGION}); // Likely to be 'us-east-2' Ohio
                s3 = new AWS.S3({apiVersion: '2006-03-01'});
            }


            // ===============================================================
            //    Check if the file already exists
            // ===============================================================
            // Check https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#listObjectsV2-property for the listObjectsV2 SDK
            s3.getObjectTagging({
                Bucket: s3BucketName,
                Key: uploadLocationKey,
            }, async (err, tags) => {
                if (err) {
                    // e.g NoSuchKey: The specified key does not exist.

                    if (err.code !== 'NoSuchKey') {
                        // Ignore the NoSuchKey errors, just means the file hasn't been uploaded yet
                        this.addError(err, `S3 getObjectTagging for ${uploadLocationKey}`);
                    }
                    s3ObjectTaggingPromise.resolve({TagSet: []}); // It's OK if the file doesn't exist... We might miss other important errors like network outages, but this is only to check for the SHA256 hash as a tag, it's partly optional
                    /* Example err:

                      An error occurred: S3 listObjectsV2 for testing/1x1.gif
                      NoSuchKey: The specified key does not exist.
                        at Request.extractError (C:\s3uploader\node_modules\aws-sdk\lib\services\s3.js:700:35)
                        at Request.callListeners (C:\s3uploader\node_modules\aws-sdk\lib\sequential_executor.js:106:20)
                        at Request.emit (C:\s3uploader\node_modules\aws-sdk\lib\sequential_executor.js:78:10)
                        at Request.emit (C:\s3uploader\node_modules\aws-sdk\lib\request.js:688:14)
                        at Request.transition (C:\s3uploader\node_modules\aws-sdk\lib\request.js:22:10)
                        at AcceptorStateMachine.runTo (C:\s3uploader\node_modules\aws-sdk\lib\state_machine.js:14:12)
                        at C:\s3uploader\node_modules\aws-sdk\lib\state_machine.js:26:10
                        at Request.<anonymous> (C:\s3uploader\node_modules\aws-sdk\lib\request.js:38:9)
                        at Request.<anonymous> (C:\s3uploader\node_modules\aws-sdk\lib\request.js:690:12)
                        at Request.callListeners (C:\s3uploader\node_modules\aws-sdk\lib\sequential_executor.js:116:18) {
                      code: 'NoSuchKey',
                      region: null,
                      time: 2021-02-01T06:14:12.191Z,
                      requestId: '2C63F2B6EDD0747E',
                      extendedRequestId: 'FI4dFX5OllN5fgYuSvzr8WQrAhr1xmPiq9dPU5elihxhmycuorkcYOTU4qvtnAsBNg8gCRa4pVg=',
                      cfId: undefined,
                      statusCode: 404,
                      retryable: false,
                      retryDelay: 5.867163526294195
                     */
                } else {
                    s3ObjectTaggingPromise.resolve(tags);
                }
            });

            s3.listObjectsV2({
                    Bucket: s3BucketName,
                    Prefix: uploadLocationKey,
                    MaxKeys: 1
                }, (err, listObjects) => {
                    if (err) {
                        this.addError(err, `S3 listObjectsV2 for ${uploadLocationKey}`);
                        s3ListObjectPromise.reject(err);
                    } else {
                        // Example data: {"IsTruncated":false,"Contents":[ {
                        //  "Key":"testing/1x1.gif",
                        //  "LastModified":"2021-01-31T06:44:53.000Z",
                        //  "ETag":"\\"d41d8cd98f00b204e9999999fff8427e\\"",
                        //  "Size":0,
                        //  "StorageClass":"STANDARD"
                        // } ],"Name":"bucket-location","Prefix":"testing/1x1.gif","MaxKeys":1,"CommonPrefixes":[],"KeyCount":1}
                        // NB: If the file doesn't already exist then the Contents is an empty array and KeyCount is 0. e.g  {"IsTruncated":false,"Contents":[],"Name":"testing-s3uploader","Prefix":"testing/1x1.gif","MaxKeys":2,"CommonPrefixes":[],"KeyCount":0}
                        s3ListObjectPromise.resolve(listObjects);
                    }
                }
            );


            Promise.all([fsStatPromise, sha256FilePromise, s3ListObjectPromise, s3ObjectTaggingPromise]).then(async resolved => {
                let fsStat = resolved[0];
                let sha256OfLocalFile = resolved[1];
                let s3ListObject = resolved[2];
                let s3ObjectTags = resolved[3];
                // console.log({fsStat, sha256OfLocalFile, s3ListObject, s3ObjectTags});

                // -- Overwrite file?
                if (false === await this.shouldUploadFile(s3ListObject, fsStat, sha256OfLocalFile, s3ObjectTags)) {
                    // Nope, don't overwrite it
                    resolve({
                        uploaded: false,
                        shouldUploadFile: false,
                        localFilePath,
                        queueEntry,
                        s3ListObject,
                        sha256OfLocalFile,
                        s3ObjectTags,
                        processingTime: (new Date().getTime() - processingTimeStarted.getTime()) / 1000 + 's',
                    });
                }

                // -- Workout upload params and options
                let uploadParams = _.merge({
                    Bucket: s3BucketName,
                    Key: uploadLocationKey,
                    Body: '', // To be set to the stream later on
                    ACL: this.config.S3_UPLOAD_ACL,
                    StorageClass: this.config.S3_UPLOAD_STORAGE_CLASS,
                    // NB: We allow the queueEntry to contain a specific s3UploadParams if you really want to do something special like setting a WebsiteRedirectLocation or SSECustomerKeyMD5 which would be per file specific. Probably best sorted out in the preProcessEntry
                }, _.get(queueEntry, 's3UploadParams', {}));

                let uploadOptions = _.merge({
                    // Check https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property for more options and
                    // For info on how it does automatic chunking checkout https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3/ManagedUpload.html
                    // You might want to set your own s3UploadOptions per file for adding your own tags, but likely you'll want to set the config for the queue size or something similar
                    partSize: this.workOutS3PartSize(fsStat), // if the file is such that it'll be split into more than 10k parts with the S3_UPLOAD_OPTIONS_PART_SIZE then we select a new part size
                    queueSize: this.config.S3_UPLOAD_OPTIONS_QUEUE_SIZE,
                    tags: this.config.S3_UPLOAD_OPTIONS_TAGS.concat([{
                        Key: 's3UploaderSHA256',
                        Value: sha256OfLocalFile
                    }]),
                }, _.get(queueEntry, 's3UploadOptions', {}));


                this.addActivity(`Uploading the file to S3 ${uploadLocationKey}`, {
                    localFilePath,
                    uploadParams,
                    uploadOptions,
                    queueEntry,
                    fsStat, sha256OfLocalFile, s3ListObject, s3ObjectTags
                });

                let uploadingStartTime = new Date();
                let fileStream = fs.createReadStream(localFilePath); // A test pixel that's only 43bytes in size
                fileStream.on('error', (err) => {
                    this.addError(err, 'file streaming error when uploading to S3');
                    reject(err);
                });


                // ===============================================================
                //    Actually Upload the file
                // ===============================================================
                uploadParams.Body = fileStream;
                s3.upload(uploadParams, uploadOptions, (err, data) => {
                    if (err) {
                        this.addError(err, 'S3 Upload Error');
                        reject(err);
                    } else if (data) {

                        let uploadProcessingTime = new Date().getTime() - uploadingStartTime.getTime(); // in ms
                        let processingTime = (new Date().getTime() - processingTimeStarted.getTime()) / 1000 + 's';
                        this.addActivity("Uploaded file to S3: " + JSON.stringify({
                            localFilePath,
                            data,
                            uploadProcessingTime: uploadProcessingTime, // in ms
                        }));
                        // console.log("S3 Upload Success", data.Location);
                        resolve({
                            uploaded: true,
                            localFilePath,
                            uploadProcessingTime: uploadProcessingTime / 1000 + 's',
                            processingTime,
                            data,
                            uploadOptions,
                            s3ListObject,
                            sha256OfLocalFile,
                            s3ObjectTags,
                            queueEntry,
                        });
                        /* e.g data:  {
                          ETag: '"958c6ad2c1183fee0bf0dd489f4204c7"',
                          Location: 'https://bucket-location.s3.us-east-2.amazonaws.com/files/v1-0005.mp4',
                          key: 'files/v1-0005.mp4',
                          Key: 'files/v1-0005.mp4',
                          Bucket: 'bucket-location'
                        }
                        */
                    }
                });

            }).catch(err => {
                this.addError(err, 'whilst getting all the promises to resolve for file stat, listing the object and tags, etc..');
                reject(err);
            });
        });
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


module.exports = QueueConsumerS3;

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